"""Engine configuration: where things live and which mode we run in."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .clock import DEMO_NOW_ET, Clock

DEFAULT_PORT = 8765


def vendor_dir() -> Path:
    """The vendored skills folder; also works inside a PyInstaller bundle (sys._MEIPASS)."""
    env = os.environ.get("LEVELSET_VENDOR_DIR")
    if env:
        return Path(env)
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return Path(base) / "vendor" / "day-trader-skill"
    return Path(__file__).resolve().parent.parent / "vendor" / "day-trader-skill"


def default_workspace(demo: bool) -> Path:
    root = Path(os.environ.get("APPDATA") or Path.home()) / "Levelset" / "workspace"
    return root / "demo" if demo else root


@dataclass
class EngineConfig:
    workspace: Path
    demo: bool = False
    token: str = "dev"
    port: int = DEFAULT_PORT
    skills_dir: Path = field(default_factory=vendor_dir)
    skill_timeout: float = 120.0
    alert_interval: float = 30.0
    start_background: bool = True

    def __post_init__(self) -> None:
        self.workspace = Path(self.workspace).resolve()
        self.skills_dir = Path(self.skills_dir).resolve()
        self.clock = Clock(DEMO_NOW_ET if self.demo else None)

    @property
    def fixtures_dir(self) -> Path:
        return self.skills_dir / "tests" / "fixtures"

    @property
    def db_path(self) -> Path:
        return self.workspace / "levelset.sqlite3"
