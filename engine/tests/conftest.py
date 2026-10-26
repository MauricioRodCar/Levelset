"""Shared fixtures: a demo engine (offline fixtures, clock pinned to 2026-10-19 10:15 ET)."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Iterator

import pytest
from fastapi.testclient import TestClient

from levelset_engine.api.app import create_app
from levelset_engine.config import EngineConfig

TOKEN = "test-token"
AUTH = {"Authorization": "Bearer %s" % TOKEN}


def make_client(workspace: Path, demo: bool = True) -> TestClient:
    cfg = EngineConfig(workspace=workspace, demo=demo, token=TOKEN, start_background=False)
    return TestClient(create_app(cfg), headers=AUTH)


def wait_run(client: TestClient, run_id: str, timeout: float = 120.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get("/pipeline/runs/%s" % run_id).json()
        if run["status"] != "running":
            return run
        time.sleep(0.2)
    raise AssertionError("run %s did not finish" % run_id)


def run_all(client: TestClient, **body: Any) -> dict[str, Any]:
    r = client.post("/pipeline/runs", json=dict({"mode": "all"}, **body))
    assert r.status_code == 202, r.text
    return wait_run(client, r.json()["id"])


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    with make_client(tmp_path / "ws") as c:
        yield c


@pytest.fixture(scope="session")
def demo(tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[TestClient, dict[str, Any]]]:
    """One demo engine with the README TSLA pipeline already run (read-only tests use it)."""
    with make_client(tmp_path_factory.mktemp("demo") / "ws") as c:
        run = run_all(c)
        yield c, run
