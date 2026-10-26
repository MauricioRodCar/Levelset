"""/bars: today's intraday price bars for one symbol (the Pipeline view's charts).

Demo mode reads the vendored fixtures (the trader-entry chart the demo seeds, then the scanner's
5-minute wall) and keeps only the bars completed by the pinned clock. Live mode reads Yahoo's
public chart JSON, the same free source the skills use.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import re
import urllib.error
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, Query

from ..context import DEMO_CHARTS, EngineContext
from .deps import Services, require_token, services
from .errors import ApiError
from .models import ApiModel, dump

router = APIRouter(dependencies=[Depends(require_token)])

TICKER = re.compile(r"^[A-Z]{1,5}([.\-][A-Z]{1,2})?$")
INTERVAL_SECONDS = {"1m": 60, "5m": 300}
OPENING_RANGE_SECONDS = 15 * 60
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=%s&range=1d"
USER_AGENT = "Mozilla/5.0 (Levelset; local desktop app)"


class Bar(ApiModel):
    t: int
    o: float
    h: float
    l: float  # noqa: E741 - the contract's field name
    c: float
    v: float


class Bars(ApiModel):
    NULLABLE = frozenset({"rangeHigh", "rangeLow"})
    symbol: str
    interval: Literal["1m", "5m"]
    bars: list[Bar]
    range_high: Optional[float] = None
    range_low: Optional[float] = None


# ---------------------------------------------------------------- parsing

def parse_yahoo_chart(doc: dict[str, Any]) -> tuple[list[dict[str, Any]], int | None]:
    """Yahoo chart JSON -> ([{t,o,h,l,c,v}], regular session start). Bars with a missing price are skipped."""
    try:
        res = doc["chart"]["result"][0]
    except (KeyError, IndexError, TypeError):
        return [], None
    ts = res.get("timestamp") or []
    q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    out: list[dict[str, Any]] = []
    for i, t in enumerate(ts):
        try:
            o, h, l, c = (q[k][i] for k in ("open", "high", "low", "close"))
        except (KeyError, IndexError, TypeError):
            continue
        if None in (o, h, l, c):
            continue
        v = (q.get("volume") or [0] * len(ts))[i] or 0
        nd = 2 if float(c) >= 1 else 4  # cents, like the skills; sub-dollar stocks keep 4 decimals
        out.append({"t": int(t), "o": round(float(o), nd), "h": round(float(h), nd), "l": round(float(l), nd),
                    "c": round(float(c), nd), "v": float(v)})
    period = ((res.get("meta") or {}).get("currentTradingPeriod") or {}).get("regular") or {}
    start = period.get("start")
    return out, int(start) if start else None


def completed(bars: list[dict[str, Any]], interval: str, now_ts: int) -> list[dict[str, Any]]:
    """Only bars that closed by now_ts, on the interval grid (drops Yahoo's trailing 'last trade' tick)."""
    step = INTERVAL_SECONDS[interval]
    return [b for b in bars if b["t"] % step == 0 and b["t"] + step <= now_ts]


def opening_range(bars: list[dict[str, Any]], session_start: int | None,
                  step: int) -> tuple[float | None, float | None]:
    """High/low of the first 15 minutes, once the range's last bar is in."""
    if not bars:
        return None, None
    start = session_start if session_start else bars[0]["t"]
    first = [b for b in bars if start <= b["t"] < start + OPENING_RANGE_SECONDS]
    if not first or max(b["t"] for b in bars) < start + OPENING_RANGE_SECONDS - step:
        return None, None
    return max(b["h"] for b in first), min(b["l"] for b in first)


# ---------------------------------------------------------------- sources

@lru_cache(maxsize=4)
def _wall(path: str) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def demo_chart(ctx: EngineContext, symbol: str) -> dict[str, Any] | None:
    own = ctx.ws.path(DEMO_CHARTS) / ("%s.json" % symbol)
    if own.is_file():
        return json.loads(own.read_text(encoding="utf-8"))
    wall = Path(ctx.fixtures) / "trader-scanner" / "wall5m-2026-10-19.json.gz"
    if wall.is_file():
        return _wall(str(wall)).get(symbol)
    return None


def yahoo_chart(symbol: str, interval: str) -> dict[str, Any]:
    req = urllib.request.Request(YAHOO_URL % (symbol, interval), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310 - fixed https URL
        return json.loads(resp.read().decode("utf-8"))


# ---------------------------------------------------------------- route

@router.get("/bars", response_model=Bars)
async def bars(symbol: str = Query(...), interval: Literal["1m", "5m"] = Query("5m"),
               range: Literal["1d"] = Query("1d"),  # noqa: A002 - the contract's parameter name
               s: Services = Depends(services)) -> dict[str, Any]:
    sym = symbol.strip().upper()
    if not TICKER.match(sym):
        raise ApiError(422, "invalid_ticker", "Invalid ticker", symbol)
    ctx = s.ctx
    if ctx.demo:
        doc = demo_chart(ctx, sym)
        if doc is None:
            raise ApiError(404, "not_found", "No demo bars for this symbol", sym)
        rows, start = parse_yahoo_chart(doc)
        rows = completed(rows, "5m", int(ctx.clock.now().timestamp()))  # the fixtures are 5-minute bars
        interval = "5m"
    else:
        try:
            doc = await asyncio.to_thread(yahoo_chart, sym, interval)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise ApiError(404, "not_found", "No bars for this symbol", sym)
            raise ApiError(502, "bars_failed", "Bars could not be fetched", str(e))
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            raise ApiError(502, "bars_failed", "Bars could not be fetched", str(e))
        rows, start = parse_yahoo_chart(doc)
        rows = [b for b in rows if b["t"] % INTERVAL_SECONDS[interval] == 0]
    if not rows and ctx.demo:
        raise ApiError(404, "not_found", "No bars yet for this symbol", sym)
    hi, lo = opening_range(rows, start, INTERVAL_SECONDS[interval])
    return dump(Bars(symbol=sym, interval=interval, bars=[Bar(**b) for b in rows], range_high=hi, range_low=lo))
