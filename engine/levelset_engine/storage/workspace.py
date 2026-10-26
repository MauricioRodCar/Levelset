"""The skills' working folder: trader/*.json and trader/state/*.json.

The skills read and write these files relative to the workspace. The engine
reads them after each step, snapshots the per-trade files into SQLite and
restores a run's snapshot before its next step, so runs never see each
other's half-finished files.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

CONFIG = "trader/config.json"
PORTFOLIO = "trader/portfolio.json"
PRICES = "trader/prices.json"
WATCHLIST = "trader/watchlist.json"
ENTRY = "trader/entry.json"
PLAN = "trader/plan.json"
TIMEMACHINE = "trader/timemachine.json"
ORDERS = "trader/orders.json"
RISK = "trader/state/risk.json"
BROKER = "trader/state/broker.json"
ALERT_RULES = "trader/alerts.json"
ALERT_STATE = "trader/state/alerts.json"

# Files that belong to one pipeline run. Restored (or removed) before each step.
RUN_FILES = (WATCHLIST, ENTRY, PLAN, TIMEMACHINE, ORDERS, RISK)
# Restored when a run has them but never deleted (the dashboard reads the last scan).
KEEP_FILES = (WATCHLIST,)


class Workspace:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        (self.root / "trader" / "state").mkdir(parents=True, exist_ok=True)

    def path(self, rel: str) -> Path:
        return self.root / rel

    def exists(self, rel: str) -> bool:
        return self.path(rel).is_file()

    def read_json(self, rel: str, default: Any = None) -> Any:
        p = self.path(rel)
        if not p.is_file():
            return default
        try:
            with open(p, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return default

    def write_json(self, rel: str, doc: Any) -> None:
        p = self.path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, p)

    def remove(self, rel: str) -> None:
        try:
            self.path(rel).unlink()
        except FileNotFoundError:
            pass

    def snapshot(self, rels: tuple[str, ...] = RUN_FILES) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for rel in rels:
            doc = self.read_json(rel)
            if doc is not None:
                out[rel] = doc
        return out

    def restore(self, snap: dict[str, Any] | None, rels: tuple[str, ...] = RUN_FILES) -> None:
        snap = snap or {}
        for rel in rels:
            if rel in snap:
                self.write_json(rel, snap[rel])
            elif rel not in KEEP_FILES:
                self.remove(rel)

    def seed_config(self, example: Path, overrides: dict[str, Any] | None = None) -> None:
        """Create trader/config.json from the skills' example if it does not exist yet."""
        if self.exists(CONFIG):
            return
        doc: dict[str, Any] = {}
        if example.is_file():
            with open(example, encoding="utf-8") as fh:
                doc = json.load(fh)
        doc.update(overrides or {})
        self.write_json(CONFIG, doc)

    def copy_in(self, src: Path, rel: str) -> None:
        dst = self.path(rel)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
