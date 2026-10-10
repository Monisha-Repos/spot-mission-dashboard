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
- **Model:** scikit-learn `random_forest` in a pipeline (one-hot encoding + scaling), decision threshold
  **0.5133** (chosen to maximize F1 on training data).
- **Inputs (all known before the action starts, so nothing leaks from the outcome):**
  - categorical: `action_type`, `location_id`, `environment`, `zone_type`, `asset_type`, `asset_criticality`, `configuration_version`
  - numeric: `battery_pct`, `sequence`, `floor`

## How it was evaluated

- 80/20 by mission (StratifiedGroupKFold, stratified on scenario x outcome), seed 42: 220 training actions, 50 test actions
  (9 failures) from 5 held-out missions. No mission is in both sets.
- Model choice, threshold and the baseline rule were fit on training data only (5-fold grouped cross-validation).
- The shipped model is refit on all missions with the same settings; the numbers below are from the held-out split.

| Held-out test | This model | Battery rule (flag when battery_pct <= 32) |
|---|---|---|
| Precision | 0.4444 | 0.3636 |
| Recall | 0.4444 | 0.4444 |
| F1 | **0.4444** | 0.4 |
| PR-AUC | **0.3247** | 0.2616 |
| ROC-AUC | 0.6694 | 0.6369 |

Cross-validation on the training missions: PR-AUC 0.5053 ± 0.1293, F1 0.4438 ± 0.1753.

Confusion matrix (test): 4 failures caught, 5 missed, 5 false alarms,
36 correct "will succeed".

Accuracy is not the headline: always predicting "will succeed" already scores 0.82
because only 18% of actions fail.

### What drives the prediction (permutation importance on the test set, drop in PR-AUC)

| Feature | Importance |
|---|---|
| `battery_pct` | +0.0518 |
| `configuration_version` | +0.0063 |
| `location_id` | +0.0031 |
| `asset_type` | +0.0020 |
| `environment` | -0.0010 |
| `asset_criticality` | -0.0075 |
| `floor` | -0.0082 |
| `zone_type` | -0.0083 |
| `sequence` | -0.0122 |
| `action_type` | -0.1015 |

Battery level is by far the strongest signal. Average predicted risk is **38% for V1** actions and
**21% for V2**, matching the improvement seen in the data.

Inference: 20.77 ms for one action, 0.098 ms per action in a batch (laptop CPU).

## Limitations

- Very small, synthetic dataset; the test set has only 9 failures, so the test numbers are noisy.
  The model only modestly beats a one-line battery rule.
- Waypoints, assets and configurations outside the training data are encoded as "unknown".
- Not a safety system: use it to prioritize what to look at, not to skip inspections.

## Use

```python
import joblib, numpy as np
from huggingface_hub import hf_hub_download

bundle = joblib.load(hf_hub_download("<your-username>/spot-action-failure-risk", "model.joblib"))
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
