# spotat.work — dashboard frontend

React + Vite + Three.js. Three tabs, a shared AI assistant, and a live alarm, all reading the Python backend
([`backend/`](../backend/)) and the Java ingest API's live stream ([`ingest-api/`](../ingest-api/)).

| Tab | For | What's on it |
|---|---|---|
| **Overview** | Everyone | 3D Spot: click a part (or its chip) and the camera zooms in, with that part's data in plain language · KPIs · inclined two-floor map with an animated Floor 1 ↔ 2 swap, waypoints coloured by status · top findings |
| **Replay** | Everyone | Pick any recorded run → play it back (30× / 60× / 120×) with Spot moving across both floors · timeline track with every finding pinned at the time it happened (click to jump, optional pause at each finding) · stop-by-stop list with result, explanation, next step and reference image. Reads `GET /missions/{id}` + `GET /missions/{id}/replay` |
| **Data Analysis** | Technical users | V1 vs V2 with significance tests · failures per waypoint · model metrics, confusion matrix, CV, baselines · sortable/filterable missions, actions, readings and anomalies · **Generate PDF** |
| **Operator** | Signed-in staff | Issue queue with filters → detail with status/assignee/note and audit trail · snapshots: KPI chart over time, save, compare two (▲/▼), export PDF · activity feed |

Shared by all tabs:
- **AI assistant** (bottom right): `POST /ask`, plain language on Overview and technical elsewhere. On Overview it sends the selected part, floor and waypoint as `context`.
- **Live alarm**: subscribes to `GET /events` on the ingest API. A HIGH or CRITICAL anomaly, or one flagged for review, opens a full-screen alarm that can't be dismissed. The only ways out are **Not a problem** (with a reason) or **Mark as danger**. Alarms queue as "1 of N", and alarms still waiting are reloaded from `GET /ops/alerts` on startup. Click **Arm alarms 🔊** once to allow the Web Audio siren.
- **Light / dark toggle** (top right, remembered). Theme tokens follow the Lamborghini-inspired design spec: true black, white, Lamborghini Gold `#FFC000` as the only accent, and sharp corners. All are CSS variables at the top of `src/styles.css`.

## Run locally

Start the backend first (see [backend/README.md](../backend/README.md)), and optionally the ingest API for live missions. Then:

```powershell
cd spot-3d-demo
npm install
npm run dev
```

Defaults are `http://localhost:8000` (backend) and `http://localhost:8081` (ingest API). Copy `.env.example` to
`.env.local` to point elsewhere. Useful URLs: `/overview`, `/analysis`, `/operator` (`/` opens Overview), and `?theme=light` or `?theme=dark`.

**Demo the live alarm:** run `seed --reset` and `serve` on the ingest API with `INGEST_WEBHOOK_URL=http://localhost:8000/ops/ingest-hook`,
sign in on the Operator tab, click **Arm alarms**, then run `feed --delay 8`. M020 raises the first alarm
(CRITICAL abnormal temperature on HX-204).

```powershell
npm test         # helper unit tests + 3D model geometry
npm run build    # dist/ is the static site
```

## Layout

```
src/
  App.jsx                 shell: tabs, theme, alarm arming, shared context
  api.js                  fetch helper, useApi() hook (re-fetches on every live mission), sign-in session
  SpotViewer.jsx          3D viewer: payloads, part hotspots, click-to-zoom camera (spotModel.js is the robot)
  tabs/                   Overview, DataScientist
  modules/ops/            Operator Console + sign-in (kept separate, like backend/app/ops)
  components/             InclinedMap, AskPanel, AlarmCenter, DataTable, LineChart, ui
  lib/                    format helpers, PDF report (shared by Generate PDF and snapshot export), siren
```

The 3D model is an original stylization, not official Boston Dynamics CAD. The CAM+IR, microphone and antenna
payloads are added in the viewer so every data source has something to click. Waypoint x/y come from
`locations.csv`, and the floor grid is schematic. Inspection pictures are reference images from the kit, not live captures.
