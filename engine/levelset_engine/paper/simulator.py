"""Paper fills on 5-minute bars: pure functions, no I/O.

Rules (docs/V1.1-PRD.md §3 P1, decisions §9):
- Entry: the open of the first bar that starts at or after the ticket was created, plus slippage.
- Exit, bar by bar from the entry bar on (long side, like the skills):
    a bar that opens at or through the stop / target (a gap) fills at that bar's open;
    else stop and target both inside one bar count as the stop (pessimistic);
    else the stop, else the target;
    the bar that ends at the flat-by time closes the position at its close (flat_by).
- Slippage is adverse on both sides: buy = ref * (1 + pct/100) + perShare,
  sell = ref * (1 - pct/100) - perShare. A fill is never better than the bar allows.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

BAR_SECONDS = 300


@dataclass(frozen=True)
class Slippage:
    pct: float = 0.02        # percent: 0.02 = 0.02 %
    per_share: float = 0.01  # USD per share, each side


def buy_fill(ref: float, slip: Slippage) -> float:
    px = round(ref * (1 + slip.pct / 100.0) + slip.per_share, 2)
    return max(px, round(ref, 2))


def sell_fill(ref: float, slip: Slippage) -> float:
    px = round(ref * (1 - slip.pct / 100.0) - slip.per_share, 2)
    return max(0.0, min(px, round(ref, 2)))


@dataclass
class Fill:
    t: int            # bar start (entry) or the moment of the exit, Unix seconds
    ref: float        # the bar price the fill is based on, before slippage
    price: float      # incl. slippage
    reason: str | None = None   # exits: stop | target | flat_by | reset


def entry_fill(bars: list[dict[str, Any]], created_ts: int, slip: Slippage) -> tuple[int, Fill] | None:
    """(index of the entry bar, fill) or None while that bar has not started yet."""
    for i, b in enumerate(bars):
        if b["t"] >= created_ts:
            return i, Fill(t=b["t"], ref=float(b["o"]), price=buy_fill(float(b["o"]), slip))
    return None


def exit_on_bar(bar: dict[str, Any], stop: float, target: float, flat_ts: int, slip: Slippage) -> Fill | None:
    """The exit this bar makes, if any (long)."""
    o, h, low, c, t = float(bar["o"]), float(bar["h"]), float(bar["l"]), float(bar["c"]), int(bar["t"])
    if t >= flat_ts:  # a bar that starts at or after flat-by (the one ending there was missing): first price after
        return Fill(t=t, ref=o, price=sell_fill(o, slip), reason="flat_by")
    if o <= stop:
        return Fill(t=t, ref=o, price=sell_fill(o, slip), reason="stop")
    if o >= target:
        return Fill(t=t, ref=o, price=sell_fill(o, slip), reason="target")
    if low <= stop:  # also when the target was touched in the same bar: the stop first
        return Fill(t=t + BAR_SECONDS, ref=stop, price=sell_fill(stop, slip), reason="stop")
    if h >= target:
        return Fill(t=t + BAR_SECONDS, ref=target, price=sell_fill(target, slip), reason="target")
    if t + BAR_SECONDS >= flat_ts:
        return Fill(t=t + BAR_SECONDS, ref=c, price=sell_fill(c, slip), reason="flat_by")
    return None


def walk(bars: list[dict[str, Any]], start: int, stop: float, target: float, flat_ts: int,
         slip: Slippage) -> tuple[int, Fill | None]:
    """Check bars[start:] for an exit. Returns (index of the next bar to check, exit or None)."""
    for i in range(start, len(bars)):
        ex = exit_on_bar(bars[i], stop, target, flat_ts, slip)
        if ex is not None:
            return i + 1, ex
    return len(bars), None


def flatten(last_bar: dict[str, Any], slip: Slippage, reason: str = "flat_by", at: int | None = None) -> Fill:
    """Close at the last bar's close: the session (or the data) ended, or the account was reset."""
    c = float(last_bar["c"])
    return Fill(t=at if at is not None else int(last_bar["t"]) + BAR_SECONDS, ref=c, price=sell_fill(c, slip),
                reason=reason)


def pnl(qty: int, entry_price: float, exit_price: float) -> float:
    return round((exit_price - entry_price) * qty, 2)


def r_multiple(pnl_usd: float, risk_per_share: float, qty: int) -> float | None:
    risk = float(risk_per_share) * int(qty)
    return round(pnl_usd / risk, 2) if risk > 0 else None
