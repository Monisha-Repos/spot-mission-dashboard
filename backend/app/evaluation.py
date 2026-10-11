"""
How sure are we that V2 is better, and how is the failure-risk model doing on missions it has never seen?

- `improvement()`: V1 vs V2 action success with 95% confidence ranges, resampling whole missions (actions within one
  mission are not independent), plus a like-for-like comparison: a logistic model of failure with configuration,
  battery level, action type and waypoint, used to predict every action under V1 and under V2. If the gap shrinks,
  part of V2's gain came with the conditions it ran in rather than the configuration itself.
- `live_model()`: the model scored on the "live" missions (never trained on) that have arrived so far, next to the
  battery-rule baseline. It fills in during the demo as those missions stream in.
"""
from __future__ import annotations

import re
import threading

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import OneHotEncoder

from .records import Dataset

BOOTSTRAP = 2000
ADJUSTED_BOOTSTRAP = 300
SEED = 7

_cache: dict[str, dict] = {}
_lock = threading.Lock()


def _rate_ci(groups: list[list[int]], rng) -> tuple[float, float, float, np.ndarray]:
    """Pooled success rate over missions (lists of 0/1 outcomes) with a mission-level bootstrap 95% range."""
    sizes = np.array([len(g) for g in groups])
    wins = np.array([sum(g) for g in groups])
    rate = wins.sum() / sizes.sum()
    picks = rng.integers(0, len(groups), size=(BOOTSTRAP, len(groups)))
    draws = wins[picks].sum(axis=1) / sizes[picks].sum(axis=1)
    return float(rate), float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5)), draws


def _pp(x: float) -> float:
    return round(100 * x, 1)


class _Adjusted:
    """failed ~ V2 + battery + action type + waypoint; success predicted for every action under each configuration."""

    def __init__(self, records: list[dict]):
        self.cats = np.array([[r["action_type"], r["location"]["id"]] for r in records], dtype=object)
        self.battery = np.array([float(r["battery_pct"]) for r in records])
        self.v2 = np.array([r["configuration_version"] == "V2" for r in records], dtype=float)
        self.failed = np.array([r["outcome"] == "FAILED" for r in records], dtype=int)
        self.encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=False).fit(self.cats)
        self.onehot = self.encoder.transform(self.cats)
        self.mu, self.sd = self.battery.mean(), self.battery.std() or 1.0

    def _x(self, idx, v2_value=None):
        v2 = self.v2[idx] if v2_value is None else np.full(len(idx), v2_value)
        return np.column_stack([v2, (self.battery[idx] - self.mu) / self.sd, self.onehot[idx]])

    def gap(self, idx) -> tuple[float, float, float] | None:
        if len(set(self.failed[idx])) < 2 or len(set(self.v2[idx])) < 2:
            return None
        model = LogisticRegression(C=1.0, max_iter=2000).fit(self._x(idx), self.failed[idx])
        everyone = np.arange(len(self.failed))
        as_v1 = 1 - model.predict_proba(self._x(everyone, 0.0))[:, 1].mean()
        as_v2 = 1 - model.predict_proba(self._x(everyone, 1.0))[:, 1].mean()
        return float(as_v1), float(as_v2), float(model.coef_[0][0])


def improvement(ds: Dataset) -> dict:
    key = ds.loaded_at + ds.source
    with _lock:
        if key in _cache:
            return _cache[key]
    result = _improvement(ds)
    with _lock:
        _cache[key] = result
        while len(_cache) > 8:  # shared data plus a few sandbox views
            _cache.pop(next(iter(_cache)))
    return result


def _improvement(ds: Dataset) -> dict:
    rng = np.random.default_rng(SEED)
    by_cfg: dict[str, dict[str, list[int]]] = {"V1": {}, "V2": {}}
    for r in ds.records:
        if r["configuration_version"] in by_cfg:
            by_cfg[r["configuration_version"]].setdefault(r["mission_id"], []).append(int(r["outcome"] == "SUCCESS"))
    if not by_cfg["V1"] or not by_cfg["V2"]:
        return {"available": False, "summary": "Needs missions from both V1 and V2."}

    raw, draws = {}, {}
    for cfg, missions in by_cfg.items():
        rate, low, high, draws[cfg] = _rate_ci(list(missions.values()), rng)
        raw[cfg] = {"success_pct": _pp(rate), "ci95": [_pp(low), _pp(high)], "missions": len(missions),
                    "actions": sum(len(g) for g in missions.values())}
    diff = draws["V2"] - draws["V1"]
    gap = {"points": round(raw["V2"]["success_pct"] - raw["V1"]["success_pct"], 1),
           "ci95": [_pp(np.percentile(diff, 2.5)), _pp(np.percentile(diff, 97.5))],
           "share_of_resamples_v2_better": round(float((diff > 0).mean()), 3)}

    records = [r for r in ds.records if r["configuration_version"] in by_cfg]
    adj = _Adjusted(records)
    point = adj.gap(np.arange(len(records)))
    mission_rows: dict[str, list[int]] = {}
    for i, r in enumerate(records):
        mission_rows.setdefault(r["mission_id"], []).append(i)
    v1_ids = [m for m in mission_rows if records[mission_rows[m][0]]["configuration_version"] == "V1"]
    v2_ids = [m for m in mission_rows if records[mission_rows[m][0]]["configuration_version"] == "V2"]
    gaps = []
    for _ in range(ADJUSTED_BOOTSTRAP):
        sample = [*rng.choice(v1_ids, len(v1_ids)), *rng.choice(v2_ids, len(v2_ids))]
        res = adj.gap(np.concatenate([mission_rows[m] for m in sample]))
        if res:
            gaps.append(res[1] - res[0])
    adjusted = None
    if point:
        low, high = (np.percentile(gaps, [2.5, 97.5]) if gaps else (np.nan, np.nan))
        adjusted = {"success_pct_if_all_v1": _pp(point[0]), "success_pct_if_all_v2": _pp(point[1]),
                    "points": _pp(point[1] - point[0]), "ci95": [_pp(low), _pp(high)],
                    "odds_ratio_v2_vs_v1_failure": round(float(np.exp(point[2])), 2),
                    "controls": ["battery level", "action type", "waypoint"]}

    battery = {cfg: round(float(np.mean([r["battery_pct"] for r in records if r["configuration_version"] == cfg])), 1)
               for cfg in ("V1", "V2")}
    raw_clear = gap["ci95"][0] > 0
    if adjusted is None:
        verdict = "Not enough variation to compare like for like yet."
    elif adjusted["ci95"][0] > 0:
        verdict = (f"Even with battery level, action type and waypoint held the same, V2 succeeds "
                   f"{adjusted['points']:+.1f} points more often (95% range {adjusted['ci95'][0]:+.1f} to "
                   f"{adjusted['ci95'][1]:+.1f}): the configuration itself helps.")
    else:
        verdict = (f"With battery level, action type and waypoint held the same, the gap is {adjusted['points']:+.1f} points "
                   f"(95% range {adjusted['ci95'][0]:+.1f} to {adjusted['ci95'][1]:+.1f}), so it can't be separated from "
                   f"chance. Most of V2's gain comes with the conditions it ran in: actions started with "
                   f"{battery['V2']:.0f}% battery on average on V2 against {battery['V1']:.0f}% on V1.")
    summary = (f"Action success rose from {raw['V1']['success_pct']}% on V1 to {raw['V2']['success_pct']}% on V2 "
               f"({gap['points']:+.1f} points, 95% range {gap['ci95'][0]:+.1f} to {gap['ci95'][1]:+.1f}, resampling whole "
               f"missions){' and that rise is unlikely to be chance' if raw_clear else ', but the range still includes no change'}. "
               + verdict)
    return {"available": True, "raw": raw, "gap": gap, "adjusted": adjusted, "avg_battery_at_action_pct": battery,
            "summary": summary, "method": (f"Mission-level bootstrap ({BOOTSTRAP} resamples) for the raw rates; "
                                           f"logistic regression with {ADJUSTED_BOOTSTRAP} mission-level bootstrap "
                                           "refits for the like-for-like gap (standardized over every action).")}


def _counts(records: list[dict], flagged: list[bool]) -> dict:
    failed = [r["outcome"] == "FAILED" for r in records]
    tp = sum(f and g for f, g in zip(flagged, failed))
    fp = sum(f and not g for f, g in zip(flagged, failed))
    fn = sum(g and not f for f, g in zip(flagged, failed))
    return {"caught": tp, "missed": fn, "false_alarms": fp, "correct_ok": len(records) - tp - fp - fn,
            "precision": round(tp / (tp + fp), 3) if tp + fp else None,
            "recall": round(tp / (tp + fn), 3) if tp + fn else None,
            "f1": round(2 * tp / (2 * tp + fp + fn), 3) if tp else (0.0 if fp + fn else None)}


def live_model(ds: Dataset, metrics: dict | None, threshold: float | None) -> dict:
    """The model on live missions (never trained on) that have arrived so far."""
    if not metrics or threshold is None:
        return {"available": False, "summary": "No model loaded."}
    live_ids = metrics.get("split", {}).get("live_missions") or []
    arrived = [m for m in live_ids if m in ds.missions]
    records = [r for r in ds.records if r["mission_id"] in arrived and r["predicted_failure_risk"] is not None]
    rule = (metrics.get("baselines", {}).get("battery_rule") or {}).get("rule", "")
    limit = float(m.group(1)) if (m := re.search(r"<=\s*([\d.]+)", rule)) else None
    model = _counts(records, [r["predicted_failure_risk"] >= threshold for r in records])
    baseline = _counts(records, [float(r["battery_pct"]) <= limit for r in records]) if limit is not None else None
    failures = sum(r["outcome"] == "FAILED" for r in records)
    if not arrived:
        summary = (f"Waiting for the {len(live_ids)} live missions ({', '.join(live_ids)}) the model has never seen. "
                   "They arrive during the live demo.")
    else:
        summary = (f"{len(arrived)} of {len(live_ids)} never-seen missions have arrived: the model flagged {model['caught']} of "
                   f"{failures} failures before they happened, with {model['false_alarms']} false alarm"
                   f"{'s' if model['false_alarms'] != 1 else ''}"
                   + (f" (battery rule: {baseline['caught']} caught, {baseline['false_alarms']} false alarms)." if baseline else "."))
    # Ranking quality needs both outcomes. PR-AUC near the failure rate means the risk scores carry no signal here.
    ranking, drift = None, None
    ys = [int(r["outcome"] == "FAILED") for r in records]
    if 0 < sum(ys) < len(ys):
        from sklearn.metrics import average_precision_score, roc_auc_score
        scores = [r["predicted_failure_risk"] for r in records]
        ranking = {"pr_auc": round(float(average_precision_score(ys, scores)), 3), "base_rate": round(sum(ys) / len(ys), 3),
                   "roc_auc": round(float(roc_auc_score(ys, scores)), 3)}
        if ranking["pr_auc"] <= ranking["base_rate"] * 1.25:
            fails = [r for r in records if r["outcome"] == "FAILED"]
            kinds = ", ".join(sorted({(r["failure_type"] or "").replace("_", " ").lower() for r in fails if r["failure_type"]}))
            drift = (f"Model drift: on these missions the risk scores are no better than chance (PR-AUC {ranking['pr_auc']} vs a "
                     f"{100 * ranking['base_rate']:.1f}% failure rate). These failures ({kinds}) happened at "
                     f"{np.mean([r['battery_pct'] for r in fails]):.0f}% battery on average, unlike the low-battery failures "
                     "the model learned from. Retrain with these missions before relying on its flags for V2.")
    per_mission = []
    for mid in arrived:
        rs = [r for r in records if r["mission_id"] == mid]
        per_mission.append({"mission_id": mid, "actions": len(rs), "failures": sum(r["outcome"] == "FAILED" for r in rs),
                            **{k: v for k, v in _counts(rs, [r["predicted_failure_risk"] >= threshold for r in rs]).items()
                               if k in ("caught", "missed", "false_alarms")}})
    return {"available": True, "live_missions": live_ids, "arrived": arrived, "actions": len(records),
            "failures": failures, "threshold": threshold, "model": model, "battery_rule": baseline,
            "battery_rule_text": rule, "ranking": ranking, "drift": drift, "per_mission": per_mission, "summary": summary}
