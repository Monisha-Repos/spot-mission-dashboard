# Runbook: Databricks + Ingest API

Every command needed to set up, check, demo and reset the live-data pipeline. Commands are for **Windows PowerShell**. On macOS/Linux, use `./run.sh` instead of `.\run.ps1`, `cp` instead of `Copy-Item`, and `curl` instead of `curl.exe`.

All commands run from the `ingest-api` folder unless a step says otherwise.

---

## 1. One-time setup

### 1.1 Check Java (17 or newer)
```powershell
java -version
javac -version
```
If either is missing, install Temurin 17 from https://adoptium.net and open a new terminal.

### 1.2 Go to the API folder
```powershell
cd C:\_MonishaN\CS\PROJECTS\Spot-Mission-Dashboard\ingest-api
```

### 1.3 Get your Databricks values (in the browser)
| Value | Where to find it |
|---|---|
| Host | The workspace URL in the address bar, e.g. `https://dbc-xxxx.cloud.databricks.com` |
| HTTP path | **SQL Warehouses** → *Serverless Starter Warehouse* → **Connection details** → HTTP path |
| Token | Profile icon → **Settings** → **Developer** → **Access tokens** → **Manage** → **Generate new token** (lifetime 7 days). Copy it right away. |

Make sure the warehouse is **Started**.

### 1.4 Create `.env`
```powershell
Copy-Item .env.example .env
code .env
```
Fill in these lines and save:
```
SINK=databricks
DATABRICKS_HOST=https://dbc-xxxx.cloud.databricks.com
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/xxxxxxxxxxxx
DATABRICKS_TOKEN=<your token>
DATABRICKS_CATALOG=workspace
DATABRICKS_SCHEMA=spot
```
> Never commit `.env`, paste the token into chat, or share it. Git already ignores `.env`. Check with:
> ```powershell
> git check-ignore -v .env
> ```
> It should print a line ending in `.env`. If it prints nothing, **stop** and don't commit.

### 1.5 Load the lakehouse (BASELINE only, about 3 minutes)
```powershell
.\run.ps1 seed --reset
```
Expected last line:
```
seeded 18 BASELINE mission(s); lakehouse now has {locations=15, assets=20, missions=18, actions=180, readings=146, anomalies=28}
```

### 1.6 Check in Databricks
Run this in the **SQL Editor**:
```sql
SELECT scenario, COUNT(*) AS missions FROM workspace.spot.missions GROUP BY scenario;
```
Expected: `BASELINE | 18`.

---

## 2. Run the API

### Terminal 1: start the server
```powershell
.\run.ps1 serve
```
Expected:
```
SPOT ingest API listening on http://localhost:8081, writing to databricks workspace.spot
```
Leave this terminal open.

### Terminal 2: check it
```powershell
curl.exe http://localhost:8081/health
curl.exe http://localhost:8081/ingest/status
```
`/ingest/status` should show `"missions_by_scenario":{"BASELINE":18}`.

### Terminal 3 (optional): watch the live events
```powershell
curl.exe -N http://localhost:8081/events
```
Each live mission prints an `event: mission_ingested` line with its `alerts`. This is the same stream the dashboard listens to.

---

## 3. Demo: stream the IMPROVED missions in

In Terminal 2:
```powershell
.\run.ps1 feed --delay 8
```
This sends M019–M027 one every 8 seconds (writing each one also takes about 8 seconds on Databricks). Alarms fire on M020, M022, M024, M025 and M027.

To go faster when rehearsing:
```powershell
.\run.ps1 feed --delay 0
```

Then check the result:
```powershell
curl.exe http://localhost:8081/ingest/status
```
Expected: `"missions_by_scenario":{"BASELINE":18,"IMPROVED":9}`.

```sql
-- Databricks SQL Editor: the before/after headline
SELECT scenario,
       ROUND(100 * AVG(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END), 1) AS action_success_pct
FROM workspace.spot.actions
GROUP BY scenario;
```
Expected: `BASELINE 77.2`, `IMPROVED 91.1`.

---

## 4. Reset before every rehearsal and the real demo

Stop the server (Ctrl+C in Terminal 1), then:
```powershell
.\run.ps1 seed --reset
.\run.ps1 serve
```

**One minute before presenting**, run any query in the Databricks SQL Editor to wake the warehouse:
```sql
SELECT COUNT(*) FROM workspace.spot.missions;
```

---

## 5. Offline fallback (no Databricks or Wi-Fi)

Writes CSVs to `data/lakehouse/` instead. Real environment variables override `.env`, so this doesn't touch your Databricks settings:
```powershell
$env:SINK = "local"
.\run.ps1 seed --reset
.\run.ps1 serve
```
Each new terminal needs `$env:SINK = "local"` again. To go back to Databricks:
```powershell
Remove-Item Env:SINK
```

---

## 6. Optional settings (in `.env`)

| Setting | Effect |
|---|---|
| `PORT=8082` | Use another port if 8081 is taken. `feed` uses the same setting. |
| `INGEST_API_KEY=<random string>` | `POST /ingest/missions` then needs the header `X-API-Key`. `feed` sends it automatically. |
| `INGEST_WEBHOOK_URL=http://localhost:8000/ops/ingest-hook` | Notifies the Python backend after each mission. |

---

## 7. Troubleshooting

| Message | Fix |
|---|---|
| `Databricks rejected the token (HTTP 403)` | The token is wrong, expired or revoked. Generate a new one (step 1.3) and update `.env`. |
| `DATABRICKS_TOKEN is not set` / `set DATABRICKS_HTTP_PATH ...` | The line is missing or empty in `.env`, or you're not in the `ingest-api` folder. |
| `Databricks statement still RUNNING after 5 min` | The warehouse is stopped or starting. Start it under **SQL Warehouses** and retry. |
| `Databricks statement FAILED: ... SCHEMA_NOT_FOUND / CATALOG_NOT_FOUND` | Check `DATABRICKS_CATALOG=workspace` (Free Edition). Other workspaces may use `main`. |
| `waiting for the API at http://localhost:8081` then `no API answering` | `serve` isn't running, or it's on a different `PORT`. |
| `Address already in use` | Another `serve` is still running. Close it, or set `PORT=8082`. |
| `kit data folder not found` | Run from the `ingest-api` folder, or set `KIT_DATA_DIR` to the kit's `02_DATA` path. |
| `M0xx already in the lakehouse, skipped` | Expected after a feed. Run `seed --reset` to start over. |
| `javac` is not recognized | Install a JDK (step 1.1). A JRE alone can't compile. |

---

## 8. If the token leaks

1. Databricks → profile icon → **Settings** → **Developer** → **Access tokens** → **Manage** → delete the token.
2. **Generate new token** → paste it into `.env` only.
3. Check that git history is clean (this should print nothing):
   ```powershell
   git log --all -p | Select-String "dapi"
   ```
