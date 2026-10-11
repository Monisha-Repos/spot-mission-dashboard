# Deploying spotat.work

| Piece | Where | Config |
|---|---|---|
| Frontend (`spot-3d-demo/`) | Vercel, root directory `spot-3d-demo` | `spot-3d-demo/vercel.json` |
| FastAPI backend + Java ingest API | Render, one Docker web service with a 1 GB disk at `/var/data` | `Dockerfile`, `render.yaml`, `deploy/` |

The two backends share one container so they share the lakehouse CSVs and `ops.db` on the disk. Caddy is the one
public port: `/stream/*` goes to the Java ingest API (SSE + live-feed controls), everything else to FastAPI.
On an empty disk, `start.sh` seeds the BASELINE missions; the Operator Console's presenter feed streams IMPROVED in,
and a supervisor's **Reset** puts it back to BASELINE.

Vercel environment variables (baked in at build time, so redeploy after changing them):

    VITE_API_URL=https://<render-service>.onrender.com
    VITE_INGEST_URL=https://<render-service>.onrender.com/stream

Render secrets to fill in on first deploy: `OPS_PIN` (operator sign-in) and `ANTHROPIC_API_KEY` (AI assistant).
`OPS_SECRET` and `INGEST_API_KEY` are generated. Test the container locally:

    docker build -t spot-api . && docker run -p 10000:10000 -e OPS_PIN=1234 spot-api
