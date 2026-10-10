"""Data API: numbers must match the kit's own validation_results.json."""
import json
from pathlib import Path

KIT = json.loads((Path(__file__).resolve().parents[2] / "data" / "kit" / "validation_results.json").read_text())["metrics"]


def test_health(client):
    h = client.get("/health").json()
    assert h["status"] == "ok" and h["missions"] == 27 and h["model_loaded"] and h["ops_enabled"]


def test_kpis_match_official_validation(client):
    v1, v2, all_ = (client.get(f"/kpis?scope={s}").json() for s in ("V1", "V2", "all"))
    assert v1["mission_completion_pct"] == KIT["baseline_mission_completion_pct"]
    assert v1["action_success_pct"] == KIT["baseline_action_success_pct"]
    assert v2["mission_completion_pct"] == KIT["improved_mission_completion_pct"]
    assert v2["action_success_pct"] == KIT["improved_action_success_pct"]
    assert all_["navigation_failure_pct_by_waypoint"]["WP05"] == KIT["wp05_navigation_failure_pct"]
    assert all_["anomalies"] == 40 and all_["actions"] == 270


def test_records_have_explanations_and_status(client):
    body = client.get("/records?limit=1000").json()
    assert body["total"] == 270
    for r in body["records"]:
        assert r["status"] in {"normal", "watch", "action"}
        assert r["explanation"] and r["recommended_action"] and r["evidence_image"].startswith("/static/")
        assert r["predicted_failure_risk"] is not None
    critical = client.get("/records/A0194").json()          # AN014: CRITICAL abnormal temperature on HX-204
    assert critical["status"] == "action" and critical["anomaly"]["anomaly_id"] == "AN014"
    assert "Critical abnormal temperature" in critical["explanation"]


def test_record_filters(client):
    rs = client.get("/records?waypoint=WP05&status=action").json()["records"]
    assert rs and all(r["location"]["id"] == "WP05" and r["status"] == "action" for r in rs)
    assert client.get("/records?floor=2").json()["total"] > 0


def test_missions_and_replay(client):
    missions = client.get("/missions").json()
    assert len(missions) == 27 and missions[0]["mission_id"] == "M001"
    assert any(m["hidden_failures"] for m in missions)
    events = client.get("/missions/M020/replay").json()
    assert events[0]["type"] == "MISSION_STARTED" and events[-1]["type"].startswith("MISSION_")
    assert any(e["type"] == "ANOMALY_DETECTED" and e["anomaly_id"] == "AN014" for e in events)
    assert client.get("/missions/M999").status_code == 404


def test_waypoints_parts_assets(client):
    wps = client.get("/waypoints").json()
    assert len(wps) == 15 and all(w["status"] in {"normal", "watch", "action"} for w in wps)
    assert len(client.get("/waypoints?floor=2").json()) == 5
    parts = {p["id"]: p for p in client.get("/parts").json()}
    assert set(parts) == {"thermal_camera", "ptz_camera", "microphone", "legs_and_body_cameras", "lidar", "radio", "battery"}
    assert "TEMPERATURE_C" in parts["thermal_camera"]["readings"]
    assert parts["battery"]["by_battery_level"][0]["battery"] == "under 30%"
    asset = client.get("/assets/HX-204").json()
    assert asset["trend"] and asset["anomalies"] >= 1


def test_compare_and_insights(client):
    cmp = client.get("/compare").json()
    assert cmp["tests"]["action_success"]["V1"] == "139/180" and cmp["tests"]["action_success"]["V2"] == "82/90"
    assert cmp["tests"]["action_success"]["p_value"] < 0.05
    ids = {i["id"] for i in client.get("/insights").json()}
    assert {"hidden-failures", "failure-hotspots", "battery-reliability", "v1-vs-v2"} <= ids


def test_model_metrics_and_predict(client):
    m = client.get("/metrics").json()
    assert m["split"]["test_actions"] + m["split"]["train_actions"] == 270
    assert not set(m["split"]["train_missions"]) & set(m["split"]["test_missions"])  # no mission leaks across the split
    low = client.post("/predict", json={"action_type": "NAVIGATION", "location_id": "WP05", "asset_id": "HX-201",
                                        "battery_pct": 15, "configuration_version": "V1"}).json()
    high = client.post("/predict", json={"action_type": "NAVIGATION", "location_id": "WP05", "asset_id": "HX-201",
                                         "battery_pct": 90, "configuration_version": "V2"}).json()
    assert 0 <= high["failure_risk"] < low["failure_risk"] <= 1
    assert client.post("/predict", json={"action_type": "NAVIGATION", "location_id": "WP99", "asset_id": "HX-201",
                                         "battery_pct": 50}).status_code == 404


def test_static_images(client):
    assert client.get("/static/inspection-images/thermal_pump_bearing_01.jpg").status_code == 200
    assert client.get("/static/maps/fictional_floor_plan.png").status_code == 200
