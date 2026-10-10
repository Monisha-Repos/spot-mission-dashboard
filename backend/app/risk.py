"""Loads ml/model.joblib from disk at startup. The app never downloads the model from the Hugging Face Hub."""
from __future__ import annotations

import json
import logging
from pathlib import Path

import joblib
import numpy as np
import sklearn

log = logging.getLogger(__name__)


class RiskModel:
    def __init__(self, bundle: dict, metrics: dict | None):
        self.pipeline = bundle["pipeline"]
        self.threshold = float(bundle["threshold"])
        self.features: list[str] = bundle["features"]
        self.info = {k: bundle[k] for k in ("model_type", "target", "trained_at", "sklearn_version", "features")}
        self.info["threshold"] = self.threshold
        self.metrics = metrics

    @classmethod
    def load(cls, model_path: Path, metrics_path: Path) -> "RiskModel | None":
        if not model_path.exists():
            log.warning("no risk model at %s (run: python ml/train.py); predictions are disabled", model_path)
            return None
        bundle = joblib.load(model_path)
        if bundle.get("sklearn_version") != sklearn.__version__:
            log.warning("model was trained with scikit-learn %s but %s is installed; retrain with ml/train.py",
                        bundle.get("sklearn_version"), sklearn.__version__)
        metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else None
        return cls(bundle, metrics)

    @staticmethod
    def features_from_record(record: dict) -> dict:
        return {
            "action_type": record["action_type"], "location_id": record["location"]["id"],
            "environment": record["location"]["environment"], "zone_type": record["location"]["zone_type"],
            "asset_type": record["asset"]["type"], "asset_criticality": record["asset"]["criticality"],
            "configuration_version": record["configuration_version"],
            "battery_pct": float(record["battery_pct"]), "sequence": float(record["sequence"]),
            "floor": float(record["location"]["floor"]),
        }

    def predict(self, rows: list[dict]) -> list[float]:
        if not rows:
            return []
        X = np.array([[row[f] for f in self.features] for row in rows], dtype=object)
        return [round(float(p), 4) for p in self.pipeline.predict_proba(X)[:, 1]]

    def predict_records(self, records: list[dict]) -> list[float]:
        return self.predict([self.features_from_record(r) for r in records])
