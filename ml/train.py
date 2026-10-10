"""
Trains the Spot action-failure risk model once and writes ml/model.joblib + ml/metrics.json.

Question it answers: before Spot attempts an action, how likely is that action to fail?
Only facts known in advance are used (action type, waypoint, battery, configuration, asset),
so nothing that is measured during or after the action leaks into the features.

    python ml/train.py

Method (see TODO.md "P1: Model Training"):
  - 80/20 split by mission (no mission in both sets), stratified so both sets hold
    BASELINE and IMPROVED missions and failures; seed 42.
  - Candidates are compared with 5-fold grouped cross-validation on the training set only;
    the decision threshold and the battery-rule baseline are also fit on training data only.
  - The held-out 20% is scored once. The shipped model is then refit on all missions with the
    chosen settings; metrics.json reports the held-out numbers.
"""
from __future__ import annotations

import csv
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, average_precision_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "kit"
OUT = Path(__file__).resolve().parent
SEED = 42

CATEGORICAL = ["action_type", "location_id", "environment", "zone_type", "asset_type",
               "asset_criticality", "configuration_version"]
NUMERIC = ["battery_pct", "sequence", "floor"]
FEATURES = CATEGORICAL + NUMERIC


def load(name: str) -> list[dict]:
    with open(DATA / f"{name}.csv", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_rows():
    locations = {r["location_id"]: r for r in load("locations")}
    assets = {r["asset_id"]: r for r in load("assets")}
    rows = []
    for a in load("actions"):
        loc, asset = locations[a["location_id"]], assets[a["asset_id"]]
        rows.append({
            "action_id": a["action_id"], "mission_id": a["mission_id"], "scenario": a["scenario"],
            "action_type": a["action_type"], "location_id": a["location_id"],
            "environment": loc["environment"], "zone_type": loc["zone_type"],
            "asset_type": asset["asset_type"], "asset_criticality": asset["criticality"],
            "configuration_version": a["configuration_version"],
            "battery_pct": float(a["battery_pct"]), "sequence": float(a["sequence"]),
            "floor": float(loc["floor"]),
            "failed": int(a["status"] == "FAILED"),
        })
    return rows


def matrix(rows):
    return np.array([[r[c] for c in FEATURES] for r in rows], dtype=object)


def pipeline(estimator):
    columns = ColumnTransformer([
        ("categorical", OneHotEncoder(handle_unknown="ignore"), list(range(len(CATEGORICAL)))),
        ("numeric", StandardScaler(), list(range(len(CATEGORICAL), len(FEATURES)))),
    ])
    return Pipeline([("features", columns), ("model", estimator)])


CANDIDATES = {
    "logistic_regression": lambda: LogisticRegression(class_weight="balanced", C=0.5, max_iter=5000),
    "random_forest": lambda: RandomForestClassifier(n_estimators=400, min_samples_leaf=3,
                                                    class_weight="balanced_subsample", random_state=SEED),
}


def best_threshold(y, p):
    """Threshold that maximizes F1 on the given (training) predictions."""
    best = (0.5, -1.0)
    for t in np.unique(np.round(p, 4)):
        f = f1_score(y, p >= t, zero_division=0)
        if f > best[1]:
            best = (float(t), f)
    return best[0]


def scores(y, p, threshold):
    pred = (p >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    out = {
        "precision": precision_score(y, pred, zero_division=0),
        "recall": recall_score(y, pred, zero_division=0),
        "f1": f1_score(y, pred, zero_division=0),
        "accuracy": accuracy_score(y, pred),
        "confusion_matrix": {"true_negative": int(tn), "false_positive": int(fp),
                             "false_negative": int(fn), "true_positive": int(tp)},
    }
    if len(set(y)) > 1 and len(set(np.round(p, 6))) > 1:
        out["pr_auc"] = average_precision_score(y, p)
        out["roc_auc"] = roc_auc_score(y, p)
    return {k: (round(float(v), 4) if isinstance(v, float) else v) for k, v in out.items()}


def main():
    rows = build_rows()
    X, y = matrix(rows), np.array([r["failed"] for r in rows])
    groups = np.array([r["mission_id"] for r in rows])
    strata = np.array([f"{r['scenario']}_{r['failed']}" for r in rows])

    # 80/20 grouped + stratified split: the first of 5 folds is the held-out test set.
    train_idx, test_idx = next(StratifiedGroupKFold(5, shuffle=True, random_state=SEED).split(X, strata, groups))
    Xtr, ytr, gtr, str_ = X[train_idx], y[train_idx], groups[train_idx], strata[train_idx]
    Xte, yte = X[test_idx], y[test_idx]

    # 5-fold grouped CV on the training set only, for each candidate.
    cv = list(StratifiedGroupKFold(5, shuffle=True, random_state=SEED).split(Xtr, str_, gtr))
    cv_results, oof = {}, {}
    for name, make in CANDIDATES.items():
        p = np.zeros(len(ytr))
        fold_ap, fold_f1 = [], []
        for fit_i, val_i in cv:
            model = pipeline(make()).fit(Xtr[fit_i], ytr[fit_i])
            p[val_i] = model.predict_proba(Xtr[val_i])[:, 1]
            fold_ap.append(average_precision_score(ytr[val_i], p[val_i]))
        threshold = best_threshold(ytr, p)
        for _, val_i in cv:
            fold_f1.append(f1_score(ytr[val_i], p[val_i] >= threshold, zero_division=0))
        oof[name] = p
        cv_results[name] = {
            "pr_auc_mean": round(statistics.mean(fold_ap), 4), "pr_auc_std": round(statistics.stdev(fold_ap), 4),
            "f1_mean": round(statistics.mean(fold_f1), 4), "f1_std": round(statistics.stdev(fold_f1), 4),
            "threshold": round(threshold, 4),
        }
    chosen = max(cv_results, key=lambda n: cv_results[n]["pr_auc_mean"])
    threshold = cv_results[chosen]["threshold"]

    # Held-out test: chosen model vs. a battery rule vs. always predicting "will succeed".
    model = pipeline(CANDIDATES[chosen]()).fit(Xtr, ytr)
    p_test = model.predict_proba(Xte)[:, 1]
    battery_col = FEATURES.index("battery_pct")
    battery_tr = Xtr[:, battery_col].astype(float)
    # The rule flags low battery: score = -battery, threshold chosen on training data.
    rule_threshold = -best_threshold(ytr, -battery_tr)
    rule_test = (Xte[:, battery_col].astype(float) <= rule_threshold).astype(float)

    # Which inputs matter: permutation importance on the held-out set, per original column.
    imp = permutation_importance(model, Xte, yte, scoring="average_precision", n_repeats=30, random_state=SEED)
    importance = sorted(({"feature": f, "importance": round(float(m), 4)} for f, m in zip(FEATURES, imp.importances_mean)),
                        key=lambda d: -d["importance"])

    # Ship a model refit on every mission, with the same settings and threshold.
    final = pipeline(CANDIDATES[chosen]()).fit(X, y)
    start = time.perf_counter()
    for i in range(500):
        final.predict_proba(X[i % len(X): i % len(X) + 1])
    latency_ms = (time.perf_counter() - start) / 500 * 1000
    start = time.perf_counter()
    final.predict_proba(X)
    batch_ms = (time.perf_counter() - start) / len(X) * 1000

    p_all = final.predict_proba(X)[:, 1]
    risk_by_config = {v: round(float(p_all[[r["configuration_version"] == v for r in rows]].mean()), 4)
                      for v in sorted({r["configuration_version"] for r in rows})}

    trained_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    joblib.dump({
        "pipeline": final, "threshold": threshold, "categorical": CATEGORICAL, "numeric": NUMERIC,
        "features": FEATURES, "target": "action fails (status == FAILED)", "model_type": chosen,
        "sklearn_version": sklearn.__version__, "trained_at": trained_at,
    }, OUT / "model.joblib")

    metrics = {
        "model": "spot-action-failure-risk", "model_type": chosen, "trained_at": trained_at,
        "sklearn_version": sklearn.__version__,
        "target": "Will this action fail? (actions.status == FAILED), predicted before the action runs",
        "features": {"categorical": CATEGORICAL, "numeric": NUMERIC},
        "data": {
            "source": "Knight Hacks 2026 SPOT challenge kit (synthetic)",
            "actions": len(rows), "missions": len(set(groups)), "failures": int(y.sum()),
            "failure_rate": round(float(y.mean()), 4),
        },
        "split": {
            "method": "80/20 by mission (StratifiedGroupKFold, stratified on scenario x outcome), seed 42",
            "train_missions": sorted(set(gtr.tolist())), "test_missions": sorted(set(groups[test_idx].tolist())),
            "train_actions": len(train_idx), "test_actions": len(test_idx),
            "test_failures": int(yte.sum()),
        },
        "cross_validation": {"method": "5-fold StratifiedGroupKFold on the training set", "candidates": cv_results,
                             "selected": chosen, "selected_by": "highest mean PR-AUC"},
        "decision_threshold": threshold,
        "test": scores(yte, p_test, threshold),
        "baselines": {
            "battery_rule": {"rule": f"flag when battery_pct <= {rule_threshold:g}",
                             **scores(yte, rule_test, 0.5)},
            "always_predict_success": {"accuracy": round(float(1 - yte.mean()), 4), "recall": 0.0, "f1": 0.0},
        },
        "feature_importance": importance,
        "mean_predicted_risk_by_configuration": risk_by_config,
        "inference_latency_ms": {"single_action": round(latency_ms, 2),
                                 "per_action_in_a_batch": round(batch_ms, 3)},
        "shipped_model": "refit on all missions with the selected settings; test numbers above are from the held-out split",
    }
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")

    print(f"selected {chosen} (CV PR-AUC {cv_results[chosen]['pr_auc_mean']} ± {cv_results[chosen]['pr_auc_std']})")
    for n, r in cv_results.items():
        print(f"  cv {n:20} {r}")
    print("test  model  ", metrics["test"])
    print("test  battery", metrics["baselines"]["battery_rule"])
    print("importance   ", importance[:5])
    print("risk by config", risk_by_config, f"latency {latency_ms:.2f} ms single, {batch_ms:.3f} ms/action batched")


if __name__ == "__main__":
    main()
