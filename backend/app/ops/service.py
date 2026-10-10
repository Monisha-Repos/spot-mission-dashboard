"""Operator Console logic: issue queue, alarm decisions, snapshots and live-ingest handling."""
from __future__ import annotations

import json
import logging
import queue
import statistics
import threading
from datetime import datetime, timezone
from itertools import groupby

from .. import analytics, domain
from ..config import Settings
from ..records import Dataset
from ..store import DataStore
from .db import connect

log = logging.getLogger(__name__)

CLOSED = {"RESOLVED", "FALSE_ALARM"}
STATUSES = {"OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "FALSE_ALARM"}
CRITICALITY_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
SYSTEM_USER = {"name": "system", "role": "system"}


class OpsError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _seconds_between(a: str, b: str) -> float:
    return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds()


class OpsService:
    def __init__(self, settings: Settings, store: DataStore):
        self.settings = settings
        self.store = store
        self.lock = threading.RLock()
        self.conn = connect(settings.ops_db)
        self._hooks: queue.Queue = queue.Queue()
        self._worker: threading.Thread | None = None

    # ---------- issues ----------

    def sync_issues(self, ds: Dataset, alert_anomaly_ids: set[str] = frozenset()) -> list[str]:
        """Opens an issue for every anomaly, and for every failed action that has no anomaly.
        Anomalies named in a live alert are marked as waiting for an operator decision."""
        created = []
        with self.lock, self.conn:
            existing = {r["source_id"]: dict(r) for r in self.conn.execute("SELECT * FROM issues")}
            stamp = now()
            for r in ds.records:
                anomaly = r["anomaly"]
                if anomaly:
                    source_id, source_type, severity = anomaly["anomaly_id"], "ANOMALY", anomaly["severity"]
                    title = f"{severity.capitalize()} {domain.humanize(anomaly['type'])} on {r['asset']['name']} ({r['location']['name']})"
                elif r["outcome"] == "FAILED":
                    source_id, source_type = r["action_id"], "FAILED_ACTION"
                    severity = {"CRITICAL": "HIGH", "HIGH": "MEDIUM"}.get(r["asset"]["criticality"], "LOW")
                    title = (f"{r['action_label'].capitalize()} failed ({domain.humanize(r['failure_type'])}) at "
                             f"{r['location']['name']}")
                else:
                    continue
                pending = source_id in alert_anomaly_ids
                if source_id in existing:
                    issue = existing[source_id]
                    if pending and not issue["pending_decision"] and not issue["decided_at"] and issue["status"] not in CLOSED:
                        self.conn.execute("UPDATE issues SET pending_decision = 1, alert_at = ?, updated_at = ? WHERE issue_id = ?",
                                          (stamp, stamp, issue["issue_id"]))
                        self._event(issue["issue_id"], "ALARM_RAISED", None, None, "Live alarm raised by the ingest API", SYSTEM_USER)
                    continue
                issue_id = f"ISS-{source_id}"
                self.conn.execute(
                    "INSERT INTO issues (issue_id, source_type, source_id, mission_id, action_id, location_id, asset_id, severity, "
                    "title, pending_decision, alert_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (issue_id, source_type, source_id, r["mission_id"], r["action_id"], r["location"]["id"], r["asset"]["id"],
                     severity, title, int(pending), stamp if pending else None, stamp, stamp))
                self._event(issue_id, "CREATED", None, "OPEN", f"Raised from {source_type.lower().replace('_', ' ')} {source_id}", SYSTEM_USER)
                if pending:
                    self._event(issue_id, "ALARM_RAISED", None, None, "Live alarm raised by the ingest API", SYSTEM_USER)
                created.append(issue_id)
        return created

    def _event(self, issue_id, kind, from_status, to_status, note, user):
        self.conn.execute("INSERT INTO issue_events (issue_id, kind, from_status, to_status, note, actor, actor_role, at) "
                          "VALUES (?,?,?,?,?,?,?,?)", (issue_id, kind, from_status, to_status, note, user["name"], user["role"], now()))

    def _enrich(self, issue: dict, records: dict[str, dict]) -> dict:
        r = records.get(issue["action_id"])
        issue = {**issue, "danger": bool(issue["danger"]), "pending_decision": bool(issue["pending_decision"])}
        if r:
            issue.update({
                "location_name": r["location"]["name"], "floor": r["location"]["floor"], "asset_name": r["asset"]["name"],
                "asset_criticality": r["asset"]["criticality"], "explanation": r["explanation"],
                "recommended_action": r["recommended_action"], "evidence_image": r["evidence_image"],
                "reading": r["reading"], "anomaly": r["anomaly"], "record_status": r["status"],
                "predicted_failure_risk": r["predicted_failure_risk"], "timestamp": r["timestamp"],
                "location": r["location"], "configuration_version": r["configuration_version"],
            })
        return issue

    def list_issues(self, *, status=None, severity=None, location=None, mission=None, asset=None,
                    pending=None, danger=None, open_only=False, limit=200) -> list[dict]:
        clauses, args = [], []
        for column, value in (("status", status), ("severity", severity), ("location_id", location),
                              ("mission_id", mission), ("asset_id", asset)):
            if value:
                clauses.append(f"{column} = ?")
                args.append(value)
        if pending is not None:
            clauses.append("pending_decision = ?")
            args.append(int(pending))
        if danger is not None:
            clauses.append("danger = ?")
            args.append(int(danger))
        if open_only:
            clauses.append("status NOT IN ('RESOLVED', 'FALSE_ALARM')")
        sql = "SELECT * FROM issues" + (" WHERE " + " AND ".join(clauses) if clauses else "")
        with self.lock:
            rows = [dict(r) for r in self.conn.execute(sql, args)]
        records = {r["action_id"]: r for r in self.store.dataset.records}
        issues = [self._enrich(i, records) for i in rows]
        # Danger and waiting alarms first, then open before closed, severity, asset criticality; newest first within those.
        issues.sort(key=lambda i: i.get("timestamp") or "", reverse=True)
        issues.sort(key=lambda i: (-i["danger"], -i["pending_decision"], i["status"] in CLOSED,
                                   -domain.SEVERITY_RANK.get(i["severity"], 0),
                                   -CRITICALITY_RANK.get(i.get("asset_criticality"), 0)))
        return issues[:limit]

    def get_issue(self, issue_id: str) -> dict:
        with self.lock:
            row = self.conn.execute("SELECT * FROM issues WHERE issue_id = ?", (issue_id,)).fetchone()
            if not row:
                raise OpsError(404, f"no issue {issue_id}")
            events = [dict(e) for e in self.conn.execute(
                "SELECT * FROM issue_events WHERE issue_id = ? ORDER BY event_id", (issue_id,))]
        records = {r["action_id"]: r for r in self.store.dataset.records}
        return {**self._enrich(dict(row), records), "events": events}

    def change_issue(self, issue_id: str, user: dict, *, status: str | None, assignee: str | None, note: str) -> dict:
        note = (note or "").strip()
        if not note:
            raise OpsError(400, "a short note is required for every change")
        with self.lock, self.conn:
            row = self.conn.execute("SELECT * FROM issues WHERE issue_id = ?", (issue_id,)).fetchone()
            if not row:
                raise OpsError(404, f"no issue {issue_id}")
            current = row["status"]
            if status is not None:
                if status not in STATUSES:
                    raise OpsError(400, f"status must be one of {sorted(STATUSES)}")
                if status == current:
                    raise OpsError(400, f"issue is already {current}")
                if current in CLOSED and status != "OPEN":
                    raise OpsError(400, f"a {current} issue can only be reopened (status OPEN)")
                if current in CLOSED and user["role"] != "supervisor":
                    raise OpsError(403, "only a supervisor can reopen a closed issue")
                self.conn.execute("UPDATE issues SET status = ?, updated_at = ? WHERE issue_id = ?", (status, now(), issue_id))
                self._event(issue_id, "REOPENED" if current in CLOSED else "STATUS", current, status, note, user)
            if assignee is not None:
                self.conn.execute("UPDATE issues SET assignee = ?, updated_at = ? WHERE issue_id = ?",
                                  (assignee.strip() or None, now(), issue_id))
                self._event(issue_id, "ASSIGNED", None, None, f"Assigned to {assignee.strip() or 'nobody'}. {note}", user)
            if status is None and assignee is None:
                self._event(issue_id, "NOTE", None, None, note, user)
        return self.get_issue(issue_id)

    # ---------- alarms ----------

    def alerts(self, pending: bool | None = True) -> list[dict]:
        if pending:
            return self.list_issues(pending=True)
        return [i for i in self.list_issues() if i["alert_at"]]

    def decide_alert(self, anomaly_id: str, user: dict, decision: str, note: str) -> dict:
        decision = decision.upper()
        if decision not in {"OVERRIDE", "DANGER"}:
            raise OpsError(400, "decision must be OVERRIDE (not a problem) or DANGER")
        note = (note or "").strip()
        if decision == "OVERRIDE" and not note:
            raise OpsError(400, "say why this is not a problem")
        with self.lock:
            row = self.conn.execute("SELECT * FROM issues WHERE source_id = ?", (anomaly_id,)).fetchone()
        if not row:
            # The alarm can reach the dashboard before the backend has reloaded the new mission.
            self.sync_issues(self.store.refresh())
            with self.lock:
                row = self.conn.execute("SELECT * FROM issues WHERE source_id = ?", (anomaly_id,)).fetchone()
            if not row:
                raise OpsError(404, f"no issue for anomaly {anomaly_id}")
        with self.lock, self.conn:
            row = self.conn.execute("SELECT * FROM issues WHERE source_id = ?", (anomaly_id,)).fetchone()
            if row["decided_at"]:
                raise OpsError(409, f"alarm {anomaly_id} was already decided")
            stamp = now()
            new_status = "FALSE_ALARM" if decision == "OVERRIDE" else "IN_PROGRESS"
            self.conn.execute("UPDATE issues SET status = ?, danger = ?, pending_decision = 0, decided_at = ?, updated_at = ? "
                              "WHERE issue_id = ?", (new_status, int(decision == "DANGER"), stamp, stamp, row["issue_id"]))
            label = "Not a problem (override)" if decision == "OVERRIDE" else "Marked as DANGER"
            self._event(row["issue_id"], f"ALARM_{decision}", row["status"], new_status,
                        f"{label}" + (f": {note}" if note else ""), user)
        return self.get_issue(row["issue_id"])

    # ---------- stats + KPIs ----------

    def stats(self) -> dict:
        with self.lock:
            issues = [dict(r) for r in self.conn.execute("SELECT * FROM issues")]
            closes = {r["issue_id"]: r["at"] for r in self.conn.execute(
                "SELECT issue_id, MIN(at) AS at FROM issue_events WHERE to_status IN ('RESOLVED', 'FALSE_ALARM') GROUP BY issue_id")}
        resolve_hours = [_seconds_between(i["created_at"], closes[i["issue_id"]]) / 3600 for i in issues if i["issue_id"] in closes]
        responses = [_seconds_between(i["alert_at"], i["decided_at"]) for i in issues if i["alert_at"] and i["decided_at"]]
        return {
            "issues": len(issues),
            "open_issues": sum(i["status"] not in CLOSED for i in issues),
            "resolved": sum(i["status"] == "RESOLVED" for i in issues),
            "false_alarms": sum(i["status"] == "FALSE_ALARM" for i in issues),
            "danger_issues": sum(bool(i["danger"]) for i in issues),
            "pending_alarms": sum(bool(i["pending_decision"]) for i in issues),
            "mttr_hours": round(statistics.mean(resolve_hours), 2) if resolve_hours else None,
            "median_alarm_response_sec": round(statistics.median(responses), 1) if responses else None,
        }

    def open_issues_by(self, column: str) -> dict[str, int]:
        with self.lock:
            return {r[0]: r[1] for r in self.conn.execute(
                f"SELECT {column}, COUNT(*) FROM issues WHERE status NOT IN ('RESOLVED','FALSE_ALARM') GROUP BY {column}")}

    def kpis(self, scope: str = "all") -> dict | None:
        k = analytics.compute_kpis(self.store.dataset, scope)
        if k is not None and scope == "all":
            k["ops"] = self.stats()
        return k

    def activity(self, asset_id: str | None = None, location_id: str | None = None, limit: int = 50) -> dict:
        clauses, args = [], []
        if asset_id:
            clauses.append("i.asset_id = ?")
            args.append(asset_id)
        if location_id:
            clauses.append("i.location_id = ?")
            args.append(location_id)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        with self.lock:
            issues = [dict(r) for r in self.conn.execute(f"SELECT * FROM issues i{where}", args)]
            events = [dict(r) for r in self.conn.execute(
                f"SELECT e.*, i.title, i.asset_id, i.location_id FROM issue_events e JOIN issues i USING (issue_id){where} "
                f"ORDER BY e.event_id DESC LIMIT ?", [*args, limit])]
        raised = len(issues)
        resolved = sum(i["status"] == "RESOLVED" for i in issues)
        false_alarms = sum(i["status"] == "FALSE_ALARM" for i in issues)
        subject = asset_id or location_id or "All equipment"
        return {"summary": f"{subject}: {raised} issues raised, {resolved} resolved, {false_alarms} false alarm"
                           f"{'s' if false_alarms != 1 else ''}, {raised - resolved - false_alarms} still open.",
                "raised": raised, "resolved": resolved, "false_alarms": false_alarms, "events": events}

    # ---------- snapshots ----------

    def _snapshot_kpis(self, ds: Dataset, mission_ids: list[str] | None, include_ops: bool) -> dict:
        ids = mission_ids if mission_ids is not None else ds.mission_ids()
        out = {"all": analytics.compute_kpis(ds, mission_ids=ids)}
        for cfg in ("V1", "V2"):
            cfg_ids = [i for i in ids if ds.missions[i]["configuration_version"] == cfg]
            out[cfg] = analytics.compute_kpis(ds, cfg, mission_ids=cfg_ids) if cfg_ids else None
        if include_ops and out["all"]:
            out["all"]["ops"] = self.stats()
        return out

    def save_snapshot(self, user: dict, label: str, note: str | None = None, *, trigger: str = "manual",
                      mission_ids: list[str] | None = None, auto_seeded: bool = False) -> dict:
        ds = self.store.dataset
        ids = mission_ids if mission_ids is not None else ds.mission_ids()
        if not ids:
            raise OpsError(400, "there is no mission data to snapshot yet")
        kpis = self._snapshot_kpis(ds, ids, include_ops=not auto_seeded)
        as_of = max(ds.missions[i]["start_time"] for i in ids)
        with self.lock, self.conn:
            cur = self.conn.execute(
                "INSERT INTO snapshots (label, note, trigger, auto_seeded, as_of, missions, kpis_json, created_by, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (label.strip() or "Snapshot", note, trigger, int(auto_seeded), as_of, len(ids), json.dumps(kpis),
                 user["name"], now()))
        return self.get_snapshot(cur.lastrowid)

    def seed_snapshots(self, ds: Dataset) -> int:
        """First run only: one cumulative snapshot per BASELINE mission day, so the history chart starts filled."""
        with self.lock:
            if self.conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]:
                return 0
        baseline = [i for i in ds.mission_ids() if ds.missions[i]["scenario"] == "BASELINE"]
        count, so_far = 0, []
        for day, ids in groupby(baseline, key=lambda i: ds.missions[i]["start_time"][:10]):
            so_far += list(ids)
            self.save_snapshot(SYSTEM_USER, f"Baseline through {day}", "auto-seeded from the BASELINE missions",
                               trigger="seed", mission_ids=list(so_far), auto_seeded=True)
            count += 1
        return count

    @staticmethod
    def _snapshot_row(row) -> dict:
        d = dict(row)
        d["kpis"] = json.loads(d.pop("kpis_json"))
        d["auto_seeded"] = bool(d["auto_seeded"])
        return d

    def list_snapshots(self) -> list[dict]:
        with self.lock:
            rows = [self._snapshot_row(r) for r in self.conn.execute("SELECT * FROM snapshots ORDER BY as_of, snapshot_id")]
        # The timeline only needs the headline numbers; the full KPIs are at /ops/snapshots/{id}.
        headline = ("mission_completion_pct", "action_success_pct", "anomalies_per_mission", "avg_battery_drain_pct",
                    "hidden_failure_missions", "avg_predicted_failure_risk")
        for r in rows:
            kpis = r.pop("kpis")
            r["headline"] = {scope: ({k: v[k] for k in headline} if v else None) for scope, v in kpis.items()}
            if r["headline"].get("all") is not None and (ops := kpis["all"].get("ops")):
                r["headline"]["all"]["open_issues"] = ops["open_issues"]
        return rows

    def get_snapshot(self, snapshot_id: int) -> dict:
        with self.lock:
            row = self.conn.execute("SELECT * FROM snapshots WHERE snapshot_id = ?", (snapshot_id,)).fetchone()
        if not row:
            raise OpsError(404, f"no snapshot {snapshot_id}")
        return self._snapshot_row(row)

    def compare_snapshots(self, a: int, b: int, scope_a: str = "all", scope_b: str | None = None) -> dict:
        sa, sb = self.get_snapshot(a), self.get_snapshot(b)
        scope_b = scope_b or scope_a
        ka, kb = sa["kpis"].get(scope_a), sb["kpis"].get(scope_b)
        if not ka or not kb:
            raise OpsError(400, f"snapshot {a if not ka else b} has no {scope_a if not ka else scope_b} data")
        changes = analytics.compare_kpis(ka, kb)
        return {
            "a": {k: sa[k] for k in ("snapshot_id", "label", "as_of", "created_at")} | {"scope": scope_a},
            "b": {k: sb[k] for k in ("snapshot_id", "label", "as_of", "created_at")} | {"scope": scope_b},
            "improved": sum(c["verdict"] == "improved" for c in changes),
            "degraded": sum(c["verdict"] == "degraded" for c in changes),
            "changes": changes,
        }

    # ---------- live ingest ----------

    def on_ingest(self, event: dict):
        """Called by POST /ops/ingest-hook. Work happens on a background thread so the ingest API isn't kept waiting."""
        self._hooks.put(event)
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._drain_hooks, name="ops-ingest", daemon=True)
            self._worker.start()

    def _drain_hooks(self):
        while True:
            try:
                events = [self._hooks.get(timeout=2)]
            except queue.Empty:
                return
            while not self._hooks.empty():
                events.append(self._hooks.get_nowait())
            try:
                self.process_ingest(events)
            except Exception:
                log.exception("could not process ingest notification for %s", [e.get("mission_id") for e in events])

    def process_ingest(self, events: list[dict]):
        ds = self.store.refresh()
        alert_ids = {a.get("anomaly_id") for e in events for a in e.get("alerts") or [] if a.get("anomaly_id")}
        created = self.sync_issues(ds, alert_ids)
        missions = [e.get("mission_id") for e in events if e.get("mission_id")]
        self.save_snapshot(SYSTEM_USER, f"After {', '.join(missions)} arrived (live)",
                           f"{len(created)} new issue(s), {len(alert_ids)} alarm(s)", trigger="ingest")
        log.info("processed live missions %s: %d new issues, %d alarms", missions, len(created), len(alert_ids))

    def close(self):
        with self.lock:
            self.conn.close()
