# Deploying spotat.work

| Piece | Where | Config |
|---|---|---|
| Frontend (`spot-3d-demo/`) | Vercel, root directory `spot-3d-demo` | `spot-3d-demo/vercel.json` |
| FastAPI backend + Java ingest API | Render, one Docker web service (free plan) | `Dockerfile`, `render.yaml`, `deploy/` |

Mission data lives in Databricks (`SINK=databricks`, catalog `workspace`, schema `spot`), which both backends read and
write. `ops.db` (issues, audit trail, snapshots) is SQLite in the container: on the free plan it resets when the service
restarts or wakes from sleep (~15 min idle); add a disk at `/var/data` on a paid plan to keep it. With `SINK=local` the lakehouse is CSVs in `/var/data`
instead, which is why both backends share one container. Caddy is the one
public port: `/stream/*` goes to the Java ingest API (SSE + live-feed controls), everything else to FastAPI.
The Operator Console's presenter feed streams the IMPROVED missions in, and a supervisor's **Reset** puts the lakehouse
back to BASELINE only. Databricks is never reseeded on boot; with `SINK=local`, an empty disk is seeded automatically.

Vercel environment variables (baked in at build time, so redeploy after changing them):

    VITE_API_URL=https://<render-service>.onrender.com
    VITE_INGEST_URL=https://<render-service>.onrender.com/stream

Render secrets to fill in on first deploy: `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_TOKEN`, `OPS_PIN`
(operator sign-in) and `ANTHROPIC_API_KEY` (AI assistant).
`OPS_SECRET` and `INGEST_API_KEY` are generated. Test the container locally:

    docker build -t spot-api . && docker run -p 10000:10000 -e OPS_PIN=1234 spot-api            # SINK=local
    docker run -p 10000:10000 -e OPS_PIN=1234 --env-file ingest-api/.env -e PORT=10000 spot-api   # Databricks
