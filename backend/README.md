# SPOT Mission Dashboard API (Python)

FastAPI service that reads the lakehouse the [Java ingest API](../ingest-api/) writes to, and serves everything the
dashboard needs: inspection records, KPIs, insights, the AI assistant, the failure-risk model, and the Operator Console.

```
Java ingest API ──writes──▶ lakehouse (Databricks workspace.spot, or data/lakehouse CSVs)
       │                                   │ read + cached in memory
       └── webhook /ops/ingest-hook ──▶ this API ──▶ dashboard
```

## Run it

From the repo root, once:

```powershell
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env      # then set OPS_PIN (and an LLM key if you have one)
```

Then:

```powershell
cd backend
..\.venv\Scripts\python manage.py check          # where data comes from, what loads
..\.venv\Scripts\python -m uvicorn app.main:create_app --factory --reload --port 8000
```

Open http://localhost:8000/docs for interactive documentation of every endpoint.

**Where the data comes from:** Databricks when `DATABRICKS_HOST` is set (read from `ingest-api/.env`, so there is
nothing to copy); otherwise the local lakehouse `data/lakehouse/`; otherwise the raw kit `data/kit/`. The six tables
are loaded once and cached; they reload after every live mission (webhook) or on `POST /admin/refresh`.

**Live updates:** set `INGEST_WEBHOOK_URL=http://localhost:8000/ops/ingest-hook` in `ingest-api/.env` and the same
`INGEST_API_KEY` in both `.env` files. After each live mission the backend reloads, opens issues, marks alarms as
waiting for a decision, and saves an automatic snapshot.

## Endpoints

| Area | Method + path | What it returns |
|---|---|---|
| System | `GET /health` · `POST /admin/refresh` | Status, data source, model / LLM / ops status · reload the lakehouse now |
| Overview | `GET /summary` | Headline KPIs (all, V1, V2), latest mission, top 5 records needing action, ops stats |
| Missions | `GET /missions` · `/missions/{id}` · `/missions/{id}/replay` | Per-mission stats and headline · all its records · chronological events with x/y for animation |
| Records | `GET /records?mission=&waypoint=&asset=&status=&sensor=&part=&configuration=&floor=` · `/records/{action_id}` | Inspection Records: status (normal / watch / action), plain-English explanation, next step, evidence image, predicted risk |
| Map | `GET /waypoints?floor=` · `/waypoints/{id}` | Colour status (last 5 missions), failure rates by configuration, assets, predicted risk, open issues |
| 3D model | `GET /parts` · `/parts/{id}` | What each Spot part (thermal camera, PTZ camera, microphone, legs, radio, battery) measured |
| Equipment | `GET /assets` · `/assets/{id}` | Per-asset history and reading trend |
| Insights | `GET /insights` · `/compare` · `/kpis?scope=all\|V1\|V2` | Answers to the challenge's questions with evidence · V1 vs V2 with significance tests, mission-level 95% ranges and a like-for-like comparison (`detail`) · KPIs |
| Model | `GET /metrics` · `GET /model/live` · `POST /predict` | Train / test / live split and test metrics (overall and per configuration) · the model on never-seen live missions as they arrive, with a drift warning · failure risk for an action about to run |
| Live | `GET /live/script` | The IMPROVED missions as timed events, for the dashboard's sandbox mode |
| AI | `POST /ask` `{question, mode: simple\|technical, context}` | Answer citing record IDs, plus the sources used |
| Ops | see below | Operator Console |
| Images | `GET /static/maps/…` · `/static/inspection-images/…` | Floor plans and inspection images |

### Operator Console (`/ops`, turn off with `OPS_ENABLED=false`)

Reads are open. Writes need a token from `POST /ops/login {name, role: operator|supervisor, pin}`, sent as
`Authorization: Bearer <token>`.

| Method + path | Purpose |
|---|---|
| `GET /ops/issues?status=&severity=&location=&mission=&asset=&pending=&danger=&open_only=` | Issue queue: danger and waiting alarms first, then severity and asset criticality |
| `GET /ops/issues/{id}` · `PATCH /ops/issues/{id}` `{status?, assignee?, note}` | Issue with its full audit trail · change it (a note is always required; reopening needs a supervisor) |
| `GET /ops/alerts?pending=true` · `POST /ops/alerts/{anomaly_id}/decision` `{decision: OVERRIDE\|DANGER, note}` | Alarms waiting for a decision · "not a problem" (needs a reason) or "danger" |
| `GET /ops/kpis` · `GET /ops/activity?asset=&location=` | KPIs plus issue stats (MTTR, alarm response time) · activity feed |
| `GET /ops/snapshots` · `POST /ops/snapshots` `{label, note}` · `GET /ops/snapshots/{id}` | History timeline · save a snapshot · full KPIs |
| `GET /ops/snapshots/compare?a=&b=&scope_a=&scope_b=` | Every KPI marked improved ▲ / degraded ▼ (e.g. `scope_a=V1&scope_b=V2`) |
| `POST /ops/live/start` `{speed, pause_on_alarm}` · `/ops/live/{pause,resume,stop}` · `/ops/live/speed` · `/ops/live/reset` (supervisor) | Drive the presenter-mode live feed in the Java ingest API (`INGEST_URL`) |
| `POST /ops/ingest-hook` | Called by the Java ingest API: `mission_ingested` (refresh, issues, snapshot), `live_alert` (open an alarm mid-mission), `live_reset` (fresh Operator Console) |

With pause-on-alarm, deciding the last waiting alarm resumes the live feed automatically.

The audit trail (`issue_events`) and saved snapshots are protected by SQLite triggers: they can be added but never
edited or deleted. `python manage.py reset-ops` deletes the whole database for a fresh demo.

## How records are classified

| Status | When |
|---|---|
| **action** | HIGH or CRITICAL anomaly, an anomaly flagged for operator review, or a failed action on a CRITICAL asset |
| **watch** | Any other anomaly, a failed action, a QUESTIONABLE reading, or a reading outside its usual range |
| **normal** | Everything else |

"Usual range" is the 5th–95th percentile of GOOD readings with no anomaly, per measurement type.

## AI assistant

1. **Retrieval:** TF-IDF over about 450 documents: every inspection record, mission, waypoint, asset, Spot part,
   KPI set, insight and the V1 vs V2 comparison, plus the data dictionary, challenge docs and the Spot user guide.
   Record IDs in the question (`AN014`, `WP05`, `M020`) and the on-screen `context` are always included.
2. **Guardrail:** questions that mention nothing from this domain get "I don't have data on that." without an LLM call.
3. **Answer:** one LLM call that must answer only from the retrieved records and cite their IDs.
   - `anthropic`: Claude Opus 5.5 (`claude-opus-5-5`), effort `low`, with server-side refusal fallback enabled.
   - `huggingface`: `HF_CHAT_MODEL` (default `Qwen/Qwen3-235B-A22B-Instruct-2507` on `HF_PROVIDER=deepinfra`) through
     Hugging Face Inference Providers, falling back to `HF_FALLBACK_MODEL` (`meta-llama/Llama-3.1-8B-Instruct`) if it fails.
   - `none`, or if the call fails: the matching records are listed instead.
4. **Spend guard** (for paid inference on a public site): identical questions come from a cache; each visitor gets
   `ASK_PER_MINUTE` (6) and `ASK_PER_HOUR` (40) LLM answers; once this month's estimated spend reaches `ASK_BUDGET_USD` (5) the
   assistant lists records instead. Spend is estimated from each response's token counts and the router's public price list,
   kept in `ASK_SPEND_FILE` (`data/ask_spend.json`) and shown in `GET /health` as `ask_usage`.

## Failure-risk model

`ml/model.joblib` is loaded from disk at startup; the app never downloads it. The data is split once by mission into train,
test and live (`ml/splits.json`, written by `python ml/build_dataset.py`, which can also publish it as a Hugging Face dataset).
Retrain with `python ml/train.py`, and publish with `python ml/push_to_hub.py` (see [ml/MODEL_CARD.md](../ml/MODEL_CARD.md)).
The live missions are never trained on: `GET /model/live` scores the model on them as they stream in during the demo.

## Tests

```powershell
cd backend
..\.venv\Scripts\python -m pytest -q
```

They run on the kit data with a temporary database and no LLM, and check the KPIs against the kit's own
`validation_results.json`.
