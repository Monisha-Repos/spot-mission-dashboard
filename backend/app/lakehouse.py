"""Reads the six lakehouse tables from Databricks, the ingest API's local CSV lakehouse, or the raw kit."""
from __future__ import annotations

import csv
import re
import time
from pathlib import Path

import httpx

from .config import Settings

TABLES = ["locations", "assets", "missions", "actions", "readings", "anomalies"]
INT_COLUMNS = {"floor", "duration_min", "start_battery_pct", "end_battery_pct", "sequence", "battery_pct", "duration_sec"}
FLOAT_COLUMNS = {"x_coord", "y_coord", "value"}
BOOL_COLUMNS = {"synthetic", "operator_review_required"}
TIMESTAMP_COLUMNS = {"start_time", "end_time", "timestamp"}


class LakehouseError(RuntimeError):
    pass


def load_tables(settings: Settings) -> tuple[dict[str, list[dict]], str]:
    """Returns (tables, description of the source)."""
    if settings.lakehouse == "databricks":
        reader = DatabricksReader(settings)
        return {t: [_typed(r) for r in reader.select_all(t)] for t in TABLES}, reader.describe()
    folder = settings.lakehouse_dir if settings.lakehouse == "local" else settings.kit_dir
    return {t: [_typed(r) for r in _read_csv(folder / f"{t}.csv")] for t in TABLES}, f"{settings.lakehouse} {folder}"


def load_kit_tables(settings: Settings) -> dict[str, list[dict]]:
    """The raw challenge kit, typed like the lakehouse (the sandbox replays missions from it)."""
    return {t: [_typed(r) for r in _read_csv(settings.kit_dir / f"{t}.csv")] for t in TABLES}


def _read_csv(path: Path) -> list[dict]:
    if not path.exists():
        raise LakehouseError(f"{path} not found. Seed the lakehouse first (ingest-api: seed --reset).")
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def _typed(row: dict) -> dict:
    out = {}
    for key, value in row.items():
        if value is None or value == "":
            out[key] = None
        elif key in INT_COLUMNS:
            out[key] = int(float(value))
        elif key in FLOAT_COLUMNS:
            out[key] = float(value)
        elif key in BOOL_COLUMNS:
            out[key] = str(value).lower() == "true"
        elif key in TIMESTAMP_COLUMNS:
            # Databricks returns "2026-09-01T18:00:00.000Z"; the kit has "2026-09-01T18:00:00".
            out[key] = re.sub(r"(\.\d+)?Z?$", "", str(value).replace(" ", "T"))
        else:
            out[key] = value
    return out


class DatabricksReader:
    """Minimal client for the SQL Statement Execution API (same API the Java ingest service writes with)."""

    def __init__(self, settings: Settings):
        missing = [k for k, v in {"DATABRICKS_HOST": settings.databricks_host, "DATABRICKS_TOKEN": settings.databricks_token,
                                  "DATABRICKS_HTTP_PATH": settings.databricks_warehouse_id}.items() if not v]
        if missing:
            raise LakehouseError(f"LAKEHOUSE=databricks but {', '.join(missing)} not set")
        self.settings = settings
        self.client = httpx.Client(base_url=settings.databricks_host, timeout=60,
                                   headers={"Authorization": f"Bearer {settings.databricks_token}"})

    def describe(self) -> str:
        return f"databricks {self.settings.databricks_catalog}.{self.settings.databricks_schema}"

    def select_all(self, table: str) -> list[dict]:
        name = f"`{self.settings.databricks_catalog}`.`{self.settings.databricks_schema}`.`{table}`"
        result = self._execute(f"SELECT * FROM {name}")
        columns = [c["name"] for c in result["manifest"]["schema"]["columns"]]
        rows, chunk = [], result.get("result") or {}
        while True:
            rows.extend(dict(zip(columns, values)) for values in chunk.get("data_array") or [])
            link = chunk.get("next_chunk_internal_link")
            if not link:
                return rows
            chunk = self._send("GET", link)

    def _execute(self, sql: str) -> dict:
        response = self._send("POST", "/api/2.0/sql/statements", json={
            "warehouse_id": self.settings.databricks_warehouse_id, "statement": sql,
            "wait_timeout": "30s", "on_wait_timeout": "CONTINUE"})
        deadline = time.monotonic() + 300
        while True:
            state = response["status"]["state"]
            if state == "SUCCEEDED":
                return response
            if state not in {"PENDING", "RUNNING"}:
                message = (response["status"].get("error") or {}).get("message", "no details")
                raise LakehouseError(f"Databricks statement {state}: {message}")
            if time.monotonic() > deadline:
                raise LakehouseError("Databricks statement still running after 5 min. Is the SQL warehouse running?")
            time.sleep(1)
            response = self._send("GET", f"/api/2.0/sql/statements/{response['statement_id']}")

    def _send(self, method: str, url: str, **kwargs) -> dict:
        # Databricks sometimes drops idle keep-alive connections; every statement here is a read-only
        # SELECT, so retrying is safe.
        for attempt in range(4):
            try:
                response = self.client.request(method, url, **kwargs)
                break
            except httpx.TransportError as e:
                if attempt == 3:
                    raise LakehouseError(f"cannot reach Databricks: {e}") from e
                time.sleep(2 ** attempt)
        if response.status_code in (401, 403):
            raise LakehouseError(f"Databricks rejected the token (HTTP {response.status_code}). Check DATABRICKS_TOKEN.")
        if response.status_code >= 300:
            raise LakehouseError(f"Databricks HTTP {response.status_code}: {response.text[:300]}")
        return response.json()
