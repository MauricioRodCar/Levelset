"""Paper account: auto-follow, the /paper/* contract, SSE events, catch-up backfill, demo TSLA reproduction."""

from __future__ import annotations

import csv
import datetime as dt
import importlib.util
import io
import json
import time
from pathlib import Path
from typing import Any

import pytest

from conftest import make_client
from contract import response_schema, spec, validate, validate_list
from levelset_engine.clock import UTC, iso, ny_local_to_utc

VENDOR = Path(__file__).resolve().parents[1] / "vendor" / "day-trader-skill"
DAY = "2026-10-20"  # a Tuesday, a normal NYSE session


def ny(day: str, hhmm: str) -> dt.datetime:
    return ny_local_to_utc(dt.datetime.combine(dt.date.fromisoformat(day), dt.time(*map(int, hhmm.split(":")))))


def wait_paper(client, ticket_id: str, status: str = "closed", timeout: float = 30.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        t = client.get("/tickets/%s" % ticket_id).json()
        if (t.get("paper") or {}).get("status") == status:
            return t
        time.sleep(0.1)
    raise AssertionError("ticket %s never reached paper status %s: %s" % (ticket_id, status, t.get("paper")))


def drain(q) -> list[tuple[str, Any]]:
    out = []
    while not q.empty():
        ev, payload = q.get_nowait()
        out.append((ev, json.loads(payload)))
    return out


# ---------------------------------------------------------------- live-mode engine with synthetic bars

def chart(bars: list[tuple[str, float, float, float, float]], day: str = DAY) -> dict[str, Any]:
    """Yahoo chart JSON from (HH:MM, o, h, l, c) rows."""
    ts = [int(ny(day, b[0]).timestamp()) for b in bars]
    return {"chart": {"result": [{"meta": {"symbol": "XYZ"}, "timestamp": ts, "indicators": {"quote": [{
        "open": [b[1] for b in bars], "high": [b[2] for b in bars], "low": [b[3] for b in bars],
        "close": [b[4] for b in bars], "volume": [1000] * len(bars)}]}}]}}


def session(overrides: dict[str, tuple[float, float, float, float]] | None = None):
    """A flat session at 100 from 09:30 to 15:55, with some bars replaced."""
    rows = []
    m = 9 * 60 + 30
    while m < 16 * 60:
        hhmm = "%02d:%02d" % divmod(m, 60)
        rows.append((hhmm,) + (overrides or {}).get(hhmm, (100.0, 100.5, 99.5, 100.0)))
        m += 5
    return rows


@pytest.fixture
def live(tmp_path):
    with make_client(tmp_path / "live", demo=False) as c:
        svc = c.app.state.paper
        svc.charts = {}
        svc.fetch = lambda sym: svc.charts[sym]
        yield c, svc


def put_ticket(c, svc, symbol: str, created: str, status: str = "ready", entry: float = 100.0,
               stop: float = 98.0, target: float = 104.0, qty: int = 10) -> dict[str, Any]:
    ctx = c.app.state.services.ctx
    t = {"id": "tkt_%s_%s" % (symbol, created.replace(":", "")), "runId": "run_x", "symbol": symbol, "side": "buy",
         "qty": qty, "orderType": "market", "timeInForce": "day", "entry": entry, "stop": stop, "target": target,
         "riskPerShare": round(entry - stop, 2), "rewardPerShare": round(target - entry, 2), "rMultiple": 2.0,
         "maxLoss": round(qty * (entry - stop), 2), "positionUsd": qty * entry, "flatBy": "15:55", "status": status,
         "riskReasons": ["daily_loss_limit"] if status == "blocked" else [], "riskDetail": [], "timeMachine": None,
         "createdAt": iso(ny(DAY, created)), "_date": DAY, "_noEntriesAfter": "15:30"}
    ctx.db.put_ticket(t)
    with ctx.clock.as_of(ny(DAY, created)):
        svc.on_ticket(t)
    return t


def test_live_auto_follow_stop_first_events_and_contract(live):
    c, svc = live
    svc.charts["XYZ"] = chart(session({"10:05": (100.2, 100.8, 99.9, 100.4),     # the entry bar
                                       "10:20": (101.0, 104.5, 97.5, 99.0)}))    # stop and target in one bar
    q = c.app.state.services.ctx.bus.subscribe()
    t = put_ticket(c, svc, "XYZ", "10:02")
    pending = c.get("/tickets/%s" % t["id"]).json()
    validate(pending, "Ticket")
    assert pending["paper"]["status"] == "pending" and pending["paper"]["entryPrice"] is None

    c.portal.call(svc.advance, ny(DAY, "10:12"))
    opened = c.get("/paper/positions").json()
    validate_list(opened, "PaperPosition")
    validate(opened, schema=response_schema("/paper/positions", "get", "200"))
    pos = opened[0]
    assert pos["avgPrice"] == 100.23 and pos["entryAt"] == iso(ny(DAY, "10:05"))  # 100.2 * 1.0002 + 0.01
    assert pos["ticketId"] == t["id"] and pos["backfilled"] is False and pos["slippageUsd"] == 0.3
    assert c.get("/tickets/%s" % t["id"]).json()["paper"]["status"] == "opened"
    assert c.get("/paper/trades").json() == []

    c.portal.call(svc.advance, ny(DAY, "10:30"))
    trades = c.get("/paper/trades").json()
    validate_list(trades, "PaperTrade")
    tr = trades[0]
    assert tr["id"] == pos["id"] and tr["kind"] == "closed" and tr["exitReason"] == "stop"
    assert tr["exitPrice"] == 97.97 and tr["exitAt"] == iso(ny(DAY, "10:25"))   # 98 * 0.9998 - 0.01
    assert tr["pnl"] == round((97.97 - 100.23) * 10, 2) and tr["rMultiple"] == round(tr["pnl"] / 20, 2)
    assert tr["slippageUsd"] == round(0.3 + 0.3, 2)
    paper = c.get("/tickets/%s" % t["id"]).json()["paper"]
    validate(paper, "TicketPaper")
    assert paper["status"] == "closed" and paper["exitReason"] == "stop" and paper["positionId"] == tr["id"]

    events = drain(q)
    names = [e for e, _ in events if e.startswith("paper.")]
    assert names == ["paper.opened", "paper.closed"]
    validate(events[[e for e, _ in events].index("paper.opened")][1], "PaperPosition")
    validate(events[[e for e, _ in events].index("paper.closed")][1], "PaperTrade")

    # paper never touches the skills' real books
    ws = c.app.state.services.ctx.ws
    assert not ws.exists("trader/state/broker.json") and not ws.exists("trader/portfolio.json")


def test_gap_flat_by_and_skips(live):
    c, svc = live
    svc.charts["GAP"] = chart(session({"10:30": (95.0, 96.0, 94.0, 95.5)}))
    svc.charts["FLAT"] = chart(session())
    q = c.app.state.services.ctx.bus.subscribe()
    gap = put_ticket(c, svc, "GAP", "10:00")
    flat = put_ticket(c, svc, "FLAT", "11:00")
    dup = put_ticket(c, svc, "FLAT", "11:30")                     # FLAT is still pending/open
    blocked = put_ticket(c, svc, "BLK", "11:40", status="blocked")
    stale = put_ticket(c, svc, "STL", "15:45")                     # ready, but the entry window closed 15:30
    c.portal.call(svc.advance, ny(DAY, "16:30"))
    rows = {r["ticketId"]: r for r in c.get("/paper/trades", params={"limit": 50}).json()}
    validate_list(list(rows.values()), "PaperTrade")
    g = rows[gap["id"]]
    assert g["exitReason"] == "stop" and g["exitPrice"] == round(95.0 * 0.9998 - 0.01, 2)  # the open, not 98
    f = rows[flat["id"]]
    assert f["exitReason"] == "flat_by" and f["exitAt"] == iso(ny(DAY, "15:55"))
    assert f["exitPrice"] == round(100.0 * 0.9998 - 0.01, 2)
    assert (rows[dup["id"]]["kind"], rows[dup["id"]]["skipReason"]) == ("skipped", "duplicate")
    assert rows[blocked["id"]]["skipReason"] == "blocked" and rows[blocked["id"]]["entryPrice"] is None
    assert rows[stale["id"]]["skipReason"] == "stale"
    assert c.get("/tickets/%s" % dup["id"]).json()["paper"] == {
        "status": "skipped", "accountId": f["accountId"], "positionId": None, "entryPrice": None, "exitPrice": None,
        "exitReason": None, "pnl": None, "rMultiple": None, "skipReason": "duplicate", "backfilled": False}
    skipped = [p for e, p in drain(q) if e == "paper.skipped"]
    assert len(skipped) == 3
    for p in skipped:
        validate(p, "PaperTrade")
    assert [r["kind"] for r in c.get("/paper/trades", params={"kind": "skipped"}).json()] == ["skipped"] * 3
    assert len(c.get("/paper/trades", params={"symbol": "flat"}).json()) == 2
    assert len(c.get("/paper/trades", params={"limit": 1}).json()) == 1

    st = c.get("/paper/stats", params={"groupBy": "ticker"}).json()
    validate(st, "PaperStats")
    assert st["trades"] == 2 and st["skipped"] == 3 and st["wins"] == 0 and st["losses"] == 2
    assert st["longestLosingStreak"] == 2 and st["profitFactor"] == 0.0
    assert [r["key"] for r in st["breakdown"]] == ["FLAT", "GAP"]
    assert st["maxDrawdownUsd"] == round(-g["pnl"] - f["pnl"], 2)
    assert [p["tradeId"] for p in st["equityCurve"]] == [None, g["id"], f["id"]]
    for gb in ("setup", "hour", "weekday"):
        validate(c.get("/paper/stats", params={"groupBy": gb}).json(), "PaperStats")
    assert c.get("/paper/stats", params={"groupBy": "weekday"}).json()["breakdown"][0]["key"] == "tue"
    assert c.get("/paper/stats", params={"groupBy": "hour"}).json()["breakdown"][0]["key"] in ("10", "11")
    assert c.get("/paper/stats", params={"groupBy": "moon"}).status_code == 422
    assert c.get("/paper/stats", params={"from": "2026-10-21", "to": "2026-10-20"}).status_code == 422

    # CSV export: the same rows, the contract's columns
    r = c.get("/paper/trades/export")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="levelset-paper-%s.csv"' % f["accountId"] in r.headers["content-disposition"]
    rows_csv = list(csv.DictReader(io.StringIO(r.text)))
    assert list(rows_csv[0].keys()) == ("id,accountId,periodId,kind,symbol,setup,qty,entryAt,entryPrice,exitAt,"
                                        "exitPrice,exitReason,rMultiple,pnl,slippageUsd,skipReason,backfilled,"
                                        "ticketId,runId,createdAt").split(",")
    assert len(rows_csv) == 5 and {x["backfilled"] for x in rows_csv} == {"false"}
    assert next(x for x in rows_csv if x["ticketId"] == blocked["id"])["entryPrice"] == ""


def test_signals_vs_you(live):
    c, svc = live
    svc.charts["XYZ"] = chart(session({"10:05": (100.0, 104.2, 99.9, 104.0)}))  # target in the entry bar
    t = put_ticket(c, svc, "XYZ", "10:02")
    c.portal.call(svc.advance, ny(DAY, "11:00"))
    ctx = c.app.state.services.ctx
    # manual round trips recorded by hand (GET /fills): one linked to the ticket, one other ticker
    ctx.db.put_fill({"id": "f1", "symbol": "XYZ", "side": "buy", "qty": 10, "price": 100.1, "ticketId": t["id"],
                     "at": iso(ny(DAY, "10:06")), "realizedPnl": None}, "x")
    ctx.db.put_fill({"id": "f2", "symbol": "XYZ", "side": "sell", "qty": 10, "price": 102.1,
                     "at": iso(ny(DAY, "10:40")), "realizedPnl": 20.0}, "x")
    ctx.db.put_fill({"id": "f3", "symbol": "ABC", "side": "buy", "qty": 1, "price": 10, "at": iso(ny(DAY, "11:00")),
                     "realizedPnl": None}, "x")
    ctx.db.put_fill({"id": "f4", "symbol": "ABC", "side": "sell", "qty": 1, "price": 9,
                     "at": iso(ny(DAY, "11:10")), "realizedPnl": -1.0}, "x")
    cmp = c.get("/paper/compare").json()
    validate(cmp, "PaperComparison")
    validate(cmp, schema=response_schema("/paper/compare", "get", "200"))
    rows = {r["symbol"]: r for r in cmp["rows"]}
    assert rows["XYZ"]["paper"]["trades"] == 1 and rows["XYZ"]["paper"]["winRatePct"] == 100.0
    assert rows["XYZ"]["manual"] == {"trades": 1, "pnl": 20.0, "rTotal": 1.0, "winRatePct": 100.0}
    assert rows["ABC"]["paper"] is None and rows["ABC"]["manual"]["rTotal"] is None
    assert cmp["totals"]["matched"] == 1 and cmp["totals"]["manualOnly"] == 1 and cmp["totals"]["paperOnly"] == 0
    assert cmp["totals"]["manual"]["pnl"] == 20.0
    assert c.get("/paper/compare", params={"from": "2026-10-21"}).json()["rows"] == []


def test_accounts_reset_activate_and_settings(live):
    c, svc = live
    accts = c.get("/paper/accounts").json()
    validate_list(accts, "PaperAccount")
    assert len(accts) == 1 and accts[0]["name"] == "Paper 1" and accts[0]["active"] is True
    assert accts[0]["startingBalanceUsd"] == 5000 and accts[0]["equityUsd"] == 5000
    first = accts[0]["id"]

    svc.charts["XYZ"] = chart(session())
    put_ticket(c, svc, "XYZ", "10:02")
    c.portal.call(svc.advance, ny(DAY, "10:30"))
    assert len(c.get("/paper/positions").json()) == 1

    r = c.post("/paper/accounts/%s/reset" % first, json={"startingBalanceUsd": 8000})
    assert r.status_code == 200, r.text
    a = r.json()
    validate(a, "PaperAccount")
    assert a["startingBalanceUsd"] == 8000 and len(a["periods"]) == 2 and a["periods"][0]["endedAt"]
    assert a["periods"][0]["trades"] == 1 and a["periods"][1]["number"] == 2 and a["openPositions"] == 0
    old = c.get("/paper/trades", params={"periodId": a["periods"][0]["id"]}).json()
    assert old[0]["exitReason"] == "reset"
    assert c.get("/paper/trades").json() == []  # the new period is empty
    assert len(c.get("/paper/trades", params={"periodId": "all"}).json()) == 1
    validate(c.get("/paper/stats", params={"periodId": "all"}).json(), "PaperStats")
    assert c.get("/paper/trades", params={"periodId": "nope"}).status_code == 422

    r = c.post("/paper/accounts", json={"name": "Aggressive", "startingBalanceUsd": 2500})
    assert r.status_code == 201
    second = r.json()
    validate(second, "PaperAccount")
    assert second["active"] is True and second["name"] == "Aggressive"
    r = c.post("/paper/accounts")  # no body: defaults
    assert r.status_code == 201 and r.json()["name"] == "Paper 3"
    assert c.post("/paper/accounts", json={"name": ""}).status_code == 422
    assert [x["active"] for x in c.get("/paper/accounts").json()] == [False, False, True]
    act = c.post("/paper/accounts/%s/activate" % first)
    validate(act.json(), "PaperAccount")
    assert act.json()["active"] is True
    assert sum(x["active"] for x in c.get("/paper/accounts").json()) == 1
    for path in ("/paper/accounts/nope/activate", "/paper/accounts/nope/reset"):
        r = c.post(path)
        assert r.status_code == 404 and r.json()["code"] == "paper_account_not_found"
        validate(r.json(), "Problem")
    for path in ("/paper/positions", "/paper/trades", "/paper/stats", "/paper/compare", "/paper/trades/export"):
        r = c.get(path, params={"accountId": "nope"})
        assert r.status_code == 404 and r.json()["code"] == "paper_account_not_found", path

    s = c.get("/paper/settings").json()
    validate(s, "PaperSettings")
    assert s == {"autoFollow": True, "slippagePct": 0.02, "slippagePerShare": 0.01}
    r = c.patch("/paper/settings", json={"slippagePct": 0.05})
    validate(r.json(), "PaperSettings")
    assert r.json() == {"autoFollow": True, "slippagePct": 0.05, "slippagePerShare": 0.01}
    assert c.patch("/paper/settings", json={"slippagePct": 9}).status_code == 422
    assert c.patch("/paper/settings", json={"slippagePerShare": -1}).status_code == 422
    c.patch("/paper/settings", json={"autoFollow": False})
    t = put_ticket(c, svc, "OFF", "10:10")
    assert "paper" not in c.get("/tickets/%s" % t["id"]).json()  # absent while auto-follow is off

    d = c.get("/dashboard").json()
    validate(d, "DashboardSummary")
    assert "paperPnlToday" in d and d["dayPnl"] == 0  # paper never counts in the real P/L


def test_every_paper_path_is_served(live):
    c, _ = live
    served = {(p, m.lower()) for p, ops in c.app.openapi()["paths"].items() for m in ops}
    paper = [(p, m) for p, ops in spec()["paths"].items() if p.startswith("/paper/") for m in ops]
    assert len(paper) == 11
    assert [x for x in paper if x not in served] == []
    for path in ("/paper/accounts", "/paper/positions", "/paper/trades", "/paper/stats", "/paper/settings"):
        assert c.get(path, headers={"Authorization": ""}).status_code == 401


# ---------------------------------------------------------------- catch-up backfill (injected clock)

def test_missed_intervals_with_injected_clock(live):
    c, svc = live
    ctx = c.app.state.services.ctx
    assert svc.missed_intervals(ny("2026-10-24", "11:00")) == []  # a Saturday
    assert svc.missed_intervals(ny(DAY, "09:40")) == []           # before the entry window
    got = [iso(x)[11:16] for x in svc.missed_intervals(ny(DAY, "10:31"))]
    assert got == ["09:45", "10:00", "10:15", "10:30"]
    ctx.db.kv_set("paper:lastSeen", iso(ny(DAY, "10:05")))      # the engine ran until 10:05
    assert [iso(x)[11:16] for x in svc.missed_intervals(ny(DAY, "10:31"))] == ["10:15", "10:30"]
    assert len(svc.missed_intervals(ny(DAY, "16:00"))) == 8      # bounded: at most 8 runs per start


def test_backfill_replays_the_demo_morning(tmp_path):
    """Engine 'started' at 10:20 after running until 09:50: the 10:00 and 10:15 runs are replayed as of
    then (the skills get --now), and the paper account trades what they produced, marked backfilled."""
    with make_client(tmp_path / "ws") as c:
        svc = c.app.state.paper
        ctx = c.app.state.services.ctx
        ctx.db.kv_set("paper:lastSeen", iso(ny("2026-10-19", "09:50")))
        q = ctx.bus.subscribe()
        now = ny("2026-10-19", "10:20")
        summary = c.portal.call(lambda: svc.backfill(now, params={"timemachine": {"replays": 300}}))
        validate(summary, "PaperBackfill")
        assert summary["from"] == "2026-10-19T10:00:00-04:00" and summary["to"] == "2026-10-19T10:15:00-04:00"
        assert summary["closed"] >= 1 and summary["opened"] >= summary["closed"]
        runs = c.get("/pipeline/runs").json()
        assert sorted(r["startedAt"] for r in runs) == ["2026-10-19T10:00:00-04:00", "2026-10-19T10:15:00-04:00"]
        trades = c.get("/paper/trades", params={"kind": "closed"}).json()
        tsla = next(t for t in trades if t["symbol"] == "TSLA" and t["createdAt"] == "2026-10-19T10:15:00-04:00")
        assert tsla["backfilled"] is True and tsla["exitReason"] == "flat_by"
        tk = c.get("/tickets").json()
        assert all((t.get("paper") or {}).get("backfilled") for t in tk if "paper" in t)
        events = drain(q)
        paper_events = [e for e, _ in events if e.startswith("paper.")]
        assert paper_events == ["paper.backfilled"]  # not one by one
        assert svc.missed_intervals(now) == []  # each interval is replayed once
        assert c.portal.call(lambda: svc.backfill(now)) is None
        # the clock override ended with the pass
        assert c.get("/status").json()["nowEt"] == "2026-10-19T10:15:00-04:00"


# ---------------------------------------------------------------- demo TSLA (PRD v1.1 §10 criterion 1)

def _tm_actual_path() -> dict[str, Any]:
    """The Time Machine's own rule (timemachine.history_replay: entry = close of the first bar after the
    opening range to close above it, then stop first, then target, bar by bar, else the close of the
    last bar) applied to the actual 2026-10-19 TSLA bars the demo has: 09:30 to the 10:40 bar (the data
    was captured at 10:49:45, so the 10:45 bar was still forming and both sides leave it out)."""
    path = VENDOR / "trader-timemachine" / "timemachine.py"
    spec_ = importlib.util.spec_from_file_location("levelset_test_tm", path)
    tm = importlib.util.module_from_spec(spec_)
    spec_.loader.exec_module(tm)
    text = (VENDOR / "tests" / "fixtures" / "trader-entry" / "TSLA-2026-10-19-5m.json").read_text(encoding="utf-8")
    _, bars, _ = tm.parse_bars(tm.chart_result(text, "TSLA"), dt.datetime(2026, 10, 19, 21, 0))
    day = tm.split_sessions(bars)["2026-10-19"]
    res = tm.history_replay([("2026-10-19", [day[i] for i in sorted(day)])], {"or_minutes": 15, "stop_rule": "or_mid", "target_r": 1.0},
                            max(day))
    return res["trades"][0]


def test_demo_paper_reproduces_the_time_machine_actual_path(demo):
    """What is compared: the demo ticket (8 x TSLA, 364.18 / 358.32 / 370.04, unchanged) is auto-followed.
    The paper entry is the 10:15 bar's open + slippage (not 364.18), so prices differ by design. Compared
    with the Time Machine's actual-path result for the day: the same levels, the same outcome (TM "close"
    = neither stop nor target before the data ends = paper "flat_by"), and the same R sign and size
    within 0.1 R (the gap is the next-bar entry plus 0.02 % + $0.01 a share on each side)."""
    client, run = demo
    t = wait_paper(client, run["ticketId"])
    assert (t["qty"], t["entry"], t["stop"], t["target"]) == (8, 364.18, 358.32, 370.04)
    assert t["timeMachine"]["targetFirstPct"] == 29.4 and t["timeMachine"]["stopFirstPct"] == 25.5
    assert t["timeMachine"]["openAtClosePct"] == 45.1

    tm = _tm_actual_path()
    assert (tm["entry"], tm["stop"], tm["target"]) == (t["entry"], t["stop"], t["target"])
    assert tm["outcome"] == "close" and tm["R"] == 0.33  # (366.105 - 364.18) / 5.86

    tr = next(x for x in client.get("/paper/trades").json() if x["ticketId"] == run["ticketId"])
    validate(tr, "PaperTrade")
    outcome = {"close": "flat_by", "stop": "stop", "target": "target"}[tm["outcome"]]
    assert tr["exitReason"] == outcome == t["paper"]["exitReason"]
    assert tr["qty"] == 8 and tr["entryAt"] == "2026-10-19T10:15:00-04:00"
    assert tr["entryPrice"] == 364.29        # the 10:15 bar opened at 364.21; + 0.02 % + $0.01
    assert tr["exitPrice"] == 366.03 and tr["exitAt"] == "2026-10-19T10:45:00-04:00"  # 10:40 bar close 366.11
    assert tr["pnl"] == 13.92 and tr["rMultiple"] == 0.3 and tr["slippageUsd"] == 1.28
    assert (tr["rMultiple"] > 0) == (tm["R"] > 0) and abs(tr["rMultiple"] - tm["R"]) <= 0.1
    assert tr["backfilled"] is False

    d = client.get("/dashboard").json()
    validate(d, "DashboardSummary")
    assert d["paperPnlToday"] == 13.92 and d["dayPnl"] == 0  # paper P/L stays out of the real day P/L
    acct = client.get("/paper/accounts").json()[0]
    assert acct["realizedPnl"] == 13.92 and acct["equityUsd"] == 5013.92
    validate(client.get("/paper/stats").json(), "PaperStats")


def test_catch_up_waits_for_onboarding(tmp_path):
    """A fresh install must not start re-running the day before onboarding is finished."""
    with make_client(tmp_path / "ws", demo=False) as c:
        paper = c.app.state.paper
        calls: list[str] = []

        async def fake_backfill(*_a: Any, **_k: Any) -> None:
            calls.append("backfill")

        async def fake_loop(*_a: Any, **_k: Any) -> None:
            calls.append("loop")

        paper.backfill, paper.loop = fake_backfill, fake_loop

        async def start() -> None:
            import asyncio
            c.app.state.services.ctx.tasks["t.bg"] = asyncio.create_task(paper.background())

        c.portal.call(start)
        time.sleep(0.3)
        assert calls == [], "catch-up started before onboarding"
        assert c.post("/system/onboarding").status_code == 204
        deadline = time.monotonic() + 5
        while calls != ["backfill", "loop"] and time.monotonic() < deadline:
            time.sleep(0.05)
        assert calls == ["backfill", "loop"]
    with make_client(tmp_path / "ws", demo=False) as c:  # remembered across restarts
        c.portal.call(c.app.state.services.ctx.wait_onboarded)


def test_user_runs_go_before_catch_up_steps(tmp_path):
    """A catch-up run yields between steps: the user's run never waits for more than the step in progress."""
    with make_client(tmp_path / "ws") as c:
        svc = c.app.state.services.pipeline
        ctx = c.app.state.services.ctx
        order: list[tuple[str, str]] = []
        real = svc._execute

        async def recording(run_id: str, key: str, overrides: Any) -> Any:
            order.append((run_id, key))
            return await real(run_id, key, overrides)

        svc._execute = recording

        async def hold() -> None:
            await ctx.lock.acquire()

        c.portal.call(hold)
        bg = c.portal.call(lambda: svc.create_run("all", None, "orb", {}, background=True))["id"]
        time.sleep(0.2)  # the catch-up's first step is now waiting for the lock
        user = c.post("/pipeline/runs", json={"mode": "all", "ticker": "TSLA", "setup": "orb"}).json()["id"]
        c.portal.call(ctx.lock.release)
        for rid in (user, bg):
            deadline = time.monotonic() + 120
            while c.get("/pipeline/runs/%s" % rid).json()["status"] == "running" and time.monotonic() < deadline:
                time.sleep(0.2)
        bg_steps = [i for i, (r, _) in enumerate(order) if r == bg]
        user_steps = [i for i, (r, _) in enumerate(order) if r == user]
        assert user_steps and len(bg_steps) >= 2
        # only the catch-up step that was already waiting ran before the user's run; the rest came after it
        assert bg_steps[0] < user_steps[0] and max(user_steps) < bg_steps[1]
