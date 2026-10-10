"""SQLite storage for the Operator Console (data/ops.db). It never touches the mission data."""
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS issues (
    issue_id         TEXT PRIMARY KEY,
    source_type      TEXT NOT NULL CHECK (source_type IN ('ANOMALY', 'FAILED_ACTION')),
    source_id        TEXT NOT NULL UNIQUE,
    mission_id       TEXT NOT NULL,
    action_id        TEXT NOT NULL,
    location_id      TEXT NOT NULL,
    asset_id         TEXT NOT NULL,
    severity         TEXT NOT NULL,
    title            TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'OPEN',
    assignee         TEXT,
    danger           INTEGER NOT NULL DEFAULT 0,
    pending_decision INTEGER NOT NULL DEFAULT 0,
    alert_at         TEXT,
    decided_at       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

-- Audit trail: rows can be added, never changed or removed.
CREATE TABLE IF NOT EXISTS issue_events (
    event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id    TEXT NOT NULL REFERENCES issues(issue_id),
    kind        TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    note        TEXT,
    actor       TEXT NOT NULL,
    actor_role  TEXT NOT NULL,
    at          TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS issue_events_no_update BEFORE UPDATE ON issue_events
BEGIN SELECT RAISE(ABORT, 'issue_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS issue_events_no_delete BEFORE DELETE ON issue_events
BEGIN SELECT RAISE(ABORT, 'issue_events is append-only'); END;

CREATE TABLE IF NOT EXISTS snapshots (
    snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT NOT NULL,
    note        TEXT,
    trigger     TEXT NOT NULL,
    auto_seeded INTEGER NOT NULL DEFAULT 0,
    as_of       TEXT,
    missions    INTEGER NOT NULL,
    kpis_json   TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS snapshots_no_update BEFORE UPDATE ON snapshots
BEGIN SELECT RAISE(ABORT, 'snapshots are read-only once saved'); END;

CREATE INDEX IF NOT EXISTS issue_events_by_issue ON issue_events(issue_id);
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    return conn
