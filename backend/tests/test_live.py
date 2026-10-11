"""Live demo support: sandbox script, mid-mission alarms, presenter controls, reset, V1/V2 evidence, AI spend guards."""
import json
import time

from fastapi.testclient import TestClient

from app.main import create_app
from conftest import make_settings

# Nothing listens here, so the presenter controls can't reach a Java ingest API in tests.
NO_INGEST = "http://127.0.0.1:9"


def test_sandbox_script(client):
    script = client.get("/live/script").json()
    assert [m["mission_id"] for m in script["missions"]] == [f"M0{n}" for n in range(19, 28)]
    assert script["alarms"] == 5
    for m in script["missions"]:
        events = m["events"]
        assert events[0]["type"] == "MISSION_STARTED" and events[-1]["type"] == "MISSION_COMPLETED"
        offsets = [e["offset_sec"] for e in events]
        assert offsets == sorted(offsets)
        assert sum(e["type"] == "ACTION_STARTED" for e in events) == 10
        for e in events:
            if e["alarm"]:
                assert e["type"] == "ANOMALY_DETECTED"
                assert e["details"]["severity"] in {"HIGH", "CRITICAL"} or e["details"]["operator_review_required"] == "True"


def test_live_alert_opens_an_alarm_before_the_mission_is_saved(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, INGEST_API_KEY="k", INGEST_URL=NO_INGEST))) as c:
        alert = {"anomaly_id": "AN999", "action_id": "A9999", "mission_id": "M099", "location_id": "WP07",
                 "asset_id": "HX-204", "anomaly_type": "ABNORMAL_TEMPERATURE", "severity": "CRITICAL",
                 "operator_review_required": "True", "readings": []}
        event = {"event": "live_alert", "mission_id": "M099", "alerts": [alert]}
        assert c.post("/ops/ingest-hook", json=event).status_code == 401
        assert c.post("/ops/ingest-hook", json=event, headers={"X-API-Key": "k"}).json()["issues"] == ["ISS-AN999"]
        # A repeat (e.g. the mission landing later) doesn't open a second issue.
        assert c.post("/ops/ingest-hook", json=event, headers={"X-API-Key": "k"}).json()["issues"] == []
        pending = c.get("/ops/alerts?pending=true").json()
        assert "AN999" in {i["source_id"] for i in pending}
        token = c.post("/ops/login", json={"name": "Dana", "pin": "2468"}).json()["token"]
        decided = c.post("/ops/alerts/AN999/decision", json={"decision": "DANGER", "note": ""},
                         headers={"Authorization": f"Bearer {token}"}).json()
        assert decided["danger"] and not decided["pending_decision"]
        assert "Critical abnormal temperature" in decided["title"]


def test_presenter_controls_need_sign_in(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, INGEST_URL=NO_INGEST))) as c:
        assert c.post("/ops/live/start", json={}).status_code == 401
        op = c.post("/ops/login", json={"name": "Dana", "pin": "2468"}).json()["token"]
        sup = c.post("/ops/login", json={"name": "Sam", "role": "supervisor", "pin": "2468"}).json()["token"]
        started = c.post("/ops/live/start", json={"speed": 60}, headers={"Authorization": f"Bearer {op}"})
        assert started.status_code == 502 and "cannot reach the ingest API" in started.json()["detail"]
        assert c.post("/ops/live/reset", headers={"Authorization": f"Bearer {op}"}).status_code == 403
        assert c.post("/ops/live/reset", headers={"Authorization": f"Bearer {sup}"}).status_code == 502
        assert c.post("/ops/live/start", json={"speed": 5000}, headers={"Authorization": f"Bearer {op}"}).status_code == 422


def test_reset_hook_rebuilds_the_operator_console(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, INGEST_API_KEY="k"))) as c:
        token = c.post("/ops/login", json={"name": "Dana", "pin": "2468"}).json()["token"]
        auth = {"Authorization": f"Bearer {token}"}
        c.post("/ops/snapshots", json={"label": "before reset"}, headers=auth)
        before = len(c.get("/ops/snapshots").json())
        assert c.post("/ops/ingest-hook", json={"event": "live_reset"}, headers={"X-API-Key": "k"}).status_code == 202
        previous = None
        for _ in range(100):  # the reset runs in the background: wait until the re-seeded baseline snapshots settle
            labels = sorted(s["label"] for s in c.get("/ops/snapshots").json())
            if labels and "before reset" not in labels and labels == previous:
                break
            previous = labels
            time.sleep(0.2)
        after = c.get("/ops/snapshots").json()
        assert "before reset" not in {s["label"] for s in after} and 0 < len(after) < before
        assert c.get("/ops/issues").json()  # issues re-created from the data


def test_v1_v2_evidence_and_live_model(client):
    detail = client.get("/compare").json()["detail"]
    assert detail["available"]
    raw, gap = detail["raw"], detail["gap"]
    assert raw["V1"]["ci95"][0] <= raw["V1"]["success_pct"] <= raw["V1"]["ci95"][1]
    assert gap["ci95"][0] > 0  # the raw rise is clear of zero
    assert detail["adjusted"]["controls"] == ["battery level", "action type", "waypoint"]
    assert detail["avg_battery_at_action_pct"]["V2"] > detail["avg_battery_at_action_pct"]["V1"]

    live = client.get("/model/live").json()
    m = client.get("/metrics").json()
    assert live["live_missions"] == m["split"]["live_missions"]
    assert set(live["arrived"]) == set(m["split"]["live_missions"])  # the kit already holds every mission
    assert live["model"]["caught"] + live["model"]["missed"] == live["failures"]


def test_ai_spend_guards(tmp_path, monkeypatch):
    from app.assistant import Assistant
    settings = make_settings(tmp_path, ASK_PROVIDER="huggingface", ASK_PER_MINUTE="2", ASK_BUDGET_USD="1",
                             ASK_SPEND_FILE=str(tmp_path / "spend.json"))
    with TestClient(create_app(settings)) as c:
        calls = []
        monkeypatch.setattr(Assistant, "_call_huggingface", lambda self, mode, prompt, history=None: (calls.append(1), ("Answer [WP05]", "test-model"))[1])
        ask = lambda q: c.post("/ask", json={"question": q}).json()  # noqa: E731
        first = ask("Why did WP05 fail?")
        assert first["provider"] == "huggingface" and first["model"] == "test-model"
        assert ask("why did  WP05 fail?")["cached"] and len(calls) == 1  # same question: no second paid call
        ask("How hot did the heat exchanger get at WP07?")
        limited = ask("What is the battery level on mission M020?")
        assert limited["provider"] == "none" and "too many" in limited["llm_error"] and len(calls) == 2

    (tmp_path / "spend.json").write_text(json.dumps({"month": time.strftime("%Y-%m", time.gmtime()), "spent_usd": 1.2,
                                                     "calls": 9, "tokens_in": 0, "tokens_out": 0}))
    with TestClient(create_app(settings)) as c:
        over = c.post("/ask", json={"question": "Why did WP05 fail?"}).json()
        assert over["provider"] == "none" and "budget" in over["llm_error"]
        assert c.get("/health").json()["ask_usage"]["spent_usd"] == 1.2


def _baseline_lake(tmp_path):
    """A local lakehouse holding only the BASELINE missions, like the demo before any V2 mission arrives."""
    import csv
    lake = tmp_path / "lake"
    lake.mkdir()
    for t in ("locations", "assets", "missions", "actions", "readings", "anomalies"):
        with open(f"../data/kit/{t}.csv", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        keep = [r for r in rows if t in ("locations", "assets") or r["mission_id"] <= "M018"]
        with open(lake / f"{t}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=rows[0].keys())
            w.writeheader()
            w.writerows(keep)
    return lake


def test_sandbox_missions_join_the_views_for_that_request_only(tmp_path):
    lake = _baseline_lake(tmp_path)
    with TestClient(create_app(make_settings(tmp_path, LAKEHOUSE="local", LAKEHOUSE_DIR=str(lake)))) as c:
        assert c.get("/compare").json()["V2"] is None
        k = c.get("/summary?sandbox=M019,M020,M024").json()["kpis"]
        assert k["all"]["missions"] == 21 and k["V2"]["missions"] == 3
        assert c.get("/compare?sandbox=M019,M020,M024").json()["detail"]["available"]
        assert c.get("/model/live?sandbox=M019,M020,M024").json()["arrived"] == ["M024"]
        # Baseline missions, unknown ids and junk are ignored; nothing leaks into the shared data.
        assert len(c.get("/missions?sandbox=M001,M999,X;DROP").json()) == 18
        assert len(c.get("/missions").json()) == 18
        assert c.get("/ops/kpis").json()["missions"] == 18


def test_report_summary_uses_only_computed_facts(tmp_path, monkeypatch):
    from app.assistant import Assistant
    with TestClient(create_app(make_settings(tmp_path))) as c:
        plain = c.get("/report/summary").json()
    assert plain["provider"] == "none" and "91.1%" in plain["text"] and "never trained on" in " ".join(plain["facts"])

    seen = {}

    def fake(self, mode, prompt, history=None):
        seen.update(mode=mode, prompt=prompt)
        return "V2 did better, mostly because of battery.\n\nThe model needs retraining.", "test-model"

    monkeypatch.setattr(Assistant, "_call_huggingface", fake)
    settings = make_settings(tmp_path, ASK_PROVIDER="huggingface", ASK_SPEND_FILE=str(tmp_path / "spend.json"))
    with TestClient(create_app(settings)) as c:
        r = c.get("/report/summary").json()
        assert c.get("/report/summary").json()["cached"]  # one paid call per dataset
    assert r["provider"] == "huggingface" and r["model"] == "test-model" and "retraining" in r["text"]
    assert seen["mode"] == "report" and "<facts>" in seen["prompt"] and "77.2%" in seen["prompt"]
