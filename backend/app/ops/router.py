"""/ops routes. Reads are open; every write needs a signed-in operator (Authorization: Bearer <token>)."""
from __future__ import annotations

import hmac
import logging
import threading
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from ..live import IngestClient, IngestError
from .auth import AuthError, issue_token, read_token
from .service import OpsError, OpsService

log = logging.getLogger(__name__)


class Login(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    role: Literal["operator", "supervisor"] = "operator"
    pin: str


class IssueChange(BaseModel):
    status: Literal["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "FALSE_ALARM"] | None = None
    assignee: str | None = Field(default=None, max_length=60)
    note: str = Field(min_length=1, max_length=1000)


class SnapshotRequest(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=1000)


class AlarmDecision(BaseModel):
    decision: Literal["OVERRIDE", "DANGER"]
    note: str = Field(default="", max_length=1000)


class LiveStart(BaseModel):
    speed: float = Field(default=60, ge=1, le=600)
    pause_on_alarm: bool = True


class LiveSpeed(BaseModel):
    speed: float = Field(ge=1, le=600)


def build_router(service: OpsService) -> APIRouter:
    router = APIRouter(prefix="/ops", tags=["operator console"])
    settings = service.settings
    ingest = IngestClient(settings.ingest_url, settings.ingest_api_key)

    def resume_feed_when_clear():
        """Pause-on-alarm: once no alarm is waiting for a decision, let the live feed carry on."""
        try:
            if service.stats()["pending_alarms"] == 0 and ingest.status().get("state") == "waiting_for_decision":
                ingest.control("resume")
        except IngestError as e:
            log.info("could not resume the live feed: %s", e)

    def current_user(authorization: str | None = Header(default=None)) -> dict:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "sign in first (POST /ops/login) and send Authorization: Bearer <token>")
        try:
            return read_token(authorization.removeprefix("Bearer "), secret=settings.ops_secret)
        except AuthError as e:
            raise HTTPException(401, str(e)) from None

    def run(fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except OpsError as e:
            raise HTTPException(e.status, str(e)) from None

    @router.post("/login")
    def login(body: Login):
        try:
            token = issue_token(body.name, body.role, body.pin, expected_pin=settings.ops_pin, secret=settings.ops_secret)
        except AuthError as e:
            raise HTTPException(503 if "OPS_PIN" in str(e) else 401, str(e)) from None
        return {"token": token, "name": body.name.strip(), "role": body.role}

    @router.get("/me")
    def me(user: dict = Depends(current_user)):
        return user

    @router.get("/issues")
    def issues(status: str | None = None, severity: str | None = None, location: str | None = None,
               mission: str | None = None, asset: str | None = None, pending: bool | None = None,
               danger: bool | None = None, open_only: bool = False, limit: int = 200):
        return service.list_issues(status=status, severity=severity, location=location, mission=mission, asset=asset,
                                   pending=pending, danger=danger, open_only=open_only, limit=limit)

    @router.get("/issues/{issue_id}")
    def issue(issue_id: str):
        return run(service.get_issue, issue_id)

    @router.patch("/issues/{issue_id}")
    def change_issue(issue_id: str, body: IssueChange, user: dict = Depends(current_user)):
        return run(service.change_issue, issue_id, user, status=body.status, assignee=body.assignee, note=body.note)

    @router.get("/alerts")
    def alerts(pending: bool = True):
        return service.alerts(pending)

    @router.post("/alerts/{anomaly_id}/decision")
    def decide(anomaly_id: str, body: AlarmDecision, user: dict = Depends(current_user)):
        issue = run(service.decide_alert, anomaly_id, user, body.decision, body.note)
        threading.Thread(target=resume_feed_when_clear, daemon=True).start()
        return issue

    # ---------- presenter-mode live feed (runs in the Java ingest API) ----------

    def live(action: str, body: dict | None = None):
        try:
            return ingest.control(action, body)
        except IngestError as e:
            raise HTTPException(e.status if e.status in (409, 502) else 502, str(e)) from None

    @router.post("/live/start")
    def live_start(body: LiveStart, user: dict = Depends(current_user)):
        """Stream the IMPROVED missions in, event by event, to every open dashboard."""
        return live("start", {"speed": body.speed, "pause_on_alarm": body.pause_on_alarm, "scenario": "IMPROVED"})

    @router.post("/live/speed")
    def live_speed(body: LiveSpeed, user: dict = Depends(current_user)):
        return live("speed", {"speed": body.speed})

    @router.post("/live/{action}")
    def live_control(action: Literal["pause", "resume", "stop", "reset"], user: dict = Depends(current_user)):
        if action == "reset" and user["role"] != "supervisor":
            raise HTTPException(403, "only a supervisor can reset the demo data")
        return live(action)

    @router.get("/kpis")
    def kpis(scope: str = "all"):
        k = service.kpis(scope)
        if k is None:
            raise HTTPException(404, f"no missions in scope {scope}")
        return k

    @router.get("/activity")
    def activity(asset: str | None = None, location: str | None = None, limit: int = 50):
        return service.activity(asset, location, limit)

    @router.get("/snapshots")
    def snapshots():
        return service.list_snapshots()

    @router.post("/snapshots", status_code=201)
    def save_snapshot(body: SnapshotRequest, user: dict = Depends(current_user)):
        return run(service.save_snapshot, user, body.label, body.note)

    @router.get("/snapshots/compare")
    def compare(a: int, b: int, scope_a: str = "all", scope_b: str | None = None):
        return run(service.compare_snapshots, a, b, scope_a, scope_b)

    @router.get("/snapshots/{snapshot_id}")
    def snapshot(snapshot_id: int):
        return run(service.get_snapshot, snapshot_id)

    @router.post("/ingest-hook", status_code=202)
    async def ingest_hook(request: Request, x_api_key: str | None = Header(default=None)):
        """Called by the Java ingest API after each live mission (INGEST_WEBHOOK_URL)."""
        if settings.ingest_api_key and not hmac.compare_digest((x_api_key or "").encode(), settings.ingest_api_key.encode()):
            raise HTTPException(401, "missing or wrong X-API-Key")
        event = await request.json()
        if not isinstance(event, dict):
            raise HTTPException(400, "expected a JSON object")
        kind = event.get("event", "mission_ingested")
        if kind == "live_alert":
            # Opened right away so an operator can decide before the mission has finished and been saved.
            return {"accepted": True, "issues": service.raise_live_alerts(event)}
        if kind == "live_reset":
            threading.Thread(target=service.reset, name="ops-reset", daemon=True).start()
            return {"accepted": True, "reset": True}
        service.on_ingest(event)
        return {"accepted": True, "mission_id": event.get("mission_id")}

    return router
