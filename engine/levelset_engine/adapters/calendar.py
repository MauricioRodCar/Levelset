"""NYSE clock: the skills' own calendar (trader-alerts market_status), loaded in-process.

alerts.py is standard library only and its clock functions are pure, so importing
it here is safe (no cwd or network involved).
"""

from __future__ import annotations

import datetime as dt
import importlib.util
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any

from ..clock import iso, ny_local_to_utc


@lru_cache(maxsize=4)
def _alerts_module(path: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location("levelset_calendar_alerts", path)
    if spec is None or spec.loader is None:
        raise ImportError(path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class MarketCalendar:
    def __init__(self, skills_dir: Path) -> None:
        self._path = str(Path(skills_dir) / "trader-alerts" / "alerts.py")

    @property
    def mod(self) -> ModuleType:
        return _alerts_module(self._path)

    def session(self, day: dt.date) -> tuple[dt.time, dt.time] | None:
        return self.mod.session(day)

    def is_trading_day(self, day: dt.date) -> bool:
        return self.session(day) is not None

    def status(self, now_utc: dt.datetime) -> dict[str, Any]:
        """{marketOpen, nextOpen, nextClose, earlyClose} with ISO New York timestamps."""
        naive = now_utc.astimezone(dt.timezone.utc).replace(tzinfo=None)
        st = self.mod.market_status(naive)
        today = dt.date.fromisoformat(st["date"])
        next_open = None
        if st.get("next_open"):
            next_open = iso(ny_local_to_utc(dt.datetime.strptime(st["next_open"], "%Y-%m-%d %H:%M")))
        next_close = None
        local_now = dt.datetime.strptime(st["now_new_york"], "%Y-%m-%d %H:%M")
        d = today
        for _ in range(15):
            s = self.session(d)
            if s and dt.datetime.combine(d, s[1]) > local_now:
                next_close = iso(ny_local_to_utc(dt.datetime.combine(d, s[1])))
                break
            d += dt.timedelta(days=1)
        return {"marketOpen": bool(st["open"]), "nextOpen": next_open, "nextClose": next_close,
                "earlyClose": bool(st.get("early_close")), "raw": st}
