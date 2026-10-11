---
license: cc-by-4.0
pretty_name: Spot inspection actions (synthetic)
task_categories:
- tabular-classification
tags:
- robotics
- boston-dynamics-spot
- predictive-maintenance
- synthetic
- knight-hacks
configs:
- config_name: default
  data_files:
  - split: train
    path: train.csv
  - split: test
    path: test.csv
  - split: live
    path: live.csv
---

# Spot inspection actions: fixed train / test / live splits

One row per inspection action Spot attempted in the Knight Hacks 2026 SPOT challenge kit (synthetic, fictional data).
Target: `failed` (1 when the action's status was FAILED). Every feature is known **before** the action runs.
Used by the failure-risk model [<you>/spot-action-failure-risk](https://huggingface.co/<you>/spot-action-failure-risk).

## Splits

by mission; live = the last 4 IMPROVED missions by start time (never trained on, streamed in the demo); test = 1 of 5 StratifiedGroupKFold folds of the rest (stratified on scenario x outcome, seed 42); train = the remaining missions.

| Split | Missions | Actions | Failures | Actions by configuration |
|---|---|---|---|---|
| train | 18 | 180 | 35 | {'V1': 140, 'V2': 40} |
| test | 5 | 50 | 9 | {'V1': 40, 'V2': 10} |
| live | 4 | 40 | 5 | {'V2': 40} |

- **V1** = BASELINE configuration, **V2** = IMPROVED configuration.
- `live` holds missions the model never trains on. In the dashboard demo they stream in as if Spot were sending them
  now, and the model is scored on each as it arrives.
- The split is fixed (revision `splits-v1`); the model card records the revision it was trained on.

```python
from datasets import load_dataset
ds = load_dataset("<you>/spot-mission-actions", revision="splits-v1")
```

## Columns

`action_id`, `mission_id`, `scenario`, then the model inputs `action_type`, `location_id`, `environment`, `zone_type`, `asset_type`, `asset_criticality`, `configuration_version`, `battery_pct`, `sequence`, `floor`, and the target `failed`.

## Limitations

Small (27 missions, 270 actions) and synthetic. It demonstrates the method, not real-robot performance.
