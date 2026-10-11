"""Settings from environment variables, backend/.env, and (for shared Databricks values) ingest-api/.env."""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent


def load_values() -> dict[str, str]:
    values: dict[str, str] = {}
    # The Databricks credentials already live in ingest-api/.env; backend/.env and real
    # environment variables override them.
    for env_file in (REPO_DIR / "ingest-api" / ".env", BACKEND_DIR / ".env"):
        if env_file.exists():
            values.update({k: v for k, v in dotenv_values(env_file).items() if v})
    values.update({k: v for k, v in os.environ.items() if v})
    return values


class Settings:
    def __init__(self, values: dict[str, str] | None = None):
        v = load_values() if values is None else dict(values)
        self.values = v

        def path(key: str, default: Path) -> Path:
            raw = v.get(key)
            if not raw:
                return default
            p = Path(raw)
            return p if p.is_absolute() else (BACKEND_DIR / p).resolve()

        # Databricks (same variables as the ingest API).
        host = v.get("DATABRICKS_HOST", "").strip()
        if host:
            parts = urlsplit(host if "://" in host else "https://" + host)
            host = f"{parts.scheme}://{parts.netloc}"
        self.databricks_host = host
        self.databricks_token = v.get("DATABRICKS_TOKEN", "")
        http_path = v.get("DATABRICKS_HTTP_PATH", "").rstrip("/")
        self.databricks_warehouse_id = v.get("DATABRICKS_WAREHOUSE_ID") or (http_path.rsplit("/", 1)[-1] if http_path else "")
        self.databricks_catalog = v.get("DATABRICKS_CATALOG", "workspace")
        self.databricks_schema = v.get("DATABRICKS_SCHEMA", "spot")

        self.lakehouse_dir = path("LAKEHOUSE_DIR", REPO_DIR / "data" / "lakehouse")
        self.kit_dir = path("KIT_DATA_DIR", REPO_DIR / "data" / "kit")
        # Where mission data is read from: databricks, local (the ingest API's CSV lakehouse) or kit.
        source = (v.get("LAKEHOUSE") or v.get("SINK") or "").lower()
        if not source:
            if self.databricks_host:
                source = "databricks"
            elif (self.lakehouse_dir / "missions.csv").exists():
                source = "local"
            else:
                source = "kit"
        if source not in {"databricks", "local", "kit"}:
            raise ValueError(f"LAKEHOUSE must be databricks, local or kit, got {source!r}")
        self.lakehouse = source

        self.assets_dir = REPO_DIR / "assets"
        self.docs_dir = REPO_DIR / "docs"
        self.model_path = path("MODEL_PATH", REPO_DIR / "ml" / "model.joblib")
        self.metrics_path = path("METRICS_PATH", REPO_DIR / "ml" / "metrics.json")

        # Operator Console.
        self.ops_enabled = v.get("OPS_ENABLED", "true").lower() not in {"0", "false", "no"}
        self.ops_db = path("OPS_DB", REPO_DIR / "data" / "ops.db")
        self.ops_pin = v.get("OPS_PIN", "")
        # Without OPS_SECRET, sign-ins last until the server restarts.
        self.ops_secret = v.get("OPS_SECRET") or secrets.token_hex(32)
        self.ingest_api_key = v.get("INGEST_API_KEY", "")
        # The Java ingest API, which runs the presenter-mode live feed (the Operator Console drives it through /ops/live).
        self.ingest_url = v.get("INGEST_URL", "http://localhost:8081").rstrip("/")

        # Hugging Face repos with the published dataset splits and model, linked from the Data Analysis tab.
        self.hf_dataset_repo = v.get("HF_DATASET_REPO", "")
        self.hf_model_repo = v.get("HF_MODEL_REPO", "")

        # AI assistant: anthropic, huggingface or none (answers with the matching records only).
        provider = (v.get("ASK_PROVIDER") or "").lower()
        if not provider:
            if v.get("ANTHROPIC_API_KEY") or v.get("ANTHROPIC_AUTH_TOKEN"):
                provider = "anthropic"
            elif v.get("HF_TOKEN"):
                provider = "huggingface"
            else:
                provider = "none"
        self.ask_provider = provider
        self.anthropic_model = v.get("ANTHROPIC_MODEL", "claude-opus-5-5")
        self.ask_effort = v.get("ASK_EFFORT", "low")
        self.hf_token = v.get("HF_TOKEN", "")
        # Strong instruct model that answers without a thinking phase; the small fallback covers provider outages.
        self.hf_chat_model = v.get("HF_CHAT_MODEL", "Qwen/Qwen3-235B-A22B-Instruct-2507")
        self.hf_fallback_model = v.get("HF_FALLBACK_MODEL", "meta-llama/Llama-3.1-8B-Instruct")
        # Inference provider for the main model ("auto" lets Hugging Face pick); pinning one keeps the price predictable.
        self.hf_provider = v.get("HF_PROVIDER", "deepinfra")
        # Spend guard for paid inference: once the estimated spend this month reaches the budget, /ask answers with
        # the matching records only. Spend is kept in ASK_SPEND_FILE so it survives restarts.
        self.ask_budget_usd = float(v.get("ASK_BUDGET_USD", "5"))
        self.ask_spend_file = path("ASK_SPEND_FILE", REPO_DIR / "data" / "ask_spend.json")
        # Per-visitor limits on LLM questions (cached answers and the no-LLM fallback don't count).
        self.ask_per_minute = int(v.get("ASK_PER_MINUTE", "6"))
        self.ask_per_hour = int(v.get("ASK_PER_HOUR", "40"))

        self.cors_origins = [o.strip() for o in v.get("CORS_ORIGINS", "*").split(",") if o.strip()]
