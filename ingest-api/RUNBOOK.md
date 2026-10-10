# Runbook: Databricks + Ingest API + Backend

Every command needed to set up, check, demo and reset the live-data pipeline and the Python backend. Commands are for **Windows PowerShell**. On macOS/Linux, use `./run.sh` instead of `.\run.ps1`, `cp` instead of `Copy-Item`, `curl` instead of `curl.exe`, and `.venv/bin/` instead of `.venv\Scripts\`.

All commands run from the `ingest-api` folder unless a step says otherwise.

---

## Quick start (everything already set up)

Three terminals, one command each. Start them in this order:

| # | Folder | Command | Ready when you see |
|---|---|---|---|
| 1 | `ingest-api` | `.\run.ps1 serve` | `SPOT ingest API listening on http://localhost:8081` |
| 2 | `backend` | `..\.venv\Scripts\python -m uvicorn app.main:create_app --factory --port 8000` | `Application startup complete` |
| 3 | `spot-3d-demo` | `npm run dev` | `Local: http://127.0.0.1:5173/` |

Open **http://127.0.0.1:5173**. Sign in on the **Operator** tab with the `OPS_PIN` from `backend\.env`.

Common commands:

| Task | Folder | Command |
|---|---|---|
| Stream the 9 live (IMPROVED) missions | `ingest-api` | `.\run.ps1 feed --delay 8` |
| Reset the lakehouse to baseline only | `ingest-api` | `.\run.ps1 seed --reset` (stop `serve` first) |
| Clear operator issues and snapshots | `backend` | `..\.venv\Scripts\python manage.py reset-ops` (stop the backend first) |
| Check where the backend reads data from | `backend` | `..\.venv\Scripts\python manage.py check` |
| Reload data without restarting | any | `curl.exe -X POST http://localhost:8000/admin/refresh` |
| Health checks | any | `curl.exe http://localhost:8081/health` · `curl.exe http://localhost:8000/health` |
| Backend API docs | browser | http://localhost:8000/docs |
| Run all tests | repo root | `cd backend; ..\.venv\Scripts\python -m pytest -q; cd ..\spot-3d-demo; npm test` |

**Demo in 4 steps:** reset (section 4) → start the three terminals → in the dashboard, sign in on **Operator** and click **Arm alarms 🔊** → run `.\run.ps1 feed --delay 8`. The first alarm fires on M020.

First time on this machine? Do sections 1, 2b and 2c once.

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

## 2b. Run the backend (Python)

### One-time setup (from the repo root)
```powershell
cd C:\_MonishaN\CS\PROJECTS\Spot-Mission-Dashboard
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
code backend\.env
```
If `python -m venv .venv` says `Unable to copy ... python.exe`, the venv already exists and is in use. Skip that line.
If `pip install` says `Access is denied`, a backend from this venv is still running. Stop it (Ctrl+C, or
`Get-Process python | Stop-Process` if it was started elsewhere) and run the install again.

In `backend\.env` set at least:
```
OPS_PIN=<a PIN for operator sign-in>
OPS_SECRET=<any long random string>
INGEST_API_KEY=<random string, same as below>
ANTHROPIC_API_KEY=<optional; without a key the assistant lists matching records instead>
```
The backend reads the Databricks values from `ingest-api\.env`, so don't copy them.

Connect the two services by adding to **`ingest-api\.env`**:
```
INGEST_API_KEY=<the same random string>
INGEST_WEBHOOK_URL=http://localhost:8000/ops/ingest-hook
```
Restart `serve` (Terminal 1) after changing `ingest-api\.env`.

### Check it
```powershell
cd backend
..\.venv\Scripts\python manage.py check
```
Expected: `source databricks workspace.spot`, `rows ... missions=18 ...`, `risk model loaded (random_forest)`.

### Terminal 4: start the backend
```powershell
cd C:\_MonishaN\CS\PROJECTS\Spot-Mission-Dashboard\backend
..\.venv\Scripts\python -m uvicorn app.main:create_app --factory --port 8000
```
Open http://localhost:8000/docs to try every endpoint. Quick checks:
```powershell
curl.exe http://localhost:8000/health
curl.exe http://localhost:8000/ops/snapshots
```
`/health` should show `"missions":18`; `/ops/snapshots` should list 7 `Baseline through 2026-09-0X` snapshots.

---

## 2c. Run the dashboard (frontend)

Needs Node 22+ (`node -v`). Once:
```powershell
cd C:\_MonishaN\CS\PROJECTS\Spot-Mission-Dashboard\spot-3d-demo
npm install
```

### Terminal 5: start the dashboard
```powershell
cd C:\_MonishaN\CS\PROJECTS\Spot-Mission-Dashboard\spot-3d-demo
npm run dev
```
Open http://127.0.0.1:5173. It talks to the backend on `:8000` and the ingest API's live stream on `:8081`; copy
`.env.example` to `.env.local` to change those. The header shows **Live** when the stream is connected.

Handy links: http://127.0.0.1:5173/#scientist, http://127.0.0.1:5173/#operator, `?theme=light`.

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

If the backend is running, each mission reaches it within seconds:
```powershell
curl.exe "http://localhost:8000/ops/alerts"
curl.exe "http://localhost:8000/ops/snapshots"
```
Expected after the feed: 5 alarms waiting for a decision (AN014 CRITICAL first), and one `After M0xx arrived (live)` snapshot per mission.

To answer an alarm from the command line (the dashboard does this with buttons):
```powershell
$t = (Invoke-RestMethod -Method Post http://localhost:8000/ops/login -ContentType application/json -Body '{"name":"Dana","role":"operator","pin":"<OPS_PIN>"}').token
Invoke-RestMethod -Method Post http://localhost:8000/ops/alerts/AN014/decision -Headers @{Authorization="Bearer $t"} -ContentType application/json -Body '{"decision":"DANGER","note":"sending a tech"}'
```

---

## 4. Reset before every rehearsal and the real demo

Stop both servers (Ctrl+C in Terminals 1 and 4), then:
```powershell
.\run.ps1 seed --reset
cd ..\backend
..\.venv\Scripts\python manage.py reset-ops
cd ..\ingest-api
.\run.ps1 serve
```
Then start the backend again (Terminal 4). `reset-ops` deletes the Operator Console database (issues, decisions, snapshots); the backend rebuilds it from the baseline data on start.

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
Each new terminal needs `$env:SINK = "local"` again, including the backend's (it follows `SINK`). To go back to Databricks:
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
| `kit data folder not found` | Run from the `ingest-api` folder, or set `KIT_DATA_DIR` to the `data/kit` folder. |
| `M0xx already in the lakehouse, skipped` | Expected after a feed. Run `seed --reset` to start over. |
| `javac` is not recognized | Install a JDK (step 1.1). A JRE alone can't compile. |
| Backend: `sign-in is disabled until OPS_PIN is set` | Set `OPS_PIN` in `backend\.env` and restart the backend. |
| Backend: alarms never appear / no `After M0xx` snapshots | `INGEST_WEBHOOK_URL` or `INGEST_API_KEY` missing or different in the two `.env` files; restart `serve` after fixing. |
| Backend: `lakehouse unavailable` (HTTP 503) | Databricks unreachable or warehouse asleep. Wake it, then `curl.exe -X POST http://localhost:8000/admin/refresh`. |
| Backend: assistant answers "Here's what I found in the data" | No LLM configured (or the call failed: see `llm_error` in the response). Set `ANTHROPIC_API_KEY` or `HF_TOKEN`. |
| Dashboard: "Can't reach the backend at http://localhost:8000" | The backend (Terminal 4) isn't running, or it's on another port. Set `VITE_API_URL` in `spot-3d-demo\.env.local` and restart `npm run dev`. |
| Dashboard: header says **Offline** | The ingest API (`serve`) isn't running. Data still shows; live alarms and auto-refresh need it. |
| Dashboard: no siren | Click **Arm alarms 🔊** once after the page loads. Browsers block sound until you click. |
| Backend: `model was trained with scikit-learn X` warning | Reinstall with `pip install -r backend\requirements.txt`, or retrain with `python ml\train.py`. |

---

## 8. If the token leaks

1. Databricks → profile icon → **Settings** → **Developer** → **Access tokens** → **Manage** → delete the token.
2. **Generate new token** → paste it into `.env` only.
3. Check that git history is clean (this should print nothing):
   ```powershell
   git log --all -p | Select-String "dapi"
   ```

---

## 9. Retrain and publish the risk model (Hugging Face)

From the repo root:
```powershell
.venv\Scripts\python ml\train.py                    # rewrites ml\model.joblib + ml\metrics.json (seed 42, same result each run)
.venv\Scripts\hf auth login                         # once: paste a Hugging Face token with WRITE access
.venv\Scripts\python ml\push_to_hub.py --dry-run    # writes ml\MODEL_CARD.md to review, uploads nothing
.venv\Scripts\python ml\push_to_hub.py              # creates <username>/spot-action-failure-risk (public) and uploads
```
The token from `hf auth login` is stored in your user profile, not in the repo. The app always loads its local `ml\model.joblib`; it never downloads from the Hub.
