---
library_name: sklearn
pipeline_tag: tabular-classification
tags:
- sklearn
- tabular-classification
- robotics
- boston-dynamics-spot
- predictive-maintenance
- knight-hacks
---

# Spot action failure-risk model

Predicts, **before** Boston Dynamics' Spot robot attempts an inspection action, how likely that action is to fail.
Built for the Knight Hacks 2026 SPOT Operational Intelligence Challenge, as part of the
[SPOT Mission Dashboard](https://github.com/Monisha-Repos/spot-mission-dashboard).

> ⚠️ Trained on **synthetic, fictional** challenge data (27 missions, 270 actions). It shows the
> method; it is not validated for real robots or facilities.

## What it predicts

- **Target:** Will this action fail? (actions.status == FAILED), predicted before the action runs
- **Model:** scikit-learn `logistic_regression` in a pipeline (one-hot encoding + scaling), decision threshold
  **0.5953** (chosen to maximize F1 on training data).
- **Inputs (all known before the action starts, so nothing leaks from the outcome):**
  - categorical: `action_type`, `location_id`, `environment`, `zone_type`, `asset_type`, `asset_criticality`, `configuration_version`
  - numeric: `battery_pct`, `sequence`, `floor`

## How it was evaluated

- Fixed split by mission, published as [Monisha-Natarajan/spot-mission-actions](https://huggingface.co/datasets/Monisha-Natarajan/spot-mission-actions)
  (revision `splits-v1`): by mission; live = the last 4 IMPROVED missions by start time (never trained on, streamed in the demo); test = 1 of 5 StratifiedGroupKFold folds of the rest (stratified on scenario x outcome, seed 42); train = the remaining missions.
- 180 training actions, 50 test actions (9 failures) from
  5 test missions, and 40 live actions from 4
  missions (M024, M025, M026, M027) that were never used. No mission is in two sets.
- Model choice, threshold and the baseline rule were fit on training data only (5-fold grouped cross-validation).
- The shipped model is refit on train + test with the same settings. The live missions stay unseen: the dashboard
  scores the model on them as they stream in during the demo.

| Held-out test | This model | Battery rule (flag when battery_pct <= 25) |
|---|---|---|
| Precision | 0.2778 | 0.3333 |
| Recall | 0.5556 | 0.1111 |
| F1 | **0.3704** | 0.1667 |
| PR-AUC | **0.4209** | 0.197 |
| ROC-AUC | 0.7073 | 0.5312 |

Cross-validation on the training missions: PR-AUC 0.5084 ± 0.1814, F1 0.4431 ± 0.0638.

By configuration (test set; V2 has few failures, so its numbers are very noisy):

| Configuration | Actions | Failures | Precision | Recall | F1 |
|---|---|---|---|---|---|
| V1 | 40 | 8 | 0.2778 | 0.625 | 0.3846 |
| V2 | 10 | 1 | 0.0 | 0.0 | 0.0 |

Confusion matrix (test): 5 failures caught, 4 missed, 13 false alarms,
28 correct "will succeed".

Accuracy is not the headline: always predicting "will succeed" already scores 0.82
because only 18% of actions fail.

### What drives the prediction (permutation importance on the test set, drop in PR-AUC)

| Feature | Importance |
|---|---|
| `battery_pct` | +0.1947 |
| `floor` | +0.0570 |
| `asset_type` | +0.0541 |
| `asset_criticality` | +0.0512 |
| `environment` | +0.0252 |
| `zone_type` | +0.0172 |
| `configuration_version` | +0.0154 |
| `action_type` | +0.0022 |
| `sequence` | -0.0060 |
| `location_id` | -0.0458 |

Battery level is by far the strongest signal. Average predicted risk is **46% for V1** actions and
**18% for V2**.

What-if: the 90 V2 actions scored as if they had run on V1 (same battery, waypoint and action)
average 13% risk, against 18% as V2. The configuration label on its own
does not lower predicted risk; most of the V1 to V2 difference comes with the conditions V2 ran in, chiefly battery level.

Inference: 2.13 ms for one action, 0.013 ms per action in a batch (laptop CPU).

## Limitations

- Very small, synthetic dataset; the test set has only 9 failures, so the test numbers are noisy.
  Compare it with the battery-rule baseline above rather than reading the numbers as absolute.
- Waypoints, assets and configurations outside the training data are encoded as "unknown".
- Not a safety system: use it to prioritize what to look at, not to skip inspections.

## Use

```python
import joblib, numpy as np
from huggingface_hub import hf_hub_download

bundle = joblib.load(hf_hub_download("Monisha-Natarajan/spot-action-failure-risk", "model.joblib"))
row = {"action_type": "NAVIGATION", "location_id": "WP05", "environment": "HIGH_NOISE", "zone_type": "MECHANICAL",
       "asset_type": "Heat Exchanger", "asset_criticality": "LOW", "configuration_version": "V2",
       "battery_pct": 35.0, "sequence": 1.0, "floor": 1.0}
X = np.array([[row[f] for f in bundle["features"]]], dtype=object)
risk = bundle["pipeline"].predict_proba(X)[0, 1]
print(f"failure risk {risk:.0%}", "FLAG" if risk >= bundle["threshold"] else "")
```

Requires scikit-learn 1.9.1. `model.joblib` is a pickle: only load pickles from sources you trust.
The dashboard itself loads its local copy and never downloads from the Hub.

## Reproduce

`python ml/train.py` in the project repo (seed 42) rebuilds `model.joblib` and `metrics.json` (both included here).
