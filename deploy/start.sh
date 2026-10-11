#!/usr/bin/env bash
# Starts the Java ingest API, the FastAPI backend and Caddy. If any of them exits, the container exits
# so Render restarts it. Mission data lives in Databricks (SINK=databricks) or, with SINK=local, in CSVs on
# the persistent disk at DATA_DIR; ops.db is always on the disk.
set -euo pipefail

DATA_DIR=${DATA_DIR:-/var/data}
export SINK=${SINK:-local}
export LAKEHOUSE=$SINK
export LAKEHOUSE_DIR="$DATA_DIR/lakehouse" OPS_DB="$DATA_DIR/ops.db" KIT_DATA_DIR=/app/data/kit
export INGEST_URL=http://127.0.0.1:8081 INGEST_WEBHOOK_URL=http://127.0.0.1:8000/ops/ingest-hook
mkdir -p "$LAKEHOUSE_DIR"

cd /app/ingest-api
# First boot on an empty disk: reference data + the BASELINE missions only, so IMPROVED can stream in live.
# Databricks is never reseeded here (it would wipe live missions); a supervisor's Reset in the Operator Console does that.
if [ "$SINK" = local ] && [ ! -f "$LAKEHOUSE_DIR/missions.csv" ]; then
  PORT=8081 java -cp out work.spotat.ingest.Main seed --reset
fi
PORT=8081 java -cp out work.spotat.ingest.Main serve &

cd /app/backend
python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 &

caddy run --config /app/deploy/Caddyfile --adapter caddyfile &

wait -n
exit 1
