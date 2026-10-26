"""EngineContext: one object holding everything a request or a background task needs."""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from typing import Any

from . import __version__
from .adapters.calendar import MarketCalendar
from .adapters.settings_map import effective_config
from .config import EngineConfig
from .events import EventBus
from .runner import SkillResult, SkillRunner
from .storage import Database, Workspace
from .storage import workspace as wsf

DEMO_CHARTS = "demo-data/charts"  # <TICKER>.json for trader-entry / trader-exit --offline


def new_id(prefix: str) -> str:
    return "%s_%s" % (prefix, uuid.uuid4().hex[:12])


class EngineContext:
    def __init__(self, config: EngineConfig) -> None:
        self.config = config
        self.clock = config.clock
        self.version = __version__
        self.ws = Workspace(config.workspace)
        self.db = Database(config.db_path)
        self.runner = SkillRunner(config.skills_dir, config.workspace, demo=config.demo,
                                  timeout=config.skill_timeout)
        self.calendar = MarketCalendar(config.skills_dir)
        self.bus = EventBus()
        self._lock: asyncio.Lock | None = None
        self.tasks: dict[str, asyncio.Task[Any]] = {}
        self.seed()

    # ---------------------------------------------------------------- setup
    @property
    def demo(self) -> bool:
        return self.config.demo

    @property
    def fixtures(self) -> Path:
        return self.config.fixtures_dir

    def seed(self) -> None:
        """Make sure the workspace has a config; in demo mode also the offline chart files."""
        example = self.config.skills_dir / "trader-budget" / "config.example.json"
        self.ws.seed_config(example, {"sec_user_agent": "", "budget": 5000, "paper": True})
        if self.demo:
            src = self.fixtures / "trader-entry" / "TSLA-2026-10-19-5m.json"
            dst = DEMO_CHARTS + "/TSLA.json"
            if src.is_file() and not self.ws.exists(dst):
                self.ws.copy_in(src, dst)

    @property
    def lock(self) -> asyncio.Lock:
        """Serializes everything that touches the trader/ files."""
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    def config_doc(self) -> dict[str, Any]:
        return effective_config(self.ws.read_json(wsf.CONFIG, {}))

    # ---------------------------------------------------------------- skills
    def demo_args(self, skill: str, sub: str | None = None) -> list[str]:
        """--offline arguments that make a skill read the vendored fixtures instead of the network."""
        if not self.demo:
            return []
        fx = self.fixtures
        if skill == "scanner":
            name = "daily-spark-2026-10-19.json" if sub == "daily" else "wall5m-2026-10-19.json.gz"
            return ["--offline", str(fx / "trader-scanner" / name)]
        if skill == "news":
            return ["--offline", str(fx / "trader-news"), "--no-sec", "--no-moves"]
        if skill in ("entry", "exit"):
            return ["--offline", str(self.ws.path(DEMO_CHARTS))]
        if skill == "timemachine":
            return ["--offline", str(fx / "trader-timemachine")]
        if skill == "alerts":
            return ["--offline", str(fx / "trader-alerts")]
        return []

    def now_args(self, iso_style: bool = False) -> list[str]:
        v = self.clock.skill_now_iso() if iso_style else self.clock.skill_now()
        return ["--now", v] if v else []

    def run_skill_blocking(self, skill: str, args: list[str], json_output: bool = True,
                           timeout: float | None = None) -> SkillResult:
        return self.runner.run(skill, args, json_output=json_output, timeout=timeout)

    async def run_skill(self, skill: str, args: list[str], json_output: bool = True,
                        timeout: float | None = None, locked: bool = False) -> SkillResult:
        """Run a skill in a worker process without blocking the event loop.

        locked=True means the caller already holds self.lock."""
        if locked:
            return await asyncio.to_thread(self.run_skill_blocking, skill, args, json_output, timeout)
        async with self.lock:
            return await asyncio.to_thread(self.run_skill_blocking, skill, args, json_output, timeout)

    def close(self) -> None:
        self.db.close()
