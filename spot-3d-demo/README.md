# Spotlight — mission intelligence

The React homepage is now the operator dashboard. The original articulated SPOT model remains in a compact companion panel and the **Robot explorer** view.

## Run locally

From the repository root:

```powershell
cd spot-3d-demo
npm install
npm run dev
```

Open the local URL printed by Vite. No account, domain, API key or hosting is required. The app loads the included fictional challenge data. For the complete test suite, use Node 22.22.2 or a supported Node 24.15+ release (jsdom's runtime requirement).

```powershell
npm test
npm run build
npm run preview
```

`dist/` contains the production website. This replaces the former standalone model demo; the folder name is retained for existing project workflows.

## What to try

1. Start in mission **M020**. Mission completion and inspection failures are shown separately.
2. Click the red **WP07** map marker. The location panel explains the finding; click **Evidence** for source IDs, readings, timestamps, severity and a suggested next step.
3. Switch between **Floor 01** and **Floor 02**. The map moves between levels and resets the location filter. Reduced-motion preferences disable animation.
4. Open **Mission replay**, then step or play through the actual event order. Outcomes are hidden until their event arrives.
5. Press **Ctrl+K** (or **Cmd+K**) to jump to a view, mission, waypoint, asset or action.
6. Open **Live monitor → Run synthetic demo** to watch eight clearly labeled example events arrive. No robot is connected.
7. Open **Robot explorer** for the original camera, pose, walking, body height, wireframe, quality and GLB export controls.
8. Add a review or shift note and export a Markdown handover. Notes persist only in the current browser.

The battery icon fills to the exact supplied percentage: **61–100% green**, **31–60% yellow**, **0–30% red**. Missing telemetry displays an unavailable value, never an invented charge.

## Optional local event gateway

Python 3.10+; no Python dependencies. After building:

```powershell
python server.py --replay public/data/live-demo.ndjson --interval 0.8
```

Open `http://127.0.0.1:8765`, choose **Live monitor**, then **Connect gateway**. The server streams the included synthetic sample. Restart the server to replay it again.

For an empty gateway accepting incoming Spotlight event JSON/NDJSON:

```powershell
python server.py
```

In another terminal, use `python scripts/send_live_demo.py` to POST invented example events. The protocol uses `/api/health` and `/api/events`; it supports the five kit lifecycle events plus `READING_CAPTURED` and `ANOMALY_DETECTED`. The example fields are visible in `public/data/live-demo.ndjson`. Importing an event log also works without a gateway.

This loopback development gateway is separate from the repository's Java `ingest-api` and does not accept native Orbit webhooks. A deployed live service needs an authenticated adapter; static hosting supports archive/replay and the built-in synthetic demo. Browser live history is limited to 2,000 events, flags truncation, and stops when leaving Live monitor. Export before navigating away.

## Evidence and scope

- 27 missions, 270 actions, 220 readings, 40 anomalies and 15 waypoints from the earlier normalized challenge dataset, now included in `public/data/mission-data.json`.
- Source flags are preserved. No invented numeric alarm thresholds, confidence probabilities or linked inspection photos.
- The map uses supplied XY coordinates and the action waypoint. Registry conflicts are disclosed. Its architectural outline is illustrative; route lines indicate inspection order, not robot path geometry.
- Recorded timestamps have no supplied timezone. Replay-linked CSV observations are explicitly reconstructed; M023 has partial replay, and M024–M027 have none.
- Reviewing a finding never clears the underlying anomaly or declares equipment healthy.
- The 3D model is a cosmetic, original stylization, not official CAD, telemetry or robot control. It retains 4,032 model triangles, on-demand drawing, capped rendering and offscreen suspension. GLB export contains the selected pose, not procedural walk animation.

## Implementation and verification

`src/App.jsx` coordinates navigation and state. `src/components/` contains the views, map, battery indicator, evidence drawer and robot panels. `src/lib/` contains the archive/replay engine, live-event reducer and display helpers. The original `SpotViewer.jsx`, `SpotViewer.css`, `spotModel.js` and model tests are unchanged.

`npm test` covers evidence joins, replay boundaries, live conflict handling, battery bands, map findings, model geometry and React interactions. The DOM tests substitute the WebGL viewer and polyfill dialogs; they do not verify browser layout, GPU rendering or native focus trapping. The production build retains a separate lazy-loaded Three.js chunk.

Optional gateway checks:

```powershell
python -m unittest discover -s tests -p test_server.py -v
```

If a sandbox restricts its temporary directory, create a writable directory and set `SPOTLIGHT_TEST_TMP` to that directory before running the Python checks.
