# SPOT Live Ingest API (Java)

The only way new SPOT data gets into the lakehouse. In the demo, the lakehouse starts with only the 18 **BASELINE** missions. The 9 **IMPROVED** missions then stream in through this API as if SPOT were sending them live, and every open dashboard is told the moment each one lands.

Plain **JDK 17+**, with no Maven, Gradle or other dependencies.

## Run it

```bash
cp .env.example .env          # optional; defaults work offline
./run.sh seed --reset         # lakehouse = locations + assets + BASELINE missions
./run.sh serve                # API on http://localhost:8081
./run.sh feed --delay 8       # in a second terminal: stream IMPROVED missions in
```

On Windows PowerShell, use `.\run.ps1` with the same arguments.

**Step-by-step setup with Databricks, checks, demo, reset and troubleshooting: see [RUNBOOK.md](RUNBOOK.md).**

Run `seed --reset` again before each demo run to go back to baseline only. On Databricks, seeding takes about 3 minutes and each live mission takes about 8 seconds to write.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Liveness check, and which storage target is in use |
| GET | `/ingest/status` | Row counts per table, missions per scenario, latest mission |
| POST | `/ingest/missions` | Adds one mission bundle. Returns `201`, `400` (with a list of problems, nothing written), `409` (already ingested) or `401` (bad API key) |
| GET | `/events` | Server-Sent Events. Sends `mission_ingested` with `alerts[]` |

**Mission bundle** (field names and formats match the kit CSVs; numbers and booleans can be JSON values or strings):

```json
{
  "mission":   { "mission_id": "M020", "scenario": "IMPROVED", "configuration_version": "V2", ... },
  "actions":   [ { "action_id": "A0191", "mission_id": "M020", "location_id": "WP07", ... } ],
  "readings":  [ ... ],
  "anomalies": [ ... ]
}
```

**Alerts:** any anomaly in the bundle that is `HIGH` or `CRITICAL`, or has `operator_review_required = true`, appears in `alerts[]` in both the response and the event, together with the reading that triggered it. The dashboard shows these as the full-screen alarm.

```js
const events = new EventSource("http://localhost:8081/events");
events.addEventListener("mission_ingested", (e) => {
  const { mission_id, alerts } = JSON.parse(e.data);
  refreshData();
  alerts.forEach(queueAlarm);
});
```

## Configuration

Set these in `.env` or as environment variables (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `SINK` | `databricks` if `DATABRICKS_HOST` is set, otherwise `local` | Where rows are written |
| `LAKEHOUSE_DIR` | `../data/lakehouse` | Local target: one CSV per table, same format as the kit |
| `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_TOKEN` | | Databricks target, written through the SQL Statement Execution API (`DATABRICKS_WAREHOUSE_ID` also works in place of the HTTP path) |
| `DATABRICKS_CATALOG`, `DATABRICKS_SCHEMA` | `workspace`, `spot` | Where the Delta tables live (Free Edition's catalog is `workspace`) |
| `KIT_DATA_DIR` | `../data/kit` | Source data for `seed` and `feed` |
| `PORT` | `8081` | |
| `INGEST_API_KEY` | | When set, `POST` requests need the header `X-API-Key` |
| `INGEST_WEBHOOK_URL` | | Called after each ingest, for example the Python backend's `/ops/ingest-hook` |
