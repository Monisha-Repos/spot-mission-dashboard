import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


def make_settings(tmp_path: Path, **extra) -> Settings:
    # Explicit values only: no .env files, no Databricks, no LLM.
    return Settings(values={"LAKEHOUSE": "kit", "OPS_DB": str(tmp_path / "ops.db"), "OPS_PIN": "2468",
                            "OPS_SECRET": "test-secret", "ASK_PROVIDER": "none", **extra})


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(make_settings(tmp_path))) as c:
        yield c


@pytest.fixture
def operator(client):
    token = client.post("/ops/login", json={"name": "Dana", "role": "operator", "pin": "2468"}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def supervisor(client):
    token = client.post("/ops/login", json={"name": "Sam", "role": "supervisor", "pin": "2468"}).json()["token"]
    return {"Authorization": f"Bearer {token}"}
