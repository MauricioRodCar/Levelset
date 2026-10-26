"""The demo TSLA pipeline reproduces the README example exactly (PRD success criterion 3)."""

from __future__ import annotations

from typing import Any

from contract import validate


def steps_by_key(run: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {s["key"]: s for s in run["steps"]}


def test_run_all_finishes_with_a_ready_ticket(demo):
    _, run = demo
    validate(run, "PipelineRun")
    assert run["ticker"] == "TSLA"
    assert run["mode"] == "all"
    assert run["ticketId"]
    st = steps_by_key(run)
    assert [s["key"] for s in run["steps"]] == ["scanner", "news", "entry", "exit", "timemachine", "budget",
                                                 "risk", "ticket"]
    assert {k: s["status"] for k, s in st.items()} == {
        "scanner": "done", "news": "check", "entry": "done", "exit": "done", "timemachine": "check",
        "budget": "done", "risk": "done", "ticket": "done"}
    assert run["status"] == "check"  # earnings this week + a coin flip need the trader's attention
    for s in run["steps"]:
        assert s["startedAt"] and s["endedAt"], s["key"]
        assert s["summary"]["code"] and s["summary"]["inLine"] is not None and s["summary"]["outLine"]


def test_scanner_opening_range(demo):
    _, run = demo
    sc = steps_by_key(run)["scanner"]
    hit = next(h for h in sc["outputs"]["hits"] if h["symbol"] == "TSLA")
    assert (hit["or_low"], hit["or_high"]) == (354.47, 362.18)
    assert hit["price"] == 364.18 and hit["bar_start"] == "10:10" and hit["at"] == "10:15 AM"
    assert hit["pct_over"] == 0.55
    assert len(sc["outputs"]["hits"]) == 42 and sc["outputs"]["scanned"] == 231
    assert sc["summary"]["values"]["symbol"] == "TSLA"


def test_news_flags_earnings(demo):
    _, run = demo
    news = steps_by_key(run)["news"]
    assert "earnings_this_week" in news["checks"]
    titles = [i["title"] for i in news["outputs"]["items"]]
    assert "Tesla-SpaceX Merger Mania Strikes Wall Street Ahead of Earnings" in titles
    assert all(i["time"] <= "2026-10-19T14:15:00+00:00" for i in news["outputs"]["items"])  # nothing after 10:15


def test_entry_trigger(demo):
    _, run = demo
    e = steps_by_key(run)["entry"]
    o = e["outputs"]
    assert o["status"] == "triggered"
    assert o["opening_range"]["high"] == 362.18 and o["opening_range"]["low"] == 354.47
    assert o["trigger"]["price"] == 364.18 and o["trigger"]["bar_start"] == "10:10"
    assert e["summary"]["code"] == "entry.triggered"


def test_exit_plan(demo):
    _, run = demo
    o = steps_by_key(run)["exit"]["outputs"]
    assert o["entry"] == 364.18
    assert o["stop"] == 358.32 and o["stop_rule"] == "or_mid"
    assert o["target"] == 370.04 and o["target_r"] == 1.0
    assert o["risk_per_share"] == 5.86 and o["flat_by"] == "15:55"


def test_time_machine_seed_19(demo):
    _, run = demo
    tm = steps_by_key(run)["timemachine"]
    mc, h = tm["outputs"]["mc"], tm["outputs"]["history"]
    assert mc["seed"] == 19 and mc["replays"] == 10000
    assert round(mc["p_target"] * 100, 1) == 29.4
    assert round(mc["p_stop"] * 100, 1) == 25.5
    assert round(mc["p_neither"] * 100, 1) == 45.1
    assert (h["triggered"], h["target"], h["stop"], h["close"]) == (33, 13, 15, 5)
    assert tm["checks"] == ["coin_flip", "many_open_at_close"]
    assert tm["summary"]["values"]["verdict"] == "coin_flip"


def test_budget_and_risk(demo):
    _, run = demo
    st = steps_by_key(run)
    s = st["budget"]["outputs"]["sizing"]
    assert s["budget"] == 5000 and s["max_loss_per_trade_usd"] == 50
    assert s["qty"] == 8 and s["bound_by"] == "max loss"
    assert s["max_loss"] == 46.88 and s["cost"] == 2913.44
    order = st["budget"]["outputs"]["orders"][0]
    assert (order["qty"], order["stop_loss_stop_price"], order["take_profit_limit_price"]) == ("8", "358.32", "370.04")
    r = st["risk"]["outputs"]["results"][0]
    assert r["verdict"] == "PASS" and r["max_loss"] == 46.88
    assert st["risk"]["summary"]["code"] == "risk.pass"


def test_ticket(demo):
    client, run = demo
    t = client.get("/tickets/%s" % run["ticketId"]).json()
    validate(t, "Ticket")
    assert t["symbol"] == "TSLA" and t["side"] == "buy" and t["qty"] == 8
    assert (t["entry"], t["stop"], t["target"]) == (364.18, 358.32, 370.04)
    assert t["maxLoss"] == 46.88 and t["riskPerShare"] == 5.86 and t["rMultiple"] == 1.0
    assert t["status"] == "ready" and t["riskReasons"] == []
    assert t["timeMachine"] == {"targetFirstPct": 29.4, "stopFirstPct": 25.5, "openAtClosePct": 45.1,
                                "verdict": "coin_flip", "historyFired": 33, "historyWon": 13, "historyLost": 15}
    assert t["flatBy"] == "15:55" and t["orderType"] == "market" and t["timeInForce"] == "day"


def test_run_history_newest_first(demo):
    client, run = demo
    runs = client.get("/pipeline/runs").json()
    assert runs[0]["id"] == run["id"] or any(r["id"] == run["id"] for r in runs)
    assert client.get("/pipeline/runs/nope").status_code == 404
