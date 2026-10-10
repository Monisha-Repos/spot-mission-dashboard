# SPOT Mission Dashboard

**Turn Boston Dynamics SPOT robot mission data into something any plant operator can read, trust, and act on.**

Built for the **NextEra Energy: SPOT Management Dashboard** hackathon track.

The working **Spotlight React dashboard** is in [`spot-3d-demo/`](spot-3d-demo/README.md), now replacing the model-demo homepage while preserving its 3D robot. Run `cd spot-3d-demo`, `npm install`, then `npm run dev`. It includes mission evidence, floor maps, replay, a synthetic live demo, handover exports and the robot explorer. The sections below describe the broader project vision; see the frontend README for the implemented scope and data limitations.

---

## The Problem

SPOT walks the plant floor collecting thermal images, gauge readings, acoustic data, and photos at dozens of inspection points. The raw output is mission logs, waypoint IDs, and sensor payloads. That format suits robotics engineers, but it doesn't help an operator who needs to know three things:

1. **Is anything wrong?**
2. **Where is it?**
3. **What should I do about it?**

If operators can't answer those questions quickly, they don't trust the robot, and SPOT's inspections end up ignored or repeated by hand.

## Our Solution

A dashboard that translates every SPOT mission into plain operator language, **live while the robot walks** and **as a full report after it returns**.

| Operator question | What the dashboard shows |
|---|---|
| *Where is SPOT right now?* | Live position on a plant map with the route walked so far and the inspection points still ahead |
| *What did it see?* | Each inspection point as a card with location, timestamp, reading, photo or thermal image, and the normal range |
| *Is anything wrong?* | Color-coded anomaly flags (🟢 Normal · 🟡 Watch · 🔴 Action needed), each with a one-line plain-English explanation |
| *What should I do?* | A recommended next step for every flagged item, for example "Temperature on Pump 3 bearing is 18 °C above baseline. Schedule a manual check." |
| *Can I trust this?* | Trends from past missions, confidence indicators, and the raw evidence (image or value) beside every flag |

## Key Features

### 🔴 Real-Time Mission View
- Live map of SPOT's position, path, and upcoming waypoints
- Readings stream in as each inspection point is captured
- Anomaly alerts appear the moment they're detected, not after the mission ends
- Mission progress bar: points completed, time elapsed, battery level

### 📋 Post-Mission Report
- Mission summary at the top: *"42 points inspected · 39 normal · 2 watch · 1 needs action"*
- A timeline of every reading with filters by area, asset, sensor type, or severity
- One-click export (PDF or CSV) for shift handoffs and maintenance tickets

### ⚠️ Anomaly Detection That Explains Itself
- Threshold checks against each asset's expected operating range
- Comparison to that asset's own history, so the system catches drift before it crosses a hard limit
- Every flag answers **what** is abnormal, **by how much**, and **compared to what**, with no unexplained "anomaly score"

### 📈 Building Operator Confidence
- Per-asset trend charts across missions show that SPOT's readings are consistent over time
- Every flag links to the evidence SPOT captured (image, thermal frame, raw value)
- Operators can mark flags as *confirmed* or *false alarm*, which builds a track record and tunes future alerts

### 🔒 Operator Console (separate module)
- Signed-in employees work through a queue of raised issues (anomalies and failed actions), moving each one through *Open → Acknowledged → In progress → Resolved / False alarm* with a note
- Every change is kept in an append-only audit trail: who, when, what changed, and why
- **Snapshots** freeze current SPOT performance (completion rate, success rate, failures per waypoint, open issues, time to resolve) at any moment
- **History** charts every snapshot over time and compares any two, marking each metric as improved ▲ or degraded ▼
- Built as its own module with its own storage, so the read-only dashboard works with or without it

### 🚨 Live Data + Alarms
- A small Java API ([ingest-api/](ingest-api/)) is the only way new missions enter the lakehouse. It validates each one and pushes it to every open dashboard instantly.
- The demo starts with only BASELINE (V1) missions. The IMPROVED (V2) missions then stream in live, so you can watch performance change.
- A serious anomaly sets off a siren and a full-screen alarm showing the asset, its location and a picture. It stays up until an operator marks it **not a problem** or **danger**.

### 🧑‍🏭 Designed for Operators, Not Engineers
- No robotics jargon: "Boiler Room, Gauge 4" instead of `waypoint_0x3fa2`
- Color and severity carry the meaning, and text explains it
- Large touch targets and high contrast for tablets on the plant floor

## How It Works

```
┌──────────────┐     ┌──────────────────┐     ┌───────────────────┐     ┌──────────────┐
│  SPOT Robot  │────▶│  Ingestion Layer │────▶│  Analysis Engine  │────▶│  Dashboard   │
│  (missions,  │     │  normalize data, │     │  thresholds, trend│     │  live view + │
│  sensor data)│     │  map waypoints → │     │  baselines, plain-│     │  post-mission│
│              │     │  named locations │     │  language flags   │     │  report      │
└──────────────┘     └──────────────────┘     └───────────────────┘     └──────────────┘
```

1. **Ingest:** Load SPOT mission data (live stream or exported mission files) and normalize it into one schema.
2. **Translate:** Map waypoints and asset IDs to human-readable plant locations.
3. **Analyze:** Compare each reading to its expected range and to its own history, then classify it as Normal, Watch, or Action needed.
4. **Explain:** Write a short plain-language explanation and a recommended action for each flag.
5. **Present:** Show it all on the live map, the inspection cards, and the mission report.

### Core Data Model

Every SPOT reading becomes an **Inspection Record**:

| Field | Example |
|---|---|
| `mission_id` | `2026-10-10-morning-route` |
| `timestamp` | `2026-10-10T08:14:32Z` |
| `location` | `Turbine Hall › Pump 3 › Bearing` |
| `position` | `(x, y)` on the plant map |
| `sensor_type` | `thermal` · `gauge` · `acoustic` · `visual` |
| `reading` | `87.4 °C` |
| `expected_range` | `55 – 70 °C` |
| `status` | `normal` · `watch` · `action` |
| `explanation` | "17 °C above normal operating range" |
| `recommended_action` | "Schedule a manual inspection of the bearing" |
| `evidence` | Link to the thermal image or photo |

## Tech Stack

| Layer | Technology |
|---|---|
| Lakehouse | Databricks Delta tables (Free Edition), local CSV fallback |
| Live ingestion | Java 17 ingest API (JDK only), Server-Sent Events for live alarms |
| Backend API | Python, FastAPI ([backend/](backend/)) |
| Operator Console storage | SQLite with an append-only audit trail |
| ML model | scikit-learn random forest ([ml/](ml/)), published on the Hugging Face Hub |
| AI assistant | TF-IDF retrieval + Claude (Anthropic API) or Hugging Face Inference |
| Frontend | _TBD_ (planned: React + Vite + React Three Fiber) |

## Getting Started

```bash
# Clone the repository
git clone https://github.com/Monisha-Repos/Spot-Mission-Dashboard.git
cd Spot-Mission-Dashboard

# Setup and run instructions coming soon
```

## Project Structure

```
├── ingest-api/              Java live-data API → Databricks lakehouse (see RUNBOOK.md)
├── backend/                 Python API: records, insights, AI assistant, risk model, Operator Console
├── ml/                      failure-risk model: train.py, model.joblib, metrics.json, model card
├── data/
│   ├── kit/                 challenge data: CSVs, replay.ndjson, data dictionary
│   └── lakehouse/           offline lakehouse written by ingest-api (git-ignored)
├── assets/
│   ├── maps/                floor plan, waypoint legend, facility overview
│   └── inspection-images/   sample thermal / visual / acoustic / gauge images
├── docs/
│   ├── challenge/           challenge brief, data assumptions, start-here
│   ├── spot-user-guide/     Spot user guide (PDF, pages 1–72)
│   └── orbit-screenshots/   reference screenshots of Boston Dynamics' Orbit software
├── tools/kit-starter/       the kit's Python starter scripts
└── TODO.md                  plan, product spec, task list
```

## Demo

_Screenshots, a demo video, and a walkthrough of a sample mission go here._

**Suggested demo flow for judges:**
1. Start a simulated SPOT mission and watch readings appear on the live map
2. Watch an anomaly get flagged in real time with its explanation
3. Open the post-mission report and drill into the flagged asset's history
4. Mark the flag as confirmed and export the shift-handoff report

## Roadmap

- [ ] Ingest NextEra-provided SPOT mission data
- [x] Normalize data into the Inspection Record schema
- [ ] Plant map with SPOT position and route
- [ ] Inspection cards with readings, timestamps, and evidence
- [x] Threshold-based anomaly flags
- [x] Historical baseline and trend comparison
- [x] Plain-language explanations and recommended actions
- [x] Real-time mission streaming (live or simulated)
- [ ] Post-mission summary report and export
- [x] Operator feedback on flags (confirmed / false alarm)
- [x] Operator Console: issue workflow with an audit trail
- [x] Performance snapshots + historical comparison

## Why This Wins for Operators

- **Clear:** Operators get answers instead of data dumps. Every screen answers "what's wrong, where, and what now?"
- **Actionable:** Every flag comes with a next step.
- **Trustworthy:** Evidence and history sit beside every flag, so confidence comes from what operators can see for themselves.
- **No expertise needed:** An operator on their first day can read a mission report.

## Acknowledgments

- **NextEra Energy** for the challenge and the SPOT mission data resources.
- **Boston Dynamics** for SPOT

## Team

| Name | Role |
|---|---|
| Monisha Natarajan | _Role_ |

## License

_TBD_
