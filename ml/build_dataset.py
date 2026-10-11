"""
Fixes which missions are used to train, test and "live"-check the failure-risk model, and writes them as a
dataset that can be published to the Hugging Face Hub.

    python ml/build_dataset.py                          # write ml/splits.json + ml/dataset/{train,test,live}.csv
    python ml/build_dataset.py --push                   # also upload to <your-username>/spot-mission-actions
    python ml/build_dataset.py --push --repo you/name   # choose the repo; HF_DATASET_REPO also works

Splits are by whole mission, never by single action, so no mission is in two sets:
  live   the last 4 IMPROVED (V2) missions by start time. The model never trains on them. They stream in during the
         demo, so the dashboard scores the model on them as they arrive: missions it has truly never seen.
  test   about 20% of the other missions (StratifiedGroupKFold, stratified on scenario x outcome, seed 42).
  train  the rest.

The split is written once and reused; delete ml/splits.json to draw it again. Uploading tags the dataset revision
(splits-v1), and train.py records which revision it used, so the model card can name its exact data.

Sign in first with `hf auth login` (stores the token outside the repo) or set HF_TOKEN.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.model_selection import StratifiedGroupKFold

from train import FEATURES, SEED, build_rows, load

ML = Path(__file__).resolve().parent
SPLITS = ML / "splits.json"
DATASET_DIR = ML / "dataset"
REPO_NAME = "spot-mission-actions"
REVISION = "splits-v1"
LIVE_MISSIONS = 4
COLUMNS = ["action_id", "mission_id", "scenario", *FEATURES, "failed"]


def make_splits() -> dict:
    missions = sorted(load("missions"), key=lambda m: m["start_time"])
    live = [m["mission_id"] for m in missions if m["scenario"] == "IMPROVED"][-LIVE_MISSIONS:]
    rows = [r for r in build_rows() if r["mission_id"] not in live]
    groups = np.array([r["mission_id"] for r in rows])
    strata = np.array([f"{r['scenario']}_{r['failed']}" for r in rows])
    train_idx, test_idx = next(StratifiedGroupKFold(5, shuffle=True, random_state=SEED).split(np.zeros(len(rows)), strata, groups))
    splits = {"train": sorted(set(groups[train_idx])), "test": sorted(set(groups[test_idx])), "live": live}
    return {
        "method": ("by mission; live = the last 4 IMPROVED missions by start time (never trained on, streamed in the "
                   "demo); test = 1 of 5 StratifiedGroupKFold folds of the rest (stratified on scenario x outcome, "
                   f"seed {SEED}); train = the remaining missions"),
        "seed": SEED, "revision": REVISION, **splits,
    }


def splits() -> dict:
    """The fixed split, drawn on first use."""
    if not SPLITS.exists():
        SPLITS.write_text(json.dumps(make_splits(), indent=2) + "\n")
    return json.loads(SPLITS.read_text())


def card(s: dict, counts: dict, repo_id: str) -> str:
    rows = "\n".join(f"| {name} | {c['missions']} | {c['actions']} | {c['failures']} | {c['by_configuration']} |"
                     for name, c in counts.items())
    return f"""---
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
Used by the failure-risk model [{repo_id.split('/')[0]}/spot-action-failure-risk](https://huggingface.co/{repo_id.split('/')[0]}/spot-action-failure-risk).

## Splits

{s['method']}.

| Split | Missions | Actions | Failures | Actions by configuration |
|---|---|---|---|---|
{rows}

- **V1** = BASELINE configuration, **V2** = IMPROVED configuration.
- `live` holds missions the model never trains on. In the dashboard demo they stream in as if Spot were sending them
  now, and the model is scored on each as it arrives.
- The split is fixed (revision `{s['revision']}`); the model card records the revision it was trained on.

```python
from datasets import load_dataset
ds = load_dataset("{repo_id}", revision="{s['revision']}")
```

## Columns

`action_id`, `mission_id`, `scenario`, then the model inputs {', '.join(f'`{f}`' for f in FEATURES)}, and the target `failed`.

## Limitations

Small (27 missions, 270 actions) and synthetic. It demonstrates the method, not real-robot performance.
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--push", action="store_true", help="upload to the Hugging Face Hub")
    parser.add_argument("--repo", default=os.environ.get("HF_DATASET_REPO"), help="repo id, e.g. you/spot-mission-actions")
    args = parser.parse_args()

    s = splits()
    rows = build_rows()
    DATASET_DIR.mkdir(exist_ok=True)
    counts = {}
    for name in ("train", "test", "live"):
        part = [r for r in rows if r["mission_id"] in s[name]]
        with open(DATASET_DIR / f"{name}.csv", "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(part)
        counts[name] = {"missions": len(s[name]), "actions": len(part), "failures": sum(r["failed"] for r in part),
                        "by_configuration": dict(sorted(Counter(r["configuration_version"] for r in part).items()))}
        print(f"{name:5} {counts[name]}  {', '.join(s[name])}")

    if not args.push:
        (DATASET_DIR / "README.md").write_text(card(s, counts, args.repo or f"<you>/{REPO_NAME}"), encoding="utf-8")
        print(f"wrote {DATASET_DIR} (add --push to upload)")
        return

    from huggingface_hub import HfApi
    api = HfApi()
    repo_id = args.repo or f"{api.whoami()['name']}/{REPO_NAME}"
    (DATASET_DIR / "README.md").write_text(card(s, counts, repo_id), encoding="utf-8")
    api.create_repo(repo_id, repo_type="dataset", exist_ok=True)
    api.upload_folder(repo_id=repo_id, repo_type="dataset", folder_path=DATASET_DIR,
                      commit_message=f"Spot actions, fixed splits ({s['revision']})")
    api.create_tag(repo_id, repo_type="dataset", tag=s["revision"], exist_ok=True)
    print(f"uploaded https://huggingface.co/datasets/{repo_id} (tag {s['revision']})")
    print(f"set HF_DATASET_REPO={repo_id} in backend/.env to link it from the dashboard")


if __name__ == "__main__":
    main()
