"""
Publishes the trained model to a public Hugging Face Hub repo with a model card.
The app never downloads from the Hub; it always loads ml/model.joblib from the repo.

    python ml/push_to_hub.py --dry-run          # write ml/MODEL_CARD.md only, upload nothing
    python ml/push_to_hub.py                    # upload to <your-username>/spot-action-failure-risk
    python ml/push_to_hub.py --repo you/name    # choose the repo name

Sign in first with `hf auth login` (stores the token outside the repo) or set HF_TOKEN.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ML = Path(__file__).resolve().parent
REPO_NAME = "spot-action-failure-risk"
FILES = ["model.joblib", "metrics.json", "train.py"]


def model_card(m: dict, repo_id: str) -> str:
    t, b = m["test"], m["baselines"]["battery_rule"]
    cv = m["cross_validation"]["candidates"][m["model_type"]]
    cm = t["confusion_matrix"]
    importance = "\n".join(f"| `{f['feature']}` | {f['importance']:+.4f} |" for f in m["feature_importance"])
    risk = m["mean_predicted_risk_by_configuration"]
    return f"""---
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

> ⚠️ Trained on **synthetic, fictional** challenge data (27 missions, {m['data']['actions']} actions). It shows the
> method; it is not validated for real robots or facilities.

## What it predicts

- **Target:** {m['target']}
- **Model:** scikit-learn `{m['model_type']}` in a pipeline (one-hot encoding + scaling), decision threshold
  **{m['decision_threshold']}** (chosen to maximize F1 on training data).
- **Inputs (all known before the action starts, so nothing leaks from the outcome):**
  - categorical: {', '.join(f'`{c}`' for c in m['features']['categorical'])}
  - numeric: {', '.join(f'`{c}`' for c in m['features']['numeric'])}

## How it was evaluated

- {m['split']['method']}: {m['split']['train_actions']} training actions, {m['split']['test_actions']} test actions
  ({m['split']['test_failures']} failures) from {len(m['split']['test_missions'])} held-out missions. No mission is in both sets.
- Model choice, threshold and the baseline rule were fit on training data only (5-fold grouped cross-validation).
- The shipped model is refit on all missions with the same settings; the numbers below are from the held-out split.

| Held-out test | This model | Battery rule ({b['rule']}) |
|---|---|---|
| Precision | {t['precision']} | {b['precision']} |
| Recall | {t['recall']} | {b['recall']} |
| F1 | **{t['f1']}** | {b['f1']} |
| PR-AUC | **{t.get('pr_auc')}** | {b.get('pr_auc')} |
| ROC-AUC | {t.get('roc_auc')} | {b.get('roc_auc')} |

Cross-validation on the training missions: PR-AUC {cv['pr_auc_mean']} ± {cv['pr_auc_std']}, F1 {cv['f1_mean']} ± {cv['f1_std']}.

Confusion matrix (test): {cm['true_positive']} failures caught, {cm['false_negative']} missed, {cm['false_positive']} false alarms,
{cm['true_negative']} correct "will succeed".

Accuracy is not the headline: always predicting "will succeed" already scores {m['baselines']['always_predict_success']['accuracy']}
because only {m['data']['failure_rate']:.0%} of actions fail.

### What drives the prediction (permutation importance on the test set, drop in PR-AUC)

| Feature | Importance |
|---|---|
{importance}

Battery level is by far the strongest signal. Average predicted risk is **{risk.get('V1', 0):.0%} for V1** actions and
**{risk.get('V2', 0):.0%} for V2**, matching the improvement seen in the data.

Inference: {m['inference_latency_ms']['single_action']} ms for one action, {m['inference_latency_ms']['per_action_in_a_batch']} ms per action in a batch (laptop CPU).

## Limitations

- Very small, synthetic dataset; the test set has only {m['split']['test_failures']} failures, so the test numbers are noisy.
  The model only modestly beats a one-line battery rule.
- Waypoints, assets and configurations outside the training data are encoded as "unknown".
- Not a safety system: use it to prioritize what to look at, not to skip inspections.

## Use

```python
import joblib, numpy as np
from huggingface_hub import hf_hub_download

bundle = joblib.load(hf_hub_download("{repo_id}", "model.joblib"))
row = {{"action_type": "NAVIGATION", "location_id": "WP05", "environment": "HIGH_NOISE", "zone_type": "MECHANICAL",
       "asset_type": "Heat Exchanger", "asset_criticality": "LOW", "configuration_version": "V2",
       "battery_pct": 35.0, "sequence": 1.0, "floor": 1.0}}
X = np.array([[row[f] for f in bundle["features"]]], dtype=object)
risk = bundle["pipeline"].predict_proba(X)[0, 1]
print(f"failure risk {{risk:.0%}}", "FLAG" if risk >= bundle["threshold"] else "")
```

Requires scikit-learn {m['sklearn_version']}. `model.joblib` is a pickle: only load pickles from sources you trust.
The dashboard itself loads its local copy and never downloads from the Hub.

## Reproduce

`python ml/train.py` in the project repo (seed 42) rebuilds `model.joblib` and `metrics.json` (both included here).
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", help=f"repo id, default <your-username>/{REPO_NAME}")
    parser.add_argument("--dry-run", action="store_true", help="write ml/MODEL_CARD.md and stop")
    args = parser.parse_args()

    metrics = json.loads((ML / "metrics.json").read_text())
    for name in FILES:
        if not (ML / name).exists():
            raise SystemExit(f"missing ml/{name}; run python ml/train.py first")

    from huggingface_hub import HfApi
    api = HfApi()
    repo_id = args.repo
    if not repo_id:
        if args.dry_run:
            repo_id = f"<your-username>/{REPO_NAME}"
        else:
            repo_id = f"{api.whoami()['name']}/{REPO_NAME}"
    card = model_card(metrics, repo_id)
    (ML / "MODEL_CARD.md").write_text(card, encoding="utf-8")
    print(f"wrote ml/MODEL_CARD.md for {repo_id}")
    if args.dry_run:
        return

    api.create_repo(repo_id, repo_type="model", private=False, exist_ok=True)
    for name in FILES:
        api.upload_file(path_or_fileobj=str(ML / name), path_in_repo=name, repo_id=repo_id,
                        commit_message=f"Upload {name}")
    api.upload_file(path_or_fileobj=card.encode("utf-8"), path_in_repo="README.md", repo_id=repo_id,
                    commit_message="Model card")
    print(f"published https://huggingface.co/{repo_id}")


if __name__ == "__main__":
    main()
