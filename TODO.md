# TODO: Knight Hacks

## ⏰ Plan 
### Saturday (10/11)
finish all coding!
**High Priority**
[ ]
[ ]
**Medium Priority**
[ ]
[ ]
**Low Priority**
[ ]
[ ]
[ ]

### Sunday (10/11)
deploy to custom domain
create demo video - funny, simple, short
judging prep - knowing context, code, advantages (how it stands out), limitations, future improvements, AI as a coding orchestrater
final touches
devpost submission by **10 AM**
final commit, make repository public by **11 AM**

*Never push secrets: Databricks tokens, LLM API keys, and `.env` files stay out of git. Check `git log -p` for keys before the repo goes public.*

*Remove committed `.DS_Store` files before the repo goes public.*

## Coding TODO



## 💡 Product Vision

Two public tabs and one AI assistant shared by both, plus a separate **Operator Console** module behind a sign-in (see below).

```
┌──────────────────────────────────────────────────────────────┐
│  [ Overview ]  [ Data Scientist ]  [ Operator  ] spotat.work │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                  3D SPOT model (rotate / zoom)               │
│        click a part → camera zooms in → that part's data     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│        ______ Floor 2 ______    inclined (isometric) map     │
│      ______ Floor 1 ______ [ Floor 1 | Floor 2 ] toggle      │
│                             animated swap between floors     │
│                                                    ┌──────┐  │
│                                                    │  AI  │  │
└────────────────────────────────────────────────────┴──────┴──┘
```

### Tab 1: Overview (landing page, for the average user)
- **3D SPOT model** as the hero. Users rotate it and click a part to zoom in and see what that part measured, in plain language.
- **Inclined map of both floors** below the model. A toggle animates between Floor 1 (WP01–WP10) and Floor 2 (WP11–WP15). Waypoints are colored 🟢 / 🟡 / 🔴 by status.
- **AI chat popup** in the bottom-right corner, answering in simple language.

**What each SPOT part maps to in the data:**

| SPOT part | Data it explains | Source |
|---|---|---|
| Thermal camera (Spot CAM+IR) | `TEMPERATURE_C` readings, `ABNORMAL_TEMPERATURE` anomalies | readings, anomalies |
| PTZ / visual camera | `VISUAL_SCORE`, gauge `PRESSURE_PSI`, `VISUAL_DEFECT`, `GAUGE_OUT_OF_RANGE`, `TARGET_NOT_DETECTED` | readings, anomalies, actions |
| Microphone / acoustic sensor | `SOUND_DB`, `ABNORMAL_VIBRATION` | readings, anomalies |
| Body stereo cameras + legs | Navigation: `LOCALIZATION_CONFIDENCE_PCT`, `OBSTACLE_DETECTION`, `PATH_BLOCKED`, `LOCALIZATION_FAILURE` | readings, actions |
| Radio / comms payload | `COMMUNICATION_LOSS`, `SIGNAL_NOISE`, `SIGNAL_DEGRADATION` | actions, anomalies |
| Battery | `battery_pct` across a mission, start vs end battery | actions, missions |

### Tab 2: Data Scientist (for technical users, no visualizations)
- Full tables: missions, actions, readings, anomalies, with sorting and filters
- Raw numbers and outcomes: success/failure rates, BASELINE vs IMPROVED (V1 vs V2), failure types per waypoint
- Model performance: precision, recall, F1, PR-AUC, confusion matrix, cross-validation results
- **Same AI popup**, switched to technical mode (exact numbers, field names, IDs)
- **Generate PDF button**: snapshot of the current dashboard results with a timestamp, for archiving

### Module: Operator Console (sign-in required, for the employee who acts on issues)
The Overview and Data Scientist tabs **show** what happened. The Operator Console is where an employee **does something about it**, and where you can see whether things are getting better. It answers the brief's questions *"What requires attention?"*, *"What should an operator investigate next?"* and *"Is performance improving or degrading?"*

**Kept separate on purpose:**
- It has its own backend package (`backend/ops/`), its own frontend folder (`frontend/src/modules/ops/`) and its own SQLite file (`data/ops.db`).
- It **reads** the shared Inspection Records but **never changes the source CSVs**. Everything an operator does goes into `ops.db`.
- Nothing else depends on it. If it breaks, the Overview and Data Scientist tabs still work. It can be turned off with one flag (`OPS_ENABLED`).

**Authority (who can act):**
- A simple sign-in with a name, a role (`operator` / `supervisor`) and a shared PIN from `.env`. That's enough for a hackathon. Say in the Devpost that real deployments would use SSO.
- Public tabs are read-only. Only signed-in users can change an issue's status or save a snapshot.
- Every write records **who** made it and **when**.

**1. Issue queue (handle raised errors)**
- Issues are created from `anomalies.csv` (40) and from failed actions in `actions.csv` (`status = FAILED`, with a `failure_type`). Each issue links back to its mission, action, waypoint and asset.
- Sort order: severity first, then asset `criticality`, then whether `operator_review_required` is set.
- Lifecycle:
  ```
  OPEN → ACKNOWLEDGED → IN_PROGRESS → RESOLVED
                    ↘                ↘ FALSE_ALARM
  (RESOLVED or FALSE_ALARM can be REOPENED)
  ```
- Each change needs a short note, and an assignee is optional. FALSE_ALARM requires a reason, and those reasons feed the "confirmed vs false alarm" record promised in the README.
- **Audit trail is append-only.** Every change adds an `issue_events` row (`from_status → to_status`, who, when, note). Rows are never edited or deleted, so the full history of every issue can be shown.

**2. Snapshots (freeze current SPOT performance)**
- A **Save snapshot** button computes the KPIs below right now and stores them, read-only, with a label, a note, the author, a timestamp and the scope (all data, V1 only, V2 only, or a mission range).
- KPIs in each snapshot:

  | KPI | Source |
  |---|---|
  | Mission completion % | missions |
  | Action success % (overall and per `action_type`) | actions |
  | Failure rate per waypoint (e.g. WP05 navigation: 28%) | actions |
  | Anomalies by severity and type | anomalies |
  | Open / resolved / false-alarm issue counts | ops.db |
  | Mean time to resolve (MTTR) | issue_events |
  | Average battery drain per mission | missions |
  | Reading quality mix (GOOD vs other) | readings |
- The existing **Generate PDF** button should export a snapshot so both features share one code path.

**3. History (is it improving?)**
- A timeline of every snapshot, with a line chart per KPI across snapshots.
- **Compare two snapshots**: a delta table where each KPI shows ▲ improved (green) or ▼ degraded (red). Direction depends on the KPI: a lower failure rate is better, a higher success rate is better.
- An activity feed per issue and per asset, e.g. "PUMP-205: 3 issues raised, 2 resolved, 1 false alarm."
- **How the history fills during the demo:** the lakehouse starts with **only the 18 BASELINE missions** (M001–M018). On first run, save one `auto-seeded` snapshot per baseline mission day, so the chart already has a V1 history. The 9 IMPROVED missions (M019–M027) then arrive **live** through the Java ingest API (see below). After each one arrives, an automatic snapshot is saved, so the chart climbs in front of the judges (action success 77.2% → 91.1%). Snapshots store KPIs for **all data and per `configuration_version`**, so "before vs after" compares V1 with V2 rather than a blend of both.

**4. Live alarm (pop-up that must be answered)**
When a live mission brings in an anomaly that is HIGH or CRITICAL, or has `operator_review_required = True`, every open dashboard tab shows a full-screen alarm that stays up until someone makes a decision. In the kit's IMPROVED data that happens 5 times across 9 missions (M020, M022, M024, M025, M027).
- **How it gets there:** the frontend opens `EventSource(INGEST_URL + "/events")`. Each `mission_ingested` event already includes its `alerts[]` (the anomaly plus the reading that triggered it), so the pop-up appears with no extra request. The data views also refresh on every event, so new missions show up live.
- **Sound:** a two-tone siren made with the Web Audio API (alternating 600 Hz and 900 Hz every 0.4 s, looping until a decision). No audio file is needed. Browsers block sound until the page has been clicked, so show an **"Arm alarms 🔊"** button on load and click it at the start of the demo. A **Mute** button stops the sound but keeps the pop-up.
- **What it shows:** a red flashing border; severity and type in large text ("CRITICAL · ABNORMAL TEMPERATURE"); asset name and criticality; waypoint name and floor; the reading compared with normal ("41.4 °C"); the time and mission; a **floor-plan crop with the waypoint pulsing** (x/y from `locations.csv`); and a **picture of the situation** from `04_ASSETS/sample_inspection_images`, labelled as a reference image:

  | anomaly_type | image |
  |---|---|
  | ABNORMAL_TEMPERATURE | `thermal_pump_bearing_01.jpg` |
  | ABNORMAL_VIBRATION | `acoustic_valve_01.jpg` |
  | GAUGE_OUT_OF_RANGE | `gauge_pressure_01.jpg` |
  | VISUAL_DEFECT | `visual_pump_motor_01.jpg` |
  | NAVIGATION_OBSTRUCTION, LOCALIZATION_ISSUE, SIGNAL_DEGRADATION | `pipe_gallery_01.jpg` |
- **Can't be dismissed:** there's no ✕, and Esc or clicking outside does nothing. The only two ways out are:
  - **✅ Not a problem (override)**: needs a short reason, and the issue becomes FALSE_ALARM.
  - **🚨 Mark as danger**: the issue becomes IN_PROGRESS, marked `danger`, and goes to the top of the queue.

  Both need a signed-in operator. If nobody is signed in, the PIN prompt appears inside the pop-up.
- If several alerts are waiting, they queue and the pop-up shows "1 of 3". If a dashboard was closed when an alert arrived, it loads undecided alerts from `GET /ops/alerts?pending=true` on startup, so nothing gets missed.
- Decisions go into the same append-only `issue_events` log. Response time (from alert to decision) becomes a snapshot KPI: **median time to respond to alarms**.

**Data model (`ops.db`):**
```
issues(issue_id, source_type[ANOMALY|FAILED_ACTION], source_id, mission_id, location_id,
       asset_id, severity, title, status, assignee, created_at, updated_at)
issue_events(event_id, issue_id, from_status, to_status, note, actor, actor_role, at)   -- append-only
snapshots(snapshot_id, label, note, scope, kpis_json, created_by, created_at, auto_seeded)
```

**API (everything under `/ops`, and writes require the sign-in token):**
| Method | Path | Purpose |
|---|---|---|
| POST | `/ops/login` | name + role + PIN → token |
| GET | `/ops/issues?status=&severity=&location=` | issue queue |
| GET | `/ops/issues/{id}` | issue + linked records + full event history |
| PATCH | `/ops/issues/{id}` | change status / assignee, with a note (writes an `issue_events` row) |
| GET | `/ops/kpis?scope=` | live KPIs (same function the snapshots use) |
| POST | `/ops/snapshots` | save a snapshot |
| GET | `/ops/snapshots` | snapshot timeline |
| GET | `/ops/snapshots/compare?a=&b=` | KPI deltas, each marked improved / degraded |
| POST | `/ops/ingest-hook` | called by the Java API after each live mission: refresh cache, open issues, mark alarm ones `pending_decision`, save the auto snapshot |
| GET | `/ops/alerts?pending=true` | alarms still waiting for a decision |
| POST | `/ops/alerts/{anomaly_id}/decision` | `{decision: OVERRIDE \| DANGER, note}` → issue status + `issue_events` row |

**AI hook (optional):** expose `/ops/snapshots/compare` and open issues to the assistant, so it can answer *"What changed since the last snapshot?"* or *"What's still open on WP05?"*

### AI Assistant (both tabs)
- One RAG backend, two answer styles chosen by the active tab: **simple** (Overview) or **technical** (Data Scientist)
- Knows what the user is looking at (selected SPOT part, floor, or waypoint) and passes that in as context
- Cites the records it used (mission / anomaly / waypoint IDs)

### UI / UX
- **Light mode** only
- Accent colors from SPOT's palette (yellow + black/charcoal). Exact hex values are TBD. Define them as CSS variables so they can be swapped in one place:
  ```css
  :root { --spot-yellow: #FFC20E; /* TBD */ --spot-black: #1A1A1A; --bg: #FAFAF7; }
  ```
- Status colors stay standard (green / amber / red) so they never clash with the SPOT yellow accent

---


## 📝 Judging Prep


## 🎯 Prioritized Task List

Priority key: **P0** = must ship · **P1** = high value, should ship · **P2** = nice to have · **P3** = stretch goal

### P0: Data + API Foundation
- [x] Load all CSVs into one Inspection Record schema (see README); replay is rebuilt from actions so live missions replay too — `backend/app/records.py`
- [x] Status classification (Normal / Watch / Action) + plain-English explanations — `backend/app/records.py`
- [x] API endpoints: missions, records, per-SPOT-part summary, per-waypoint summary, metrics — see `backend/README.md`
- [x] BASELINE vs IMPROVED (V1 vs V2) comparison with significance tests — `GET /compare`

### P0: Overview Tab (landing page)
- [ ] 3D SPOT model loaded in React Three Fiber (`@react-three/fiber` + `@react-three/drei`) — _owner:_
- [ ] Clickable hotspots on each part (table above) → camera zooms in (drei `CameraControls`) → info panel with that part's data in plain language — _owner:_
- [ ] Inclined map: both floor plans as tilted planes (CSS 3D `rotateX/rotateZ` or R3F planes), waypoints from `locations.csv` x/y — _owner:_
- [ ] Floor 1 ↔ Floor 2 toggle with an animated swap (Framer Motion or `react-spring`) — _owner:_
- [ ] Waypoint markers colored by status; click one for its readings — _owner:_

> **3D model source:** look for a SPOT glTF/GLB with a license that allows reuse (Sketchfab CC-BY, or meshes from Boston Dynamics' open-source `spot_description` package). Credit it in the README. **Fallback:** a stylized low-poly SPOT made from boxes and cylinders still works, because the hotspots are what matter. Decide in Phase 0 so nobody blocks on it.

### P0: AI Assistant (popup, both tabs)
- [x] RAG pipeline over the data dictionary, challenge docs, SPOT user guide and per-record / mission / waypoint / asset summaries (TF-IDF retrieval, ~450 docs) — `backend/app/assistant.py`
- [x] `/ask` endpoint: retrieve top-k → LLM (Claude or Hugging Face, switchable) → answer citing IDs. Takes `mode` and `context`
- [ ] Bottom-right popup chat component, shared by both tabs — _owner:_
- [x] Guardrail: off-topic questions get "I don't have data on that" without an LLM call

**Keep it simple:** in-memory vector store (FAISS / Chroma) + one LLM call. Don't build an agent framework at a hackathon.

### P1: Data Scientist Tab
- [ ] Tab switch in the header (Overview ↔ Data Scientist); remember the last tab — _owner:_
- [ ] Sortable/filterable tables for missions, actions, readings, anomalies — _owner:_
- [ ] Outcome numbers: success rates, failure types per waypoint, V1 vs V2 — _owner:_
- [ ] Model metrics panel (reads `ml/metrics.json`) — _owner:_
- [ ] AI popup in `technical` mode — _owner:_
- [ ] **Generate PDF**: timestamped snapshot of the current results (`jsPDF` + `jspdf-autotable` for tables; filename like `spot-report-2026-10-11T08-30.pdf`) — _owner:_

### P1: Operator Console Module (see the Product Vision spec)
- [x] `backend/app/ops/`: SQLite schema (`issues`, append-only `issue_events`, `snapshots`) + issues from anomalies and failed actions
- [x] Shared `compute_kpis(scope)` function, used by `/kpis`, `/ops/kpis` and snapshots (the PDF export can call `/ops/snapshots/{id}`)
- [x] `/ops/*` endpoints + PIN sign-in, with writes rejected unless signed in
- [x] Seed snapshot history from the BASELINE missions only (one per mission day); auto-snapshot after each live mission via `/ops/ingest-hook`
- [x] `/ops/alerts` + decision endpoint; time-to-respond KPI
- [ ] Frontend: full-screen live alarm (EventSource on `/events`, Web Audio siren, Arm/Mute buttons, inspection image + pulsing floor-plan crop, override vs danger, "1 of N" queue) — _owner:_
- [ ] Frontend `modules/ops/`: issue queue with filters, issue detail with status buttons, note box and audit timeline — _owner:_
- [ ] Frontend: Save snapshot button, snapshot timeline chart, compare-two-snapshots table (▲/▼) — _owner:_
- [x] `OPS_ENABLED` flag; the other endpoints still work with the module off

### P0: Java Live Ingest API (`ingest-api/`) ✅ built
Plain JDK 17 with no dependencies; see [ingest-api/README.md](ingest-api/README.md). It's the only way new data gets into the lakehouse.
- [x] `seed --reset`: lakehouse = locations + assets + the 18 BASELINE missions
- [x] `POST /ingest/missions`: validates a mission bundle (types, required fields, links to the mission, actions, locations and assets, no duplicates) and appends it. Nothing is written if anything fails.
- [x] `GET /events` (Server-Sent Events): pushes `mission_ingested` with `alerts[]` to every dashboard
- [x] `feed --delay 8`: replays the 9 IMPROVED missions through the API as if SPOT were sending them live
- [x] Two storage targets: Databricks Delta (Statement Execution API) or local CSVs in `data/lakehouse/` (offline fallback, same format as the kit)
- [x] Optional `INGEST_API_KEY` for writes, and `INGEST_WEBHOOK_URL` → `/ops/ingest-hook`
- [x] Python backend reads the **lakehouse** (Databricks or `data/lakehouse/`) and reloads after each live mission
- [ ] Deploy next to the backend (Render / Railway: `javac` build, `java -cp out work.spotat.ingest.Main serve`) — _owner:_
- [x] Tested against the real Databricks Free Edition workspace (`workspace.spot`)

### P1: Model Training, Testing & Efficiency Numbers
Judges trust numbers. Shown in the Data Scientist tab.

- [x] **Split the data 80/20** by mission — `ml/train.py`
- [x] Train the failure-risk model on the training set only (random forest, chosen over logistic regression by CV)
- [x] Report metrics on the held-out test set → `ml/metrics.json`; model card in `ml/MODEL_CARD.md`
- [ ] Add a "Model performance" section to the Devpost and README — _owner:_

**Why 80/20 and not 70/30:** the dataset is small (27 missions, 270 actions, 220 readings, **only 40 anomalies**). A 70/30 split leaves too few anomalies to train on, while 80/20 still leaves about 8 for testing. Use cross-validation on top of the split to get stable numbers.

**How to split (avoid data leakage):**
1. **Split by mission, not by row.** All actions and readings from one mission go into the same set. Otherwise the model sees the mission it is tested on. (`GroupShuffleSplit` or `GroupKFold` with `groups=mission_id`.)
2. **Stratify** so both sets contain BASELINE and IMPROVED missions and some anomalies.
3. **Optional, and most realistic:** split by time. Train on earlier missions and test on the latest ~20%, which mirrors predicting future missions.
4. Fix a seed (`random_state=42`) so the numbers can be reproduced.
5. Fit scalers and thresholds on the **training set only**.

**Efficiency numbers to report:**

| Metric | Why it matters |
|---|---|
| Precision | How many flags were real anomalies (false alarms erode operator trust) |
| Recall | How many real anomalies were caught (missed issues are dangerous) |
| F1 score | One number balancing precision and recall |
| PR-AUC | Better than accuracy on imbalanced data (few anomalies) |
| Confusion matrix | Shows the error types visually |
| 5-fold grouped CV mean ± std | Shows results aren't a lucky split |
| Baseline comparison | Model vs. a simple threshold rule, which shows the model adds value |
| Inference latency (ms per reading) | Shows it can run live while SPOT walks |

> ⚠️ Don't headline **accuracy**. With ~15% anomalies, a model that predicts "normal" every time scores ~85%.

### P1: GoDaddy Domain (`spotat.work`)
- [ ] Register `spotat.work` (check MLH / GoDaddy hackathon promo codes first) — _owner:_
- [ ] Deploy the frontend (Vercel / Netlify) and backend (Render / Railway); point DNS at them — _owner:_
- [ ] Turn on HTTPS and confirm the site loads on a phone — _owner:_
- [ ] Put the live link in the Devpost and README — _owner:_
- [ ] Submit to the GoDaddy / domain prize track on Devpost, if one exists — _owner:_

> DNS can take a while to propagate. **Do this tonight**, not at 9 AM.

### P2: Databricks Data Layer (relational + non-relational)
- [x] Load the CSVs into **Delta tables** with `ingest-api` (`SINK=databricks`, `seed --reset`). Only BASELINE goes in at the start; IMPROVED arrives live.
- [ ] Store `replay.ndjson` events and inspection images as **semi-structured / volume data**. This is the non-relational layer. — _owner:_
- [ ] Run model training in a Databricks notebook and log metrics with MLflow — _owner:_
- [x] Backend reads from Databricks, with a **local CSV fallback** (`SINK=local`, switched by hand)
- [ ] Add an architecture diagram to the Devpost — _owner:_

> Risk: setup, auth, and cluster spin-up time. Timebox it to ~3 hours. If it isn't working by then, ship with local data and mention Databricks as planned work.

### P3: Stretch Polish
- [ ] Animate SPOT walking its route across the inclined map during a mission replay — _owner:_
- [ ] Clicking a waypoint on the map highlights the SPOT part that took that reading — _owner:_
- [ ] Inspection images (`04_ASSETS/sample_inspection_images`) shown in the part info panel — _owner:_

---

## 🗓️ Order of Work (10/10 → 10/11)

Each phase lists **what** gets done, **how**, and **who** works in parallel. Don't start a phase until the 🔒 gate before it is met. The gates keep people from building on pieces that don't exist yet.

### Phase 0: Kickoff (first ~30 min, everyone together)
- [ ] Assign roles and fill in the team table above
- [ ] Pick the stack (suggested: Python + FastAPI backend, React + Vite + React Three Fiber frontend) and update the README Tech Stack table
- [ ] **Pick the 3D SPOT model** (licensed GLB or low-poly fallback)
- [ ] **Agree on the API contract**: JSON shapes for an Inspection Record, a part summary, a waypoint summary, metrics, `/ask`, and the `/ops/*` issue + snapshot shapes. Write it to `docs/api_contract.md`. The frontend builds against this, so it doesn't have to wait on the backend.
- [ ] Set up repo folders (`backend/`, `frontend/`, `ml/`, `docs/`), `.gitignore` for `.env`, and a `.env.example`
- [ ] Register `spotat.work` now, so DNS has hours to propagate

🔒 **Gate:** roles assigned, API contract written, 3D model chosen, domain registered.

### Phase 1: Foundation (Sat afternoon, ~3 hrs, parallel lanes)
- **3D / Frontend**: _drei `useGLTF` + `OrbitControls`_
  - [ ] Load the SPOT model in a canvas on the landing page
  - [ ] Place hotspots on each part (click logs the part name for now)
- **Frontend / UX**: _Mock JSON copied from the API contract_
  - [ ] App shell: header, Overview / Data Scientist tabs, light theme with SPOT color variables
  - [ ] AI popup component (UI only, canned reply)
- **Data / ML**: _Start from `05_STARTER_CODE/load_data.py`. Join actions → readings/anomalies → assets/locations._
  - [x] Load and join all CSVs into Inspection Records
  - [x] ~~Save as `data/processed/records.json`~~ not needed: records are built in memory from the lakehouse
- **Backend / AI**: _FastAPI_
  - [x] Endpoints serving the contract from mock data, then real data when it lands
  - [x] Per-part and per-waypoint summary endpoints
- **Infra / Submission**: _Deploy early so deploy problems surface now, not at 8 AM_
  - [ ] Deploy a "hello world" frontend; point `spotat.work` at it + HTTPS
  - [ ] Create the Devpost draft, add all teammates, select tracks

🔒 **Gate:** real data flows end to end: CSV → backend → clicking a SPOT part shows its real data.

### Phase 2: Core Features (Sat evening, ~4 hrs)
- **3D / Frontend**: _Floor plan PNG as the texture on each tilted plane_
  - [ ] Camera zoom-to-part + info panel with plain-language data
  - [ ] Inclined two-floor map with waypoint markers colored by status
  - [ ] Animated Floor 1 ↔ Floor 2 toggle
- **Frontend / UX**: _Plain HTML tables are fine; TanStack Table if time allows_
  - [ ] Data Scientist tab: tables + outcome numbers + V1 vs V2
  - [ ] Wire the AI popup to `/ask` with `mode` set by the active tab
- **Data / ML**: _scikit-learn. See the P1 model section for the split rules._
  - [x] 80/20 grouped split by `mission_id` (seed 42)
  - [x] Threshold-rule baseline, then train the model (logistic regression / random forest is enough)
  - [x] Compute metrics + 5-fold grouped CV → `ml/metrics.json`
- **Backend / AI**: _Test with 5 simple and 5 technical questions_
  - [x] Build the document set; index with TF-IDF (no embedding service needed at this size)
  - [x] `/ask`: retrieve → LLM with a simple or technical system prompt → answer with cited IDs
  - [x] `/metrics` endpoint serving `metrics.json`

🔒 **Gate (~midnight):** full core demo works on `spotat.work`: click a SPOT part → see its data → switch floors → ask the AI → switch to the Data Scientist tab.

### Phase 3: Secondary Tracks (midnight → 5 AM)
- [x] Backend: **Operator Console** `/ops/*` + `ops.db` + seeded snapshots
- [ ] Frontend: Operator tab: issue queue → resolve with a note → save a snapshot → compare with the earlier one
- [ ] Frontend: **Generate PDF** in the Data Scientist tab (exports a snapshot)
- [ ] Frontend: model metrics panel + confusion matrix in the Data Scientist tab
- [x] AI: backend accepts the selected part / floor / waypoint as `context`, and has the guardrail (frontend still has to send `context`)
- [ ] Infra: Databricks Delta tables + MLflow, backend reading from it. **If it isn't working by 3 AM, cut it.**
- [ ] 3D: stretch polish (SPOT walking the route, waypoint ↔ part highlighting). **If it isn't working by 4 AM, cut it.**
- [ ] Everyone: fix bugs found while running the demo flow

🔒 **Gate (5 AM): feature freeze.** Only bug fixes from here.

### Phase 4: Submission Prep (5 AM → 10 AM)
- [ ] Write the demo script: 3D SPOT → zoom into the thermal camera → floor toggle → ask the AI → Data Scientist tab → generate PDF → sign in to the Operator Console → click **Arm alarms** → run `feed --delay 8` → watch IMPROVED missions arrive and the KPI chart climb → the alarm fires on M020 (CRITICAL temperature on HX-204): mark it as danger → the next one: override as not a problem → compare the "before" snapshot with the latest one to show the improvement. **Before every rehearsal and the recording, run `seed --reset`.**
- [ ] Record the demo video (≤ 3 min) **before** any final polish
- [ ] Screenshots: 3D landing page, part zoom, inclined map, AI answer (simple + technical), Data Scientist tab, PDF
- [ ] Devpost writeup: problem, solution, model numbers, architecture diagram, tech stack, challenges
- [ ] Update README: tech stack, setup steps, project structure, model performance, team roles, 3D model credit
- [ ] **9:00 AM: submit Devpost** (keep editing until 10)
- [ ] **10:00 AM: ✅ Devpost deadline**

### Phase 5: Go Public (10 AM → 11 AM)
- [ ] Scan history for secrets (`git log -p | grep -iE "key|token|secret"`) and rotate anything that leaked
- [x] Remove `.DS_Store` files; make sure `.env` isn't committed
- [ ] Final commits pushed
- [ ] **Make the repo public** and open the Devpost repo link in a logged-out browser
- [ ] **11:00 AM: ✅ Final commit + public repo**
