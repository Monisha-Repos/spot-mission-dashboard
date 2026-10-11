"""
Live demo support.

- `script()` turns the kit's IMPROVED missions into timed events, the same shapes the Java ingest API's live feed
  pushes over /events (see ingest-api LiveFeed.timeline). The dashboard's sandbox mode plays this script in the
  visitor's own browser, so anyone can watch Spot work and answer an alarm without touching shared data.
- `IngestClient` drives the Java live feed (presenter mode) with the shared INGEST_API_KEY, so the key never
  reaches a browser: the Operator Console calls /ops/live/*, which forwards here.
"""
from __future__ import annotations

import csv
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import httpx

ALARM_SEVERITIES = {"HIGH", "CRITICAL"}
ORDER = ["MISSION_STARTED", "ACTION_STARTED", "READING_RECORDED", "ANOMALY_DETECTED", "ACTION_COMPLETED",
         "ACTION_FAILED", "MISSION_COMPLETED"]


class IngestError(RuntimeError):
    def __init__(self, status: int, message: str, body: dict | None = None):
        super().__init__(message)
        self.status = status
        self.body = body or {}


class IngestClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def status(self) -> dict:
        return self._call("GET", "/live/status")

    def control(self, action: str, body: dict | None = None) -> dict:
        return self._call("POST", f"/live/{action}", body or {})

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        headers = {"X-API-Key": self.api_key} if self.api_key else {}
        try:
            response = httpx.request(method, self.base_url + path, json=body, headers=headers, timeout=40)
        except httpx.HTTPError as e:
            raise IngestError(502, f"cannot reach the ingest API at {self.base_url} ({e.__class__.__name__})") from None
        data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
        if response.status_code >= 400:
            raise IngestError(response.status_code, data.get("error") or f"ingest API returned HTTP {response.status_code}", data)
        return data


# ---------- sandbox script ----------

def _read(folder: Path, table: str) -> list[dict]:
    with open(folder / f"{table}.csv", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _num(raw: str | None):
    if raw in (None, ""):
        return None
    value = float(raw)
    return int(value) if value.is_integer() else value


def _time(raw: str) -> datetime:
    return datetime.fromisoformat(raw[:19])


def _alert(anomaly: dict, readings: list[dict]) -> dict:
    alert = {k: v for k, v in anomaly.items() if k != "synthetic"}
    alert["readings"] = [{k: r[k] for k in ("measurement_type", "value", "unit", "quality")}
                         for r in readings if r["action_id"] == anomaly["action_id"]]
    return alert


def is_alarm(anomaly: dict) -> bool:
    return anomaly["severity"] in ALARM_SEVERITIES or str(anomaly.get("operator_review_required")).lower() == "true"


def timeline(mission: dict, actions: list[dict], readings: list[dict], anomalies: list[dict]) -> list[dict]:
    """One mission as timed events; offset_sec counts from the mission start. Mirrors LiveFeed.timeline in Java."""
    actions = sorted(actions, key=lambda a: int(a["sequence"]))
    mid, start = mission["mission_id"], _time(mission["start_time"])
    since = lambda raw: (_time(raw) - start).total_seconds()  # noqa: E731

    def event(kind, at, offset, details, alarm=False):
        return {"type": kind, "mission_id": mid, "at": at, "offset_sec": round(offset, 1), "alarm": alarm, "details": details}

    out = [event("MISSION_STARTED", mission["start_time"], 0, {
        "mission_id": mid, "mission_name": mission["mission_name"], "scenario": mission["scenario"],
        "configuration_version": mission["configuration_version"], "battery_pct": _num(mission["start_battery_pct"]),
        "action_count": len(actions), "duration_min": _num(mission["duration_min"])})]
    last = 0.0
    for i, a in enumerate(actions):
        begin = max(last, since(a["timestamp"]))
        nxt = since(actions[i + 1]["timestamp"]) if i + 1 < len(actions) else float("inf")
        end = min(begin + float(a["duration_sec"]), nxt)
        out.append(event("ACTION_STARTED", a["timestamp"], begin, {
            "action_id": a["action_id"], "sequence": _num(a["sequence"]), "location_id": a["location_id"],
            "asset_id": a["asset_id"], "action_type": a["action_type"], "battery_pct": _num(a["battery_pct"]),
            "configuration_version": a["configuration_version"]}))
        inside = begin
        for r in (r for r in readings if r["action_id"] == a["action_id"]):
            inside = max(inside, min(max(since(r["timestamp"]), begin), end))
            out.append(event("READING_RECORDED", r["timestamp"], inside, {
                "reading_id": r["reading_id"], "action_id": a["action_id"], "location_id": r["location_id"],
                "asset_id": r["asset_id"], "measurement_type": r["measurement_type"], "value": _num(r["value"]),
                "unit": r["unit"], "quality": r["quality"]}))
        for an in (an for an in anomalies if an["action_id"] == a["action_id"]):
            inside = max(inside, min(max(since(an["timestamp"]), begin), end))
            out.append(event("ANOMALY_DETECTED", an["timestamp"], inside, _alert(an, readings), is_alarm(an)))
        end = max(end, inside)
        out.append(event("ACTION_FAILED" if a["status"] == "FAILED" else "ACTION_COMPLETED", a["timestamp"], end, {
            "action_id": a["action_id"], "sequence": _num(a["sequence"]), "location_id": a["location_id"],
            "asset_id": a["asset_id"], "action_type": a["action_type"], "status": a["status"],
            "failure_type": a["failure_type"], "duration_sec": _num(a["duration_sec"]), "battery_pct": _num(a["battery_pct"])}))
        last = end
    finish = max(last, since(mission["end_time"]))
    out.append(event("MISSION_COMPLETED", mission["end_time"], finish, {
        "mission_id": mid, "mission_status": mission["mission_status"], "end_battery_pct": _num(mission["end_battery_pct"])}))
    out.sort(key=lambda e: (e["offset_sec"], ORDER.index(e["type"])))
    return out


@lru_cache(maxsize=4)
def script(kit_dir: Path, scenario: str = "IMPROVED") -> dict:
    """Every mission of one scenario, in start order, as timed events. The kit never changes while running."""
    tables = {t: _read(kit_dir, t) for t in ("missions", "actions", "readings", "anomalies")}
    missions = sorted((m for m in tables["missions"] if m["scenario"] == scenario.upper()), key=lambda m: m["start_time"])
    out = []
    for m in missions:
        mid = m["mission_id"]
        events = timeline(m, *[[r for r in tables[t] if r["mission_id"] == mid] for t in ("actions", "readings", "anomalies")])
        out.append({"mission_id": mid, "mission_name": m["mission_name"], "configuration_version": m["configuration_version"],
                    "duration_sec": events[-1]["offset_sec"], "events": events})
    return {"scenario": scenario.upper(), "missions": out,
            "alarms": sum(e["alarm"] for m in out for e in m["events"]),
            "note": "Synthetic kit missions replayed in your browser only; nothing is saved."}
