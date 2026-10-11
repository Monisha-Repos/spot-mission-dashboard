"""
SPOT Mission Dashboard API.

    uvicorn app.main:create_app --factory --reload --port 8000      (from the backend folder)

Reads the lakehouse the Java ingest API writes to, and serves everything the dashboard needs.
Interactive docs: http://localhost:8000/docs
"""
from __future__ import annotations

import contextvars
import logging
import re
import threading
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import analytics, domain, evaluation, live
from .assistant import Assistant
from .config import Settings
from .lakehouse import LakehouseError
from .risk import RiskModel
from .store import DataStore

log = logging.getLogger("spot")

# Kit missions this request's browser has replayed in the sandbox (?sandbox=M019,M020); its views include them.
SANDBOX = contextvars.ContextVar("sandbox", default=())


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    # Earlier messages of this chat, oldest first; the assistant uses the last few to follow the conversation.
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)
    mode: Literal["simple", "technical"] = "simple"
    # What the user is looking at, e.g. {"part": "thermal_camera"} or {"waypoint": "WP05", "floor": 1}.
    context: dict[str, str | int | None] | None = None


class PredictRequest(BaseModel):
    action_type: Literal["NAVIGATION", "VISUAL_INSPECTION", "THERMAL_INSPECTION", "ACOUSTIC_INSPECTION", "GAUGE_READING"]
    location_id: str
    asset_id: str
    battery_pct: float = Field(ge=0, le=100)
    configuration_version: str = "V2"
    sequence: int = Field(default=1, ge=1)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    risk_model = RiskModel.load(settings.model_path, settings.metrics_path)
    store = DataStore(settings, risk_model)
    assistant = Assistant(settings)
    ops = None
    if settings.ops_enabled:
        from .ops.service import OpsService
        ops = OpsService(settings, store)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            ds = store.refresh()
            if ops:
                ops.sync_issues(ds)
                ops.seed_snapshots(ds)
        except LakehouseError as e:
            log.error("could not load the lakehouse: %s", e)
        # The Spot user guide PDFs take a few seconds to index; do it in the background.
        if store._dataset is not None:
            threading.Thread(target=assistant.warm, args=(store.dataset, metrics()), daemon=True).start()
        yield
        if ops:
            ops.close()

    app = FastAPI(title="SPOT Mission Dashboard API", version="1.0.0", lifespan=lifespan,
                  description="Mission data, inspection records, insights, AI assistant, failure-risk model and the Operator Console.")
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def sandbox_scope(request, call_next):
        raw = request.query_params.get("sandbox", "")
        token = SANDBOX.set(tuple(sorted({m for m in raw.split(",") if re.fullmatch(r"M\d{3}", m)}))[:20])
        try:
            return await call_next(request)
        finally:
            SANDBOX.reset(token)
    if settings.assets_dir.exists():
        # Floor plans and inspection images: /static/maps/..., /static/inspection-images/...
        app.mount("/static", StaticFiles(directory=settings.assets_dir), name="static")
    app.state.settings, app.state.store, app.state.ops = settings, store, ops

    def data():
        try:
            return store.dataset_with(ids) if (ids := SANDBOX.get()) else store.dataset
        except LakehouseError as e:
            raise HTTPException(503, f"lakehouse unavailable: {e}") from None

    def metrics() -> dict | None:
        return risk_model.metrics if risk_model else None

    @app.get("/health", tags=["system"])
    def health():
        ds = store._dataset
        return {"status": "ok" if ds else "no data", "lakehouse": settings.lakehouse, "source": ds.source if ds else None,
                "loaded_at": ds.loaded_at if ds else None, "missions": len(ds.missions) if ds else 0,
                "model_loaded": risk_model is not None, "ask_provider": settings.ask_provider,
                "ask_usage": assistant.usage(), "ingest_url": settings.ingest_url, "ops_enabled": ops is not None}

    @app.post("/admin/refresh", tags=["system"])
    def refresh():
        """Reload the lakehouse now (the ingest webhook does this automatically after each live mission)."""
        try:
            ds = store.refresh()
        except LakehouseError as e:
            raise HTTPException(503, str(e)) from None
        if ops:
            ops.sync_issues(ds)
        return {"missions": len(ds.missions), "actions": len(ds.records), "loaded_at": ds.loaded_at}

    @app.get("/summary", tags=["data"])
    def summary():
        """Landing-page headline: totals, KPIs per configuration, what needs attention, latest mission."""
        ds = data()
        missions = analytics.mission_summaries(ds)
        attention = sorted((r for r in ds.records if r["status"] == "action"),
                           key=lambda r: (domain.SEVERITY_RANK.get((r["anomaly"] or {}).get("severity"), 0), r["timestamp"]),
                           reverse=True)[:5]
        return {
            "source": ds.source, "loaded_at": ds.loaded_at,
            "latest_mission": missions[-1] if missions else None,
            "kpis": {scope: analytics.compute_kpis(ds, scope) for scope in ("all", "V1", "V2")},
            "needs_attention": attention,
            "ops": ops.stats() if ops else None,
        }

    @app.get("/missions", tags=["data"])
    def missions():
        return analytics.mission_summaries(data())

    @app.get("/missions/{mission_id}", tags=["data"])
    def mission(mission_id: str):
        ds = data()
        summary = next((m for m in analytics.mission_summaries(ds) if m["mission_id"] == mission_id), None)
        if not summary:
            raise HTTPException(404, f"no mission {mission_id}")
        return {**summary, "records": [r for r in ds.records if r["mission_id"] == mission_id]}

    @app.get("/missions/{mission_id}/replay", tags=["data"])
    def mission_replay(mission_id: str):
        events = analytics.replay(data(), mission_id)
        if events is None:
            raise HTTPException(404, f"no mission {mission_id}")
        return events

    @app.get("/records", tags=["data"])
    def records(mission: str | None = None, waypoint: str | None = None, asset: str | None = None,
                status: Literal["normal", "watch", "action"] | None = None, sensor: str | None = None,
                part: str | None = None, configuration: str | None = None, floor: int | None = None,
                limit: int = 500, offset: int = 0):
        """Inspection Records with filters (area, asset, sensor type, severity status, configuration)."""
        rows = [r for r in data().records
                if (not mission or r["mission_id"] == mission) and (not waypoint or r["location"]["id"] == waypoint)
                and (not asset or r["asset"]["id"] == asset) and (not status or r["status"] == status)
                and (not sensor or r["sensor_type"] == sensor) and (not part or r["spot_part"] == part)
                and (not configuration or r["configuration_version"] == configuration)
                and (floor is None or r["location"]["floor"] == floor)]
        return {"total": len(rows), "records": rows[offset: offset + limit]}

    @app.get("/records/{record_id}", tags=["data"])
    def record(record_id: str):
        r = next((r for r in data().records if r["record_id"] == record_id), None)
        if not r:
            raise HTTPException(404, f"no record {record_id}")
        return r

    @app.get("/waypoints", tags=["data"])
    def waypoints(floor: int | None = None):
        rows = analytics.waypoint_summaries(data(), ops.open_issues_by("location_id") if ops else None)
        return [w for w in rows if floor is None or w["floor"] == floor]

    @app.get("/waypoints/{waypoint_id}", tags=["data"])
    def waypoint(waypoint_id: str):
        w = next((w for w in waypoints() if w["id"] == waypoint_id), None)
        if not w:
            raise HTTPException(404, f"no waypoint {waypoint_id}")
        return {**w, "records": [r for r in data().records if r["location"]["id"] == waypoint_id]}

    @app.get("/parts", tags=["data"])
    def parts():
        """What each part of Spot measured, for the clickable 3D model."""
        return analytics.part_summaries(data())

    @app.get("/parts/{part_id}", tags=["data"])
    def part(part_id: str):
        p = next((p for p in parts() if p["id"] == part_id), None)
        if not p:
            raise HTTPException(404, f"no part {part_id}; use one of {list(domain.PARTS)}")
        return p

    @app.get("/assets", tags=["data"])
    def assets():
        return analytics.asset_summaries(data())

    @app.get("/assets/{asset_id}", tags=["data"])
    def asset(asset_id: str):
        a = analytics.asset_detail(data(), asset_id)
        if not a:
            raise HTTPException(404, f"no asset {asset_id}")
        return a

    @app.get("/compare", tags=["insights"])
    def compare():
        """BASELINE (V1) vs IMPROVED (V2), with significance tests, mission-level confidence ranges and a
        like-for-like comparison (battery level, action type and waypoint held the same)."""
        ds = data()
        return {**analytics.compare_configurations(ds), "detail": evaluation.improvement(ds)}

    @app.get("/insights", tags=["insights"])
    def insights():
        return analytics.insights(data(), metrics())

    @app.get("/kpis", tags=["insights"])
    def kpis(scope: str = "all"):
        k = analytics.compute_kpis(data(), scope)
        if k is None:
            raise HTTPException(404, f"no missions in scope {scope}")
        return k

    @app.get("/metrics", tags=["model"])
    def model_metrics():
        """Held-out test metrics of the failure-risk model (ml/metrics.json)."""
        if not metrics():
            raise HTTPException(404, "no ml/metrics.json; run python ml/train.py")
        return metrics()

    @app.get("/model/live", tags=["model"])
    def model_live():
        """The model on the live missions it never trained on, as many as have arrived so far."""
        return {**evaluation.live_model(data(), metrics(), risk_model.threshold if risk_model else None),
                "dataset_repo": settings.hf_dataset_repo or None, "model_repo": settings.hf_model_repo or None}

    @app.get("/live/script", tags=["live"])
    def live_script():
        """The IMPROVED missions as timed events, for the dashboard's sandbox mode (played in the visitor's browser)."""
        return live.script(settings.kit_dir)

    @app.post("/predict", tags=["model"])
    def predict(body: PredictRequest):
        """Failure risk for an action Spot is about to attempt."""
        if not risk_model:
            raise HTTPException(503, "no model loaded; run python ml/train.py")
        ds = data()
        loc, a = ds.locations.get(body.location_id), ds.assets.get(body.asset_id)
        if not loc or not a:
            raise HTTPException(404, f"unknown {'location ' + body.location_id if not loc else 'asset ' + body.asset_id}")
        risk = risk_model.predict([{
            "action_type": body.action_type, "location_id": body.location_id, "environment": loc["environment"],
            "zone_type": loc["zone_type"], "asset_type": a["asset_type"], "asset_criticality": a["criticality"],
            "configuration_version": body.configuration_version, "battery_pct": body.battery_pct,
            "sequence": float(body.sequence), "floor": float(loc["floor"])}])[0]
        flagged = risk >= risk_model.threshold
        return {"failure_risk": risk, "threshold": risk_model.threshold, "flagged": flagged,
                "explanation": (f"{risk:.0%} chance this {domain.ACTION_LABELS[body.action_type]} of {a['asset_name']} at "
                                f"{loc['location_name']} fails" + (" - above the alert threshold." if flagged else ".")),
                "model": risk_model.info}

    @app.get("/report/summary", tags=["assistant"])
    def report_summary(request: Request):
        """The PDF's AI review: how the new (V2) data compares with the baseline and how the model did on new missions."""
        client = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
                  or (request.client.host if request.client else "anonymous"))
        return assistant.report_summary(data(), metrics(), client=client)

    @app.post("/ask", tags=["assistant"])
    def ask(body: AskRequest, request: Request):
        # Behind a proxy the visitor's address is the first X-Forwarded-For entry.
        client = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
                  or (request.client.host if request.client else "anonymous"))
        return assistant.ask(data(), metrics(), body.question, body.mode, body.context, client=client,
                             history=[t.model_dump() for t in body.history])

    if ops:
        from .ops.router import build_router
        app.include_router(build_router(ops))

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
