"""KPIs, comparisons, per-waypoint / per-part / per-asset summaries, insights and mission replay."""
from __future__ import annotations

import math
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from . import domain
from .records import Dataset

BATTERY_BUCKETS = [(0, 30, "under 30%"), (30, 50, "30–49%"), (50, 70, "50–69%"), (70, 101, "70% and up")]

# For snapshot comparisons: which way is better for each KPI (matched by key prefix).
KPI_DIRECTION = {
    "mission_completion_pct": "higher", "action_success_pct": "higher", "reading_good_pct": "higher",
    "avg_end_battery_pct": "higher",
    "navigation_failure_pct_by_waypoint": "lower", "failure_pct_by_waypoint": "lower", "anomalies_per_mission": "lower",
    "anomalies_by_severity": "lower", "anomalies_by_type": "lower", "serious_anomalies": "lower",
    "hidden_failure_missions": "lower", "avg_battery_drain_pct": "lower", "status_counts.action": "lower",
    "status_counts.watch": "lower", "avg_predicted_failure_risk": "lower", "ops.open_issues": "lower",
    "ops.danger_issues": "lower", "ops.mttr_hours": "lower", "ops.median_alarm_response_sec": "lower",
    "ops.pending_alarms": "lower",
}


def pct(part: float, whole: float) -> float | None:
    return round(100 * part / whole, 1) if whole else None


def mean(values) -> float | None:
    values = [v for v in values if v is not None]
    return round(statistics.mean(values), 2) if values else None


def scoped_records(ds: Dataset, scope: str = "all") -> list[dict]:
    ids = set(ds.mission_ids(scope))
    return [r for r in ds.records if r["mission_id"] in ids]


def compute_kpis(ds: Dataset, scope: str = "all", mission_ids: list[str] | None = None) -> dict | None:
    """KPIs over a scope (all, V1, V2, BASELINE, IMPROVED) or an explicit list of missions."""
    ids = mission_ids if mission_ids is not None else ds.mission_ids(scope)
    if not ids:
        return None
    id_set = set(ids)
    missions = [ds.missions[i] for i in ids]
    records = [r for r in ds.records if r["mission_id"] in id_set]
    anomalies = [r["anomaly"] for r in records if r["anomaly"]]
    succeeded = [r for r in records if r["outcome"] == "SUCCESS"]

    by_type, by_wp, nav_by_wp = defaultdict(list), defaultdict(list), defaultdict(list)
    for r in records:
        by_type[r["action_type"]].append(r["outcome"] == "SUCCESS")
        by_wp[r["location"]["id"]].append(r["outcome"] == "FAILED")
        if r["action_type"] == "NAVIGATION":
            nav_by_wp[r["location"]["id"]].append(r["outcome"] == "FAILED")
    readings = [r["reading"] for r in records if r["reading"]]
    failed_missions = {r["mission_id"] for r in records if r["outcome"] == "FAILED"}

    return {
        "scope": scope, "missions": len(missions), "actions": len(records),
        "mission_completion_pct": pct(sum(m["mission_status"] == "COMPLETED" for m in missions), len(missions)),
        "action_success_pct": pct(len(succeeded), len(records)),
        "action_success_pct_by_type": {t: pct(sum(v), len(v)) for t, v in sorted(by_type.items())},
        "failure_pct_by_waypoint": {w: pct(sum(v), len(v)) for w, v in sorted(by_wp.items())},
        "navigation_failure_pct_by_waypoint": {w: pct(sum(v), len(v)) for w, v in sorted(nav_by_wp.items())},
        "anomalies": len(anomalies),
        "anomalies_per_mission": round(len(anomalies) / len(missions), 2),
        "serious_anomalies": sum(a["severity"] in {"HIGH", "CRITICAL"} for a in anomalies),
        "anomalies_by_severity": {s: sum(a["severity"] == s for a in anomalies) for s in domain.SEVERITY_RANK},
        "anomalies_by_type": dict(sorted(Counter(a["type"] for a in anomalies).items())),
        "hidden_failure_missions": sum(m["mission_status"] == "COMPLETED" and m["mission_id"] in failed_missions for m in missions),
        "avg_battery_drain_pct": mean(m["start_battery_pct"] - m["end_battery_pct"] for m in missions),
        "avg_end_battery_pct": mean(m["end_battery_pct"] for m in missions),
        "avg_duration_min": mean(m["duration_min"] for m in missions),
        "reading_good_pct": pct(sum(r["quality"] == "GOOD" for r in readings), len(readings)),
        "status_counts": {s: sum(r["status"] == s for r in records) for s in domain.STATUS_RANK},
        "avg_predicted_failure_risk": mean(r["predicted_failure_risk"] for r in records),
    }


def flatten(d: dict, prefix: str = "") -> dict[str, float]:
    out = {}
    for k, v in (d or {}).items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(flatten(v, key + "."))
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[key] = v
    return out


def direction_of(key: str) -> str | None:
    for prefix, better in KPI_DIRECTION.items():
        if key == prefix or key.startswith(prefix + "."):
            return better
    return None


def compare_kpis(a: dict, b: dict) -> list[dict]:
    """Every numeric KPI in both, with the change from a to b marked improved / degraded / unchanged."""
    fa, fb = flatten(a), flatten(b)
    rows = []
    for key in sorted(set(fa) & set(fb)):
        delta = round(fb[key] - fa[key], 4)
        better = direction_of(key)
        if delta == 0:
            verdict = "unchanged"
        elif better is None:
            verdict = "changed"
        else:
            verdict = "improved" if (delta > 0) == (better == "higher") else "degraded"
        rows.append({"kpi": key, "a": fa[key], "b": fb[key], "delta": delta, "better_when": better, "verdict": verdict})
    return rows


def two_proportion_p_value(x1: int, n1: int, x2: int, n2: int) -> float | None:
    """Two-sided z-test for p1 != p2."""
    if not n1 or not n2:
        return None
    p = (x1 + x2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return None
    z = (x1 / n1 - x2 / n2) / se
    return round(math.erfc(abs(z) / math.sqrt(2)), 4)


def compare_configurations(ds: Dataset) -> dict:
    v1, v2 = compute_kpis(ds, "V1"), compute_kpis(ds, "V2")
    out = {"V1": v1, "V2": v2, "changes": [], "tests": {}, "summary": "Only one configuration has data so far."}
    if not (v1 and v2):
        return out
    out["changes"] = [c for c in compare_kpis(v1, v2) if c["verdict"] in {"improved", "degraded"}]
    r1, r2 = scoped_records(ds, "V1"), scoped_records(ds, "V2")
    ok1, ok2 = sum(r["outcome"] == "SUCCESS" for r in r1), sum(r["outcome"] == "SUCCESS" for r in r2)
    an1, an2 = sum(bool(r["anomaly"]) for r in r1), sum(bool(r["anomaly"]) for r in r2)
    p_success = two_proportion_p_value(ok1, len(r1), ok2, len(r2))
    out["tests"] = {
        "action_success": {"V1": f"{ok1}/{len(r1)}", "V2": f"{ok2}/{len(r2)}", "p_value": p_success,
                           "method": "two-proportion z-test"},
        "anomaly_rate": {"V1": f"{an1}/{len(r1)}", "V2": f"{an2}/{len(r2)}",
                         "p_value": two_proportion_p_value(an1, len(r1), an2, len(r2)), "method": "two-proportion z-test"},
    }
    strength = ("very unlikely to be chance (p < 0.01)" if p_success is not None and p_success < 0.01
                else "unlikely to be chance (p < 0.05)" if p_success is not None and p_success < 0.05
                else "not yet statistically clear (p ≥ 0.05)")
    out["summary"] = (f"Action success went from {v1['action_success_pct']}% on V1 to {v2['action_success_pct']}% on V2 "
                      f"({v1['missions']} vs {v2['missions']} missions); the difference is {strength}. "
                      f"Missions also end with more battery ({v1['avg_end_battery_pct']}% vs {v2['avg_end_battery_pct']}%).")
    return out


def _latest_records(ds: Dataset, missions: int = 5) -> list[dict]:
    ids = set(ds.mission_ids()[-missions:])
    return [r for r in ds.records if r["mission_id"] in ids]


def _worst(records: list[dict]) -> str:
    return max((r["status"] for r in records), key=domain.STATUS_RANK.get, default="normal")


def waypoint_summaries(ds: Dataset, open_issues: dict[str, int] | None = None) -> list[dict]:
    """Status colour comes from the last 5 missions, so it improves as better missions arrive."""
    latest = _latest_records(ds)
    latest_config = ds.missions[ds.mission_ids()[-1]]["configuration_version"] if ds.missions else None
    out = []
    for loc in sorted(ds.locations.values(), key=lambda l: l["location_id"]):
        wid = loc["location_id"]
        records = [r for r in ds.records if r["location"]["id"] == wid]
        recent = [r for r in latest if r["location"]["id"] == wid]
        by_config = {}
        for cfg in sorted({r["configuration_version"] for r in records}):
            rs = [r for r in records if r["configuration_version"] == cfg]
            by_config[cfg] = {"actions": len(rs), "failure_pct": pct(sum(r["outcome"] == "FAILED" for r in rs), len(rs)),
                              "anomalies": sum(bool(r["anomaly"]) for r in rs)}
        failures = Counter(r["failure_type"] for r in records if r["failure_type"])
        out.append({
            "id": wid, "name": loc["location_name"], "floor": loc["floor"], "x": loc["x_coord"], "y": loc["y_coord"],
            "zone_type": loc["zone_type"], "environment": loc["environment"],
            "status": _worst(recent), "status_basis": "worst record at this waypoint in the last 5 missions",
            "actions": len(records), "failure_pct": pct(sum(r["outcome"] == "FAILED" for r in records), len(records)),
            "anomalies": sum(bool(r["anomaly"]) for r in records), "by_configuration": by_config,
            "top_failures": dict(failures.most_common(3)),
            "assets": sorted({r["asset"]["id"] for r in records}),
            "predicted_failure_risk": mean(r["predicted_failure_risk"] for r in records if r["configuration_version"] == latest_config),
            "open_issues": (open_issues or {}).get(wid),
        })
    return out


def _reading_stats(records: list[dict]) -> dict:
    stats = {}
    for mtype in sorted({r["reading"]["measurement_type"] for r in records if r["reading"]}):
        values = [r["reading"] for r in records if r["reading"] and r["reading"]["measurement_type"] == mtype]
        stats[mtype] = {
            "label": values[0]["label"], "unit": values[0]["unit"], "count": len(values),
            "mean": mean(v["value"] for v in values), "min": min(v["value"] for v in values),
            "max": max(v["value"] for v in values), "usual_range": values[0]["usual_range"],
            "questionable": sum(v["quality"] != "GOOD" for v in values),
        }
    return stats


def battery_reliability(records: list[dict]) -> list[dict]:
    rows = []
    for low, high, label in BATTERY_BUCKETS:
        rs = [r for r in records if low <= r["battery_pct"] < high]
        rows.append({"battery": label, "actions": len(rs), "failure_pct": pct(sum(r["outcome"] == "FAILED" for r in rs), len(rs))})
    return rows


def part_summaries(ds: Dataset) -> list[dict]:
    out = []
    for part_id, part in domain.PARTS.items():
        records = ds.records if part_id == "battery" else [r for r in ds.records if r["spot_part"] == part_id]
        if part_id == "battery":
            v = {cfg: compute_kpis(ds, cfg) for cfg in ("V1", "V2")}
            extra = {"by_battery_level": battery_reliability(records),
                     "end_battery_pct": {cfg: k["avg_end_battery_pct"] for cfg, k in v.items() if k},
                     "battery_drain_pct": {cfg: k["avg_battery_drain_pct"] for cfg, k in v.items() if k}}
            low = extra["by_battery_level"][0]
            plain = (f"Spot's battery powers every mission. Actions started under 30% battery failed {low['failure_pct']}% "
                     f"of the time." if low["actions"] else "Spot's battery powers every mission.")
        else:
            extra = {"readings": _reading_stats(records)}
            plain = None
        success = pct(sum(r["outcome"] == "SUCCESS" for r in records), len(records))
        anomalies = [r["anomaly"] for r in records if r["anomaly"]]
        by_config = {cfg: pct(sum(r["outcome"] == "SUCCESS" for r in rs), len(rs))
                     for cfg in ("V1", "V2") if (rs := [r for r in records if r["configuration_version"] == cfg])}
        if plain is None and not records:
            plain = f"The {part['name'].split(' (')[0]} {part['plain']}. No mission actions are logged against it in this data."
        if plain is None:
            plain = (f"The {part['name'].split(' (')[0].lower()} {part['plain']}. It was used in {len(records)} actions "
                     f"and succeeded {success}% of the time" + (f", with {len(anomalies)} findings needing attention." if anomalies else "."))
        out.append({
            "id": part_id, "name": part["name"], "what_it_does": part["plain"], "summary": plain,
            "actions": len(records), "success_pct": success, "success_pct_by_configuration": by_config,
            "failures_by_type": dict(Counter(r["failure_type"] for r in records if r["failure_type"]).most_common()),
            "anomalies_by_type": dict(Counter(a["type"] for a in anomalies).most_common()),
            "anomalies_by_severity": {s: sum(a["severity"] == s for a in anomalies) for s in domain.SEVERITY_RANK},
            "status_counts": {s: sum(r["status"] == s for r in records) for s in domain.STATUS_RANK},
            "record_ids": [r["record_id"] for r in records if r["status"] != "normal"],
            **extra,
        })
    return out


def asset_summaries(ds: Dataset) -> list[dict]:
    out = []
    for asset in sorted(ds.assets.values(), key=lambda a: a["asset_id"]):
        records = [r for r in ds.records if r["asset"]["id"] == asset["asset_id"]]
        out.append({
            "id": asset["asset_id"], "name": asset["asset_name"], "type": asset["asset_type"],
            "criticality": asset["criticality"], "home_location": asset["location_id"],
            "inspections": len(records), "failures": sum(r["outcome"] == "FAILED" for r in records),
            "anomalies": sum(bool(r["anomaly"]) for r in records),
            "latest_status": records[-1]["status"] if records else None,
            "latest_inspection": records[-1]["timestamp"] if records else None,
        })
    return out


def asset_detail(ds: Dataset, asset_id: str) -> dict | None:
    summary = next((a for a in asset_summaries(ds) if a["id"] == asset_id), None)
    if not summary:
        return None
    records = [r for r in ds.records if r["asset"]["id"] == asset_id]
    trend = [{"timestamp": r["timestamp"], "mission_id": r["mission_id"], "configuration_version": r["configuration_version"],
              "measurement_type": r["reading"]["measurement_type"], "value": r["reading"]["value"],
              "quality": r["reading"]["quality"], "status": r["status"], "record_id": r["record_id"]}
             for r in records if r["reading"]]
    return {**summary, "readings": _reading_stats(records), "trend": trend, "records": records}


def mission_summaries(ds: Dataset) -> list[dict]:
    out = []
    for mid in ds.mission_ids():
        m = ds.missions[mid]
        records = [r for r in ds.records if r["mission_id"] == mid]
        failed = sum(r["outcome"] == "FAILED" for r in records)
        out.append({
            "mission_id": mid, "mission_name": m["mission_name"], "scenario": m["scenario"],
            "configuration_version": m["configuration_version"], "start_time": m["start_time"], "end_time": m["end_time"],
            "duration_min": m["duration_min"], "mission_status": m["mission_status"],
            "start_battery_pct": m["start_battery_pct"], "end_battery_pct": m["end_battery_pct"],
            "actions": len(records), "failed_actions": failed,
            "hidden_failures": m["mission_status"] == "COMPLETED" and failed > 0,
            "anomalies": sum(bool(r["anomaly"]) for r in records),
            "status_counts": {s: sum(r["status"] == s for r in records) for s in domain.STATUS_RANK},
            "headline": (f"{len(records)} points inspected · {sum(r['status'] == 'normal' for r in records)} normal · "
                         f"{sum(r['status'] == 'watch' for r in records)} watch · {sum(r['status'] == 'action' for r in records)} need action"),
        })
    return out


def insights(ds: Dataset, model_metrics: dict | None = None) -> list[dict]:
    """Answers the challenge's suggested questions from the data, each with its evidence."""
    out = []
    records = ds.records
    missions = mission_summaries(ds)

    hidden = [m for m in missions if m["hidden_failures"]]
    if hidden:
        out.append({"id": "hidden-failures", "title": "Completed missions still hide failed actions",
                    "detail": f"{len(hidden)} of {sum(m['mission_status'] == 'COMPLETED' for m in missions)} completed missions had at "
                              f"least one failed action ({sum(m['failed_actions'] for m in hidden)} failed actions in total). "
                              "Mission status alone overstates how well inspections went.",
                    "evidence": {"mission_ids": [m["mission_id"] for m in hidden]}})

    by_type = {t: pct(sum(r["outcome"] == "SUCCESS" for r in rs), len(rs))
               for t in sorted({r["action_type"] for r in records}) if (rs := [r for r in records if r["action_type"] == t])}
    if by_type:
        worst = min(by_type, key=by_type.get)
        out.append({"id": "least-reliable-inspection", "title": f"{domain.ACTION_LABELS[worst].capitalize()} is the least reliable action",
                    "detail": f"It succeeds {by_type[worst]}% of the time, against {max(by_type.values())}% for the best action type.",
                    "evidence": {"success_pct_by_type": by_type}})

    wps = sorted(waypoint_summaries(ds), key=lambda w: -(w["failure_pct"] or 0))[:3]
    nav = compute_kpis(ds)["navigation_failure_pct_by_waypoint"] if ds.missions else {}
    if wps:
        worst_nav = max(nav, key=nav.get) if nav else None
        out.append({"id": "failure-hotspots", "title": f"Failures concentrate at {wps[0]['id']} ({wps[0]['name']})",
                    "detail": ", ".join(f"{w['id']} {w['name']}: {w['failure_pct']}% of {w['actions']} actions failed" for w in wps)
                              + (f". Navigation fails most at {worst_nav} ({nav[worst_nav]}%)." if worst_nav else "."),
                    "evidence": {"waypoints": [w["id"] for w in wps], "navigation_failure_pct_by_waypoint": nav}})

    buckets = battery_reliability(records)
    filled = [b for b in buckets if b["actions"]]
    if len(filled) >= 2:
        out.append({"id": "battery-reliability", "title": "Low battery goes with failed actions",
                    "detail": "; ".join(f"{b['battery']}: {b['failure_pct']}% failed ({b['actions']} actions)" for b in filled) + ".",
                    "evidence": {"by_battery_level": buckets}})

    quiet = [r for r in records if r["anomaly"] and r["outcome"] == "SUCCESS"]
    if quiet:
        out.append({"id": "anomalies-on-successful-actions", "title": "Some problems were found by actions that 'succeeded'",
                    "detail": f"{len(quiet)} anomalies were raised on actions that reported success, so a green action is not "
                              "the same as healthy equipment.",
                    "evidence": {"anomaly_ids": [r["anomaly"]["anomaly_id"] for r in quiet]}})

    comparison = compare_configurations(ds)
    if comparison["V1"] and comparison["V2"]:
        out.append({"id": "v1-vs-v2", "title": "Configuration V2 performs better than V1",
                    "detail": comparison["summary"], "evidence": comparison["tests"]})

    assets = sorted(asset_summaries(ds), key=lambda a: -(a["anomalies"] * 2 + a["failures"]))
    if assets and assets[0]["anomalies"]:
        a = assets[0]
        out.append({"id": "problem-asset", "title": f"{a['name']} ({a['id']}) needs the most attention",
                    "detail": f"{a['anomalies']} anomalies and {a['failures']} failed inspections across {a['inspections']} visits; "
                              f"criticality {a['criticality'].lower()}.", "evidence": {"asset_id": a["id"]}})

    if model_metrics and model_metrics.get("feature_importance"):
        top = model_metrics["feature_importance"][0]["feature"]
        risk = model_metrics.get("mean_predicted_risk_by_configuration", {})
        out.append({"id": "model-risk-factors", "title": f"The failure-risk model relies most on {top.replace('_', ' ')}",
                    "detail": f"Average predicted failure risk is {risk.get('V1', 0) * 100:.0f}% for V1 actions and "
                              f"{risk.get('V2', 0) * 100:.0f}% for V2 actions (model trained on the kit data).",
                    "evidence": {"feature_importance": model_metrics["feature_importance"][:5]}})
    return out


def replay(ds: Dataset, mission_id: str) -> list[dict] | None:
    """Chronological events for a mission, rebuilt from its actions so live missions can be replayed too."""
    m = ds.missions.get(mission_id)
    if not m:
        return None
    events = [{"t": m["start_time"], "type": "MISSION_STARTED", "battery_pct": m["start_battery_pct"]}]
    for r in (r for r in ds.records if r["mission_id"] == mission_id):
        where = {"location_id": r["location"]["id"], "x": r["location"]["x"], "y": r["location"]["y"], "floor": r["location"]["floor"]}
        events.append({"t": r["timestamp"], "type": "ACTION_STARTED", "action_id": r["action_id"],
                       "action_type": r["action_type"], "asset_id": r["asset"]["id"], "battery_pct": r["battery_pct"], **where})
        end = (datetime.fromisoformat(r["timestamp"]) + timedelta(seconds=r["duration_sec"] or 0)).isoformat()
        if r["anomaly"]:
            a = r["anomaly"]
            events.append({"t": end, "type": "ANOMALY_DETECTED", "action_id": r["action_id"], "anomaly_id": a["anomaly_id"],
                           "anomaly_type": a["type"], "severity": a["severity"],
                           "operator_review_required": a["operator_review_required"], **where})
        events.append({"t": end, "type": "ACTION_FAILED" if r["outcome"] == "FAILED" else "ACTION_COMPLETED",
                       "action_id": r["action_id"], "failure_type": r["failure_type"], "status": r["status"], **where})
    events.sort(key=lambda e: e["t"])
    # In the synthetic data the last action can finish after the mission's recorded end_time; the mission
    # end event stays last either way and keeps the recorded time alongside.
    events.append({"t": max(m["end_time"], events[-1]["t"]), "recorded_end_time": m["end_time"],
                   "type": f"MISSION_{m['mission_status']}", "battery_pct": m["end_battery_pct"]})
    return events
