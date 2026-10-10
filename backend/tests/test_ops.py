"""Operator Console: sign-in, issue workflow, append-only audit trail, alarms, snapshots, ingest hook."""
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from conftest import make_settings


def test_login(client):
    assert client.post("/ops/login", json={"name": "Dana", "pin": "0000"}).status_code == 401
    assert client.get("/ops/me").status_code == 401
    token = client.post("/ops/login", json={"name": "Dana", "pin": "2468"}).json()["token"]
    assert client.get("/ops/me", headers={"Authorization": f"Bearer {token}"}).json()["name"] == "Dana"
    assert client.get("/ops/me", headers={"Authorization": f"Bearer {token}x"}).status_code == 401


def test_login_disabled_without_pin(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, OPS_PIN=""))) as c:
        assert c.post("/ops/login", json={"name": "Dana", "pin": "x"}).status_code == 503


def test_issues_created_from_anomalies_and_failures(client):
    issues = client.get("/ops/issues?limit=1000").json()
    sources = {i["source_type"] for i in issues}
    assert sources == {"ANOMALY", "FAILED_ACTION"}
    assert sum(i["source_type"] == "ANOMALY" for i in issues) == 40
    # Failed actions that already have an anomaly are not double-counted: 49 failures, 32 with anomalies.
    assert sum(i["source_type"] == "FAILED_ACTION" for i in issues) == 17
    assert issues[0]["severity"] == "CRITICAL" and issues[0]["explanation"]


def test_issue_workflow_and_audit_trail(client, operator, supervisor):
    iid = "ISS-AN014"
    assert client.patch(f"/ops/issues/{iid}", json={"status": "ACKNOWLEDGED", "note": "on it"}).status_code == 401
    assert client.patch(f"/ops/issues/{iid}", json={"status": "ACKNOWLEDGED", "note": ""}, headers=operator).status_code == 422
    client.patch(f"/ops/issues/{iid}", json={"status": "ACKNOWLEDGED", "note": "seen"}, headers=operator)
    client.patch(f"/ops/issues/{iid}", json={"assignee": "Lee", "note": "thermal tech"}, headers=operator)
    done = client.patch(f"/ops/issues/{iid}", json={"status": "RESOLVED", "note": "bearing greased"}, headers=operator).json()
    assert done["status"] == "RESOLVED" and done["assignee"] == "Lee"
    assert [e["kind"] for e in done["events"]] == ["CREATED", "STATUS", "ASSIGNED", "STATUS"]
    assert done["events"][-1]["actor"] == "Dana"
    # Closed issues can only be reopened, and only by a supervisor.
    assert client.patch(f"/ops/issues/{iid}", json={"status": "IN_PROGRESS", "note": "x"}, headers=supervisor).status_code == 400
    assert client.patch(f"/ops/issues/{iid}", json={"status": "OPEN", "note": "came back"}, headers=operator).status_code == 403
    assert client.patch(f"/ops/issues/{iid}", json={"status": "OPEN", "note": "came back"}, headers=supervisor).json()["status"] == "OPEN"
    assert client.get("/ops/kpis").json()["ops"]["mttr_hours"] is not None


def test_audit_trail_is_append_only(client, tmp_path):
    conn = sqlite3.connect(tmp_path / "ops.db")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        conn.execute("UPDATE issue_events SET note = 'edited'")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        conn.execute("DELETE FROM issue_events")


def test_snapshots_seeded_saved_and_compared(client, operator):
    timeline = client.get("/ops/snapshots").json()
    assert len(timeline) == 7 and all(s["auto_seeded"] for s in timeline)   # one per BASELINE day, Sept 1-7
    assert timeline[0]["headline"]["V2"] is None
    saved = client.post("/ops/snapshots", json={"label": "Before shift handoff"}, headers=operator)
    assert saved.status_code == 201 and saved.json()["kpis"]["all"]["ops"]["issues"] == 57
    assert client.post("/ops/snapshots", json={"label": "x"}).status_code == 401
    cmp = client.get(f"/ops/snapshots/compare?a={timeline[-1]['snapshot_id']}&b={saved.json()['snapshot_id']}"
                     f"&scope_a=V1&scope_b=V2").json()
    success = next(c for c in cmp["changes"] if c["kpi"] == "action_success_pct")
    assert success["a"] == 77.2 and success["b"] == 91.1 and success["verdict"] == "improved"
    assert cmp["improved"] > cmp["degraded"]


def test_alarm_decisions(client, operator):
    svc = client.app.state.ops
    svc.sync_issues(client.app.state.store.dataset, {"AN014", "AN036"})
    pending = client.get("/ops/alerts").json()
    assert {a["source_id"] for a in pending} == {"AN014", "AN036"} and pending[0]["evidence_image"]
    assert client.post("/ops/alerts/AN014/decision", json={"decision": "OVERRIDE", "note": ""}, headers=operator).status_code == 400
    danger = client.post("/ops/alerts/AN014/decision", json={"decision": "DANGER"}, headers=operator).json()
    assert danger["danger"] and danger["status"] == "IN_PROGRESS" and not danger["pending_decision"]
    ok = client.post("/ops/alerts/AN036/decision", json={"decision": "OVERRIDE", "note": "known Wi-Fi dead spot"},
                     headers=operator).json()
    assert ok["status"] == "FALSE_ALARM"
    assert client.post("/ops/alerts/AN036/decision", json={"decision": "DANGER"}, headers=operator).status_code == 409
    assert client.get("/ops/alerts").json() == []
    assert client.get("/ops/issues?limit=1").json()[0]["issue_id"] == "ISS-AN014"   # danger goes to the top
    assert client.get("/ops/kpis").json()["ops"]["median_alarm_response_sec"] is not None


def test_ingest_hook(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, INGEST_API_KEY="k"))) as c:
        event = {"event": "mission_ingested", "mission_id": "M020", "alerts": [{"anomaly_id": "AN014"}]}
        assert c.post("/ops/ingest-hook", json=event).status_code == 401
        assert c.post("/ops/ingest-hook", json=event, headers={"X-API-Key": "k"}).status_code == 202
        for _ in range(100):
            if c.get("/ops/alerts").json():
                break
            time.sleep(0.1)
        assert [a["source_id"] for a in c.get("/ops/alerts").json()] == ["AN014"]
        assert c.get("/ops/snapshots").json()[-1]["trigger"] == "ingest"


def test_activity_feed(client):
    feed = client.get("/ops/activity?asset=HX-204").json()
    assert feed["raised"] >= 1 and feed["summary"].startswith("HX-204:")


def test_ops_can_be_disabled(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, OPS_ENABLED="false"))) as c:
        assert c.get("/ops/issues").status_code == 404
        assert c.get("/summary").status_code == 200
