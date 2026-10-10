"""
Builds one Inspection Record per action (the README's core data model): the action joined with its
mission, location, asset, reading and anomaly, plus a status, a plain-English explanation and a next step.

Status rules, in order:
  action  - anomaly is HIGH or CRITICAL, or flagged for operator review, or the action failed on a CRITICAL asset
  watch   - any other anomaly, a failed action, a QUESTIONABLE reading, or a reading outside its usual range
  normal  - everything else
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import datetime

from . import domain


@dataclass
class Dataset:
    tables: dict[str, list[dict]]
    source: str
    loaded_at: str
    locations: dict[str, dict] = field(default_factory=dict)
    assets: dict[str, dict] = field(default_factory=dict)
    missions: dict[str, dict] = field(default_factory=dict)
    records: list[dict] = field(default_factory=list)
    ranges: dict[str, dict] = field(default_factory=dict)

    def mission_ids(self, scope: str = "all") -> list[str]:
        """Mission IDs in start order; scope is all, V1/V2 (configuration_version) or BASELINE/IMPROVED."""
        missions = sorted(self.missions.values(), key=lambda m: m["start_time"])
        if scope != "all":
            missions = [m for m in missions if scope in (m["configuration_version"], m["scenario"])]
        return [m["mission_id"] for m in missions]


def build_dataset(tables: dict[str, list[dict]], source: str, risk_model=None) -> Dataset:
    ds = Dataset(tables=tables, source=source, loaded_at=datetime.now().replace(microsecond=0).isoformat())
    ds.locations = {r["location_id"]: r for r in tables["locations"]}
    ds.assets = {r["asset_id"]: r for r in tables["assets"]}
    ds.missions = {r["mission_id"]: r for r in tables["missions"]}
    readings = {r["action_id"]: r for r in tables["readings"]}
    anomalies = {r["action_id"]: r for r in tables["anomalies"]}
    ds.ranges = usual_ranges(tables["readings"], set(anomalies))

    actions = sorted(tables["actions"], key=lambda a: (ds.missions[a["mission_id"]]["start_time"], a["sequence"]))
    ds.records = [build_record(a, ds, readings.get(a["action_id"]), anomalies.get(a["action_id"])) for a in actions]
    if risk_model is not None:
        for record, risk in zip(ds.records, risk_model.predict_records(ds.records)):
            record["predicted_failure_risk"] = risk
    return ds


def usual_ranges(readings: list[dict], anomalous_actions: set[str]) -> dict[str, dict]:
    """5th-95th percentile of GOOD readings with no anomaly, per measurement type."""
    by_type: dict[str, list[float]] = {}
    for r in readings:
        if r["quality"] == "GOOD" and r["action_id"] not in anomalous_actions:
            by_type.setdefault(r["measurement_type"], []).append(r["value"])
    ranges = {}
    for mtype, values in by_type.items():
        if len(values) >= 5:
            q = statistics.quantiles(values, n=20)
            ranges[mtype] = {"low": round(q[0], 1), "high": round(q[-1], 1), "based_on": len(values)}
    return ranges


def _fmt(value: float) -> str:
    return f"{value:g}"


def build_record(action: dict, ds: Dataset, reading: dict | None, anomaly: dict | None) -> dict:
    mission, location, asset = ds.missions[action["mission_id"]], ds.locations[action["location_id"]], ds.assets[action["asset_id"]]
    sensor = domain.SENSOR_TYPES[action["action_type"]]
    action_label = domain.ACTION_LABELS[action["action_type"]]
    status, reasons, sentences = "normal", [], []

    def raise_to(level: str, reason: str):
        nonlocal status
        reasons.append(reason)
        if domain.STATUS_RANK[level] > domain.STATUS_RANK[status]:
            status = level

    if anomaly:
        serious = anomaly["severity"] in {"HIGH", "CRITICAL"} or anomaly["operator_review_required"]
        raise_to("action" if serious else "watch", f"{anomaly['severity']} {anomaly['anomaly_type']} anomaly")
        sentences.append(f"{anomaly['severity'].capitalize()} {domain.humanize(anomaly['anomaly_type'])} detected on "
                         f"{asset['asset_name']}" + (" (operator review required)." if anomaly["operator_review_required"] else "."))
    if action["status"] == "FAILED":
        critical = asset["criticality"] == "CRITICAL"
        raise_to("action" if critical else "watch", f"action failed: {action['failure_type']}")
        sentences.append(f"The {action_label} failed ({domain.humanize(action['failure_type'])})"
                         + (" on a critical asset." if critical else "."))

    reading_out = None
    if reading:
        label, unit, _ = domain.MEASUREMENTS.get(reading["measurement_type"], (reading["measurement_type"], "", "either"))
        usual = ds.ranges.get(reading["measurement_type"])
        position = None
        text = f"{label} {_fmt(reading['value'])}{unit}"
        if usual:
            position = "below" if reading["value"] < usual["low"] else "above" if reading["value"] > usual["high"] else "within"
            text += f" is {position} the usual range ({_fmt(usual['low'])}–{_fmt(usual['high'])}{unit})"
            if position != "within":
                raise_to("watch", f"reading {position} usual range")
        sentences.append(text + ".")
        if reading["quality"] != "GOOD":
            raise_to("watch", f"reading quality {reading['quality']}")
            sentences.append(f"Spot marked this reading as {reading['quality'].lower()}.")
        reading_out = {
            "reading_id": reading["reading_id"], "measurement_type": reading["measurement_type"], "label": label,
            "value": reading["value"], "unit": reading["unit"], "quality": reading["quality"],
            "usual_range": usual, "position": position,
        }

    if not sentences:
        sentences.append(f"The {action_label} completed normally.")

    fill = {"asset": asset["asset_name"], "location": location["location_name"], "action": action_label, "sensor": sensor}
    if anomaly:
        next_step = domain.ANOMALY_ACTIONS.get(anomaly["anomaly_type"], "Review this finding.").format(**fill)
    elif action["status"] == "FAILED":
        next_step = domain.FAILURE_ACTIONS.get(action["failure_type"], "Re-run the {action}.").format(**fill)
    elif status == "watch":
        next_step = f"Keep an eye on {asset['asset_name']} on the next mission."
    else:
        next_step = "No action needed."

    return {
        "record_id": action["action_id"], "action_id": action["action_id"],
        "mission_id": mission["mission_id"], "mission_name": mission["mission_name"],
        "scenario": action["scenario"], "configuration_version": action["configuration_version"],
        "sequence": action["sequence"], "timestamp": action["timestamp"],
        "action_type": action["action_type"], "action_label": action_label, "sensor_type": sensor,
        "spot_part": domain.spot_part(action, anomaly),
        "outcome": action["status"], "failure_type": action["failure_type"],
        "battery_pct": action["battery_pct"], "duration_sec": action["duration_sec"],
        "location": {"id": location["location_id"], "name": location["location_name"], "floor": location["floor"],
                     "x": location["x_coord"], "y": location["y_coord"], "zone_type": location["zone_type"],
                     "environment": location["environment"]},
        "asset": {"id": asset["asset_id"], "name": asset["asset_name"], "type": asset["asset_type"],
                  "criticality": asset["criticality"]},
        "reading": reading_out,
        "anomaly": None if not anomaly else {
            "anomaly_id": anomaly["anomaly_id"], "type": anomaly["anomaly_type"], "severity": anomaly["severity"],
            "operator_review_required": anomaly["operator_review_required"], "description": anomaly["description"],
        },
        "status": status, "reasons": reasons,
        "explanation": " ".join(sentences),
        "recommended_action": next_step,
        "evidence_image": domain.evidence_image(sensor, anomaly),
        "predicted_failure_risk": None,
    }
