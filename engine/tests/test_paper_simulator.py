"""Paper simulator rules (levelset_engine/paper/simulator.py): pure functions, no engine."""

from __future__ import annotations

from levelset_engine.paper import simulator as sim

SLIP = sim.Slippage(pct=0.02, per_share=0.01)
NONE = sim.Slippage(pct=0.0, per_share=0.0)
T0 = 1_800_000_000 - 1_800_000_000 % 300  # any bar start on the 5-minute grid
FAR = T0 + 10 * 3600  # flat-by far away


def bar(i: int, o: float, h: float, low: float, c: float) -> dict:
    return {"t": T0 + 300 * i, "o": o, "h": h, "l": low, "c": c, "v": 1000.0}


def test_slippage_is_adverse_on_both_sides():
    assert sim.buy_fill(100.0, SLIP) == 100.03      # 100 * 1.0002 + 0.01
    assert sim.sell_fill(100.0, SLIP) == 99.97      # 100 * 0.9998 - 0.01
    assert sim.buy_fill(364.21, SLIP) == 364.29
    assert sim.sell_fill(366.68, SLIP) == 366.6
    assert sim.buy_fill(50.0, NONE) == 50.0 and sim.sell_fill(50.0, NONE) == 50.0
    for ref in (1.0, 12.34, 99.99, 364.18):  # never a better price than the reference
        assert sim.buy_fill(ref, SLIP) >= ref and sim.sell_fill(ref, SLIP) <= ref


def test_entry_is_the_open_of_the_next_bar_after_the_ticket():
    bars = [bar(0, 10, 10.5, 9.9, 10.2), bar(1, 10.3, 10.6, 10.1, 10.4), bar(2, 10.5, 10.7, 10.4, 10.6)]
    i, f = sim.entry_fill(bars, T0 + 300, SLIP)        # created exactly at a bar start: that bar
    assert (i, f.t, f.ref) == (1, T0 + 300, 10.3)
    i, f = sim.entry_fill(bars, T0 + 301, SLIP)        # created inside bar 1: the next one
    assert (i, f.ref, f.price) == (2, 10.5, sim.buy_fill(10.5, SLIP))
    assert sim.entry_fill(bars, T0 + 900, SLIP) is None  # that bar has not started yet


def test_stop_first_when_stop_and_target_touch_in_the_same_bar():
    b = bar(0, 100, 105, 97, 101)  # stop 98 and target 104 both inside
    ex = sim.exit_on_bar(b, 98.0, 104.0, FAR, SLIP)
    assert ex.reason == "stop" and ex.ref == 98.0 and ex.price == sim.sell_fill(98.0, SLIP)
    assert ex.t == T0 + 300  # at the bar's end, never before the bar ran


def test_target_and_stop_alone():
    assert sim.exit_on_bar(bar(0, 100, 104.5, 99, 104), 98.0, 104.0, FAR, NONE).reason == "target"
    assert sim.exit_on_bar(bar(0, 100, 104.5, 99, 104), 98.0, 104.0, FAR, NONE).price == 104.0
    assert sim.exit_on_bar(bar(0, 100, 101, 97.5, 98), 98.0, 104.0, FAR, NONE).price == 98.0
    assert sim.exit_on_bar(bar(0, 100, 103, 99, 101), 98.0, 104.0, FAR, NONE) is None


def test_gaps_fill_at_the_bar_open_not_at_the_level():
    down = sim.exit_on_bar(bar(0, 96.5, 97, 95, 96), 98.0, 104.0, FAR, NONE)
    assert (down.reason, down.ref, down.price, down.t) == ("stop", 96.5, 96.5, T0)  # worse than the stop
    up = sim.exit_on_bar(bar(0, 106, 107, 105, 106.5), 98.0, 104.0, FAR, SLIP)
    assert (up.reason, up.ref) == ("target", 106)
    assert up.price == sim.sell_fill(106, SLIP) <= 106  # the open, minus slippage; never above the bar


def test_flat_by_closes_at_the_bar_that_ends_at_flat_by():
    bars = [bar(i, 100, 101, 99.5, 100 + i / 10) for i in range(6)]
    flat = T0 + 300 * 4  # the bar starting at T0+900 ends at flat-by
    nxt, ex = sim.walk(bars, 0, 98.0, 104.0, flat, NONE)
    assert ex.reason == "flat_by" and ex.ref == bars[3]["c"] and ex.t == flat and nxt == 4
    # the bar ending at flat-by is missing: the first bar after it closes at its open
    gap = [bars[0], bars[1], bars[5]]
    _, ex = sim.walk(gap, 0, 98.0, 104.0, flat, NONE)
    assert ex.reason == "flat_by" and ex.ref == bars[5]["o"]


def test_walk_resumes_and_flatten():
    bars = [bar(i, 100, 101, 99.5, 100.5) for i in range(3)]
    nxt, ex = sim.walk(bars, 0, 98.0, 104.0, FAR, SLIP)
    assert ex is None and nxt == 3
    f = sim.flatten(bars[-1], SLIP)
    assert f.reason == "flat_by" and f.ref == 100.5 and f.t == bars[-1]["t"] + 300
    assert sim.flatten(bars[-1], SLIP, "reset", at=5).reason == "reset"


def test_pnl_and_r():
    assert sim.pnl(8, 364.29, 366.6) == 18.48
    assert sim.r_multiple(18.48, 5.86, 8) == 0.39
    assert sim.r_multiple(-46.88, 5.86, 8) == -1.0
    assert sim.r_multiple(10, 0, 8) is None
