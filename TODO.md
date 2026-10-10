# TODO: Knight Hacks (SPOT Mission Dashboard)

## ⏰ Hard Deadlines (Sat 10/11)

- [ ] **10:00 AM**: **Devpost submitted** (description, demo video, screenshots, tracks, all teammates added). Owner: _TBD_
- [ ] **11:00 AM**: **Final commits pushed + repo public**, no pushes after. Owner: _TBD_

### Key Pointers
- **Submit Devpost early (aim for ~9:00 AM).** You can edit it until the deadline, but a late submission can't be fixed.
- Devpost will link to the repo before 11:00, while the repo is still private. Make it public **before** judging starts, and check the link works from a logged-out browser.
- New features freeze at ~5 AM. After that, only bug fixes, polish, and demo prep.
- Record the demo video **before** the final polish pass, so a broken late change can't cost you the video.
- Never push secrets: Databricks tokens, LLM API keys, and `.env` files stay out of git. Check `git log -p` for keys before the repo goes public.
- Every secondary track below is optional. If one is at risk, cut it and keep the core demo working.
- Remove committed `.DS_Store` files before the repo goes public.

---

## 💡 Product Vision

Two tabs, one AI assistant shared by both.

```
┌──────────────────────────────────────────────────────────────┐
│  [ Overview ]  [ Data Scientist ]                  spotat.work │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│              🐕  3D SPOT model (rotate / zoom)               │
│        click a part → camera zooms in → that part's data     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│        ▱▱▱ Floor 2 ▱▱▱     inclined (isometric) map          │
│      ▱▱▱ Floor 1 ▱▱▱       [ Floor 1 | Floor 2 ] toggle      │
│                             animated swap between floors     │
│                                                    ┌──────┐  │
│                                                    │ 💬 AI│  │
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

## 👥 Team, Roles & Responsibilities

> Jobs will be assigned soon. Fill in the owner of each task once roles are set.

| Contributor | GitHub | Role | Owns |
|---|---|---|---|
| Monisha Natarajan | [@Monisha-Repos](https://github.com/Monisha-Repos) | _TBD_ | _TBD_ |
| Alexander Giannak | AlexanderGiannak | _TBD_ | _TBD_ |
| _TBD_ | | _TBD_ | _TBD_ |
| _TBD_ | | _TBD_ | _TBD_ |

**Suggested role split** (one person can hold more than one):

| Role | Responsibilities |
|---|---|
| **3D / Frontend Lead** | 3D SPOT model, part zoom, inclined two-floor map + floor toggle animation |
| **Frontend / UX Lead** | App shell, tabs, Data Scientist tables, AI popup UI, PDF export, theme |
| **Data / ML Lead** | Data loading and cleaning, train/test split, anomaly model, efficiency metrics |
| **Backend / AI Lead** | API, RAG pipeline (simple + technical modes), Databricks, deployment, domain/DNS |
| **Submission Lead** | Devpost writeup, demo video, README, keeping time against the deadlines |

---

## 🎯 Prioritized Task List

Priority key: **P0** = must ship · **P1** = high value, should ship · **P2** = nice to have · **P3** = stretch goal

### P0: Data + API Foundation
- [ ] Load all CSVs and `replay.ndjson` into one Inspection Record schema (see README) — _owner:_
- [ ] Status classification (Normal / Watch / Action) + plain-English explanations — _owner:_
- [ ] API endpoints: missions, records, per-SPOT-part summary, per-waypoint summary, metrics — _owner:_
- [ ] BASELINE vs IMPROVED (V1 vs V2) comparison. The brief asks for this directly. — _owner:_

### P0: Overview Tab (landing page)
- [ ] 3D SPOT model loaded in React Three Fiber (`@react-three/fiber` + `@react-three/drei`) — _owner:_
- [ ] Clickable hotspots on each part (table above) → camera zooms in (drei `CameraControls`) → info panel with that part's data in plain language — _owner:_
- [ ] Inclined map: both floor plans as tilted planes (CSS 3D `rotateX/rotateZ` or R3F planes), waypoints from `locations.csv` x/y — _owner:_
- [ ] Floor 1 ↔ Floor 2 toggle with an animated swap (Framer Motion or `react-spring`) — _owner:_
- [ ] Waypoint markers colored by status; click one for its readings — _owner:_

> **3D model source:** look for a SPOT glTF/GLB with a license that allows reuse (Sketchfab CC-BY, or meshes from Boston Dynamics' open-source `spot_description` package). Credit it in the README. **Fallback:** a stylized low-poly SPOT made from boxes and cylinders still works, because the hotspots are what matter. Decide in Phase 0 so nobody blocks on it.

### P0: AI Assistant (popup, both tabs)
- [ ] RAG pipeline: embed the data dictionary, challenge docs, SPOT user guide, and per-mission / per-anomaly summaries — _owner:_
- [ ] `/ask` endpoint: retrieve top-k → LLM → answer citing IDs. Takes `mode` (`simple` / `technical`) and `context` (selected part / floor / waypoint) — _owner:_
- [ ] Bottom-right popup chat component, shared by both tabs — _owner:_
- [ ] Guardrail: if retrieval finds nothing relevant, answer "I don't have data on that" instead of guessing — _owner:_

**Keep it simple:** in-memory vector store (FAISS / Chroma) + one LLM call. Don't build an agent framework at a hackathon.

### P1: Data Scientist Tab
- [ ] Tab switch in the header (Overview ↔ Data Scientist); remember the last tab — _owner:_
- [ ] Sortable/filterable tables for missions, actions, readings, anomalies — _owner:_
- [ ] Outcome numbers: success rates, failure types per waypoint, V1 vs V2 — _owner:_
- [ ] Model metrics panel (reads `ml/metrics.json`) — _owner:_
- [ ] AI popup in `technical` mode — _owner:_
- [ ] **Generate PDF**: timestamped snapshot of the current results (`jsPDF` + `jspdf-autotable` for tables; filename like `spot-report-2026-10-11T08-30.pdf`) — _owner:_

### P1: Model Training, Testing & Efficiency Numbers
Judges trust numbers. Shown in the Data Scientist tab.

- [ ] **Split the data 80/20** (recommended over 70/30, explained below) — _owner:_
- [ ] Train the anomaly / failure model on the training set only — _owner:_
- [ ] Report metrics on the held-out test set → `ml/metrics.json` — _owner:_
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
- [ ] Load the CSVs into **Delta tables**. This is the relational layer. — _owner:_
- [ ] Store `replay.ndjson` events and inspection images as **semi-structured / volume data**. This is the non-relational layer. — _owner:_
- [ ] Run model training in a Databricks notebook and log metrics with MLflow — _owner:_
- [ ] Backend reads from Databricks, with a **local CSV fallback** if the connection fails during the demo — _owner:_
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
- [ ] **Agree on the API contract**: JSON shapes for an Inspection Record, a part summary, a waypoint summary, metrics, and `/ask`. Write it to `docs/api_contract.md`. The frontend builds against this, so it doesn't have to wait on the backend.
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
  - [ ] Load and join all CSVs into Inspection Records
  - [ ] Save as `data/processed/records.json` (or parquet)
- **Backend / AI**: _FastAPI_
  - [ ] Endpoints serving the contract from mock data, then real data when it lands
  - [ ] Per-part and per-waypoint summary endpoints
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
  - [ ] 80/20 grouped split by `mission_id` (seed 42)
  - [ ] Threshold-rule baseline, then train the model (logistic regression / random forest is enough)
  - [ ] Compute metrics + 5-fold grouped CV → `ml/metrics.json`
- **Backend / AI**: _Test with 5 simple and 5 technical questions_
  - [ ] Build the document set; chunk + embed into FAISS/Chroma
  - [ ] `/ask`: retrieve → LLM with a simple or technical system prompt → answer with cited IDs
  - [ ] `/metrics` endpoint serving `metrics.json`

🔒 **Gate (~midnight):** full core demo works on `spotat.work`: click a SPOT part → see its data → switch floors → ask the AI → switch to the Data Scientist tab.

### Phase 3: Secondary Tracks (midnight → 5 AM)
- [ ] Frontend: **Generate PDF** in the Data Scientist tab
- [ ] Frontend: model metrics panel + confusion matrix in the Data Scientist tab
- [ ] AI: pass the selected part / floor / waypoint as context; add the "I don't have data on that" guardrail
- [ ] Infra: Databricks Delta tables + MLflow, backend reading from it. **If it isn't working by 3 AM, cut it.**
- [ ] 3D: stretch polish (SPOT walking the route, waypoint ↔ part highlighting). **If it isn't working by 4 AM, cut it.**
- [ ] Everyone: fix bugs found while running the demo flow

🔒 **Gate (5 AM): feature freeze.** Only bug fixes from here.

### Phase 4: Submission Prep (5 AM → 10 AM)
- [ ] Write the demo script: 3D SPOT → zoom into the thermal camera → floor toggle → ask the AI → Data Scientist tab → generate PDF
- [ ] Record the demo video (≤ 3 min) **before** any final polish
- [ ] Screenshots: 3D landing page, part zoom, inclined map, AI answer (simple + technical), Data Scientist tab, PDF
- [ ] Devpost writeup: problem, solution, model numbers, architecture diagram, tech stack, challenges
- [ ] Update README: tech stack, setup steps, project structure, model performance, team roles, 3D model credit
- [ ] **9:00 AM: submit Devpost** (keep editing until 10)
- [ ] **10:00 AM: ✅ Devpost deadline**

### Phase 5: Go Public (10 AM → 11 AM)
- [ ] Scan history for secrets (`git log -p | grep -iE "key|token|secret"`) and rotate anything that leaked
- [ ] Remove `.DS_Store` files; make sure `.env` isn't committed
- [ ] Final commits pushed
- [ ] **Make the repo public** and open the Devpost repo link in a logged-out browser
- [ ] **11:00 AM: ✅ Final commit + public repo**
