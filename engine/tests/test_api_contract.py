"""Every endpoint answers in the shape docs/api/openapi.yaml declares."""

from __future__ import annotations

import csv
import io
import json

import pytest

from conftest import AUTH, TOKEN, make_client
from contract import response_schema, spec, validate, validate_list


def test_every_contract_path_is_served(demo):
    client, _ = demo
    served = {(p, m.lower()) for p, ops in client.app.openapi()["paths"].items() for m in ops}
    for path, ops in spec()["paths"].items():
        for method in ops:
            assert (path, method) in served, "%s %s" % (method.upper(), path)


def test_health_needs_no_token(demo):
    client, _ = demo
    r = client.get("/health", headers={"Authorization": ""})
    assert r.status_code == 200
    validate(r.json(), schema=response_schema("/health", "get", "200"))
    assert r.json()["ok"] is True


@pytest.mark.parametrize("path", ["/status", "/dashboard", "/settings", "/watchlist", "/tickets", "/trades",
                                  "/fills", "/alerts", "/pipeline/runs", "/news?tickers=TSLA", "/events"])
def test_auth_required(demo, path):
    client, _ = demo
    for headers in ({"Authorization": ""}, {"Authorization": "Bearer wrong"}, {"Authorization": "Basic x"}):
        r = client.get(path, headers=headers)
        assert r.status_code == 401, path
        assert r.headers["content-type"].startswith("application/problem+json")
        validate(r.json(), "Problem")
        assert r.json()["code"] == "unauthorized"


def test_status(demo):
    client, _ = demo
    s = client.get("/status").json()
    validate(s, "Status")
    assert s["mode"] == "demo" and s["nowEt"] == "2026-10-19T10:15:00-04:00"
    assert s["marketOpen"] is True and s["nextClose"] == "2026-10-19T16:00:00-04:00"
    assert s["nextOpen"] == "2026-10-20T09:30:00-04:00" and s["earlyClose"] is False
    assert s["paper"] is True and s["tier"] == "free"


def test_dashboard(demo):
    client, _ = demo
    d = client.get("/dashboard").json()
    validate(d, "DashboardSummary")
    assert d["dailyLossLimit"] == 150 and d["maxTradesPerDay"] == 3
    assert d["lastScanAt"] == "2026-10-19T10:15:00-04:00"


def test_watchlist(demo):
    client, _ = demo
    w = client.get("/watchlist").json()
    validate_list(w, "WatchItem")
    tsla = next(x for x in w if x["symbol"] == "TSLA")
    assert tsla["entryState"] == "triggered" and tsla["price"] == 364.18 and tsla["setup"] == "orb"
    assert tsla["changePct"] == round((364.18 / 354.72 - 1) * 100, 2)


def test_news(demo):
    client, _ = demo
    r = client.get("/news", params={"tickers": "TSLA", "hours": 6})
    items = r.json()
    validate_list(items, "NewsItem")
    merger = next(i for i in items if "Merger Mania" in i["title"])
    assert merger["publishedAt"] == "2026-10-19T08:04:00-04:00" or merger["publishedAt"].startswith("2026-10-19T08:04")
    assert set(merger["tags"]) >= {"earnings", "deal"} and merger["source"] == "yahoo"
    assert client.get("/news", params={"tickers": "not a ticker!"}).json()["code"] == "invalid_ticker"
    assert client.get("/news").status_code == 422


def test_scanner_run(client):
    r = client.post("/scanner/run", json={"kind": "orb", "at": "10:15"})
    assert r.status_code == 200, r.text
    res = r.json()
    validate(res, "ScanResult")
    assert res["kind"] == "orb" and res["scanned"] == 231 and len(res["hits"]) == 42
    tsla = next(h for h in res["hits"] if h["symbol"] == "TSLA")
    assert (tsla["rangeLow"], tsla["rangeHigh"], tsla["price"], tsla["pctOverTrigger"]) == (354.47, 362.18, 364.18, 0.55)
    early = client.post("/scanner/run", json={"kind": "orb", "at": "10:00"}).json()
    assert len(early["hits"]) < 42
    daily = client.post("/scanner/run", json={"kind": "daily"}).json()
    validate(daily, "ScanResult")
    assert {h["setup"] for h in daily["hits"]} <= {"breakout20", "bull_flag", "reclaim20", "oversold", "oversold_bounce"}
    assert client.post("/scanner/run", json={"kind": "weekly"}).status_code == 422
    # the watchlist follows the last scan
    assert len(client.get("/watchlist").json()) == len(daily["hits"])


def test_settings_round_trip(client):
    s = client.get("/settings").json()
    validate(s, "Settings")
    assert s["account"] == {"accountSizeUsd": 5000, "cashBufferPct": 10, "paper": True}
    assert s["limits"]["maxLossPerTradeUsd"] == 50 and s["limits"]["maxDailyLossUsd"] == 150
    assert s["limits"]["maxTradesPerDay"] == 3 and s["limits"]["minRewardRisk"] == 1
    assert (s["limits"]["noEntriesBefore"], s["limits"]["noEntriesAfter"], s["limits"]["flatBy"]) == \
        ("09:45", "15:30", "15:55")
    assert s["data"]["demoMode"] is True and s["data"]["secUserAgent"] == ""

    s["account"].update(accountSizeUsd=12000, cashBufferPct=5, paper=True)
    s["limits"].update(maxLossPerTradeUsd=80, maxDailyLossUsd=240, maxTradesPerDay=4, minRewardRisk=1.5,
                       noEntriesBefore="10:00", noEntriesAfter="15:00", flatBy="15:50", pdtGuard=True)
    s["data"]["secUserAgent"] = "Ada Lovelace ada@example.org"
    r = client.put("/settings", json=s)
    assert r.status_code == 200
    assert client.get("/settings").json() == r.json() == s

    cfg = json.loads((client.app.state.services.ctx.ws.path("trader/config.json")).read_text(encoding="utf-8"))
    assert cfg["budget"] == 12000 and cfg["cash_buffer_pct"] == 5 and cfg["max_loss_per_trade_usd"] == 80
    assert cfg["max_daily_loss_usd"] == 240 and cfg["max_trades_per_day"] == 4 and cfg["min_reward_risk"] == 1.5
    assert cfg["no_entries_before"] == "10:00" and cfg["no_entries_after"] == "15:00" and cfg["flat_by"] == "15:50"
    assert cfg["pdt_guard"] is True and cfg["sec_user_agent"] == "Ada Lovelace ada@example.org"
    assert cfg["blocked"] == [] and cfg["allow_short"] is False  # keys Levelset does not manage are kept

    bad = client.put("/settings", json=dict(s, limits=dict(s["limits"], flatBy="25:99")))
    assert bad.status_code == 422 and bad.json()["code"] == "validation_error"
    assert client.put("/settings", json={"limits": {}}).status_code == 422  # account is required


def test_ticket_exports(demo):
    client, run = demo
    tid = run["ticketId"]
    t = client.get("/tickets/%s" % tid).json()
    for fmt in ("text", "csv", "json", "ctrader", "mt4", "mt5"):
        r = client.get("/tickets/%s/export" % tid, params={"format": fmt})
        assert r.status_code == 200, fmt
        assert r.headers["content-type"].startswith("text/plain")
        body = r.text
        for level in ("364.18", "358.32", "370.04"):
            assert level in body, (fmt, level)
    rows = list(csv.DictReader(io.StringIO(client.get("/tickets/%s/export?format=csv" % tid).text)))
    assert rows[0]["symbol"] == "TSLA" and rows[0]["qty"] == "8" and rows[0]["stop"] == "358.32"
    assert json.loads(client.get("/tickets/%s/export?format=json" % tid).text) == t
    assert "Stop Loss (price): 358.32" in client.get("/tickets/%s/export?format=ctrader" % tid).text
    assert client.get("/tickets/%s/export?format=pdf" % tid).status_code == 422
    assert client.get("/tickets/nope/export?format=text").json()["code"] == "ticket_not_found"


def test_tickets_list_and_filters(demo):
    client, run = demo
    all_t = client.get("/tickets").json()
    validate_list(all_t, "Ticket")
    assert run["ticketId"] in [t["id"] for t in all_t]
    assert client.get("/tickets", params={"status": "nonsense"}).status_code == 422


def test_fills_trades_and_dashboard(client):
    from conftest import run_all
    run = run_all(client, params={"timemachine": {"replays": 500}})
    tid = run["ticketId"]
    r = client.post("/fills", json={"symbol": "TSLA", "side": "buy", "qty": 8, "price": 364.20, "ticketId": tid})
    assert r.status_code == 201, r.text
    validate(r.json(), "Fill")
    assert r.json()["realizedPnl"] is None and r.json()["at"] == "2026-10-19T10:15:00-04:00"

    trades = client.get("/trades").json()
    validate_list(trades, "OpenTrade")
    tr = trades[0]
    assert (tr["symbol"], tr["qty"], tr["avgPrice"], tr["stop"], tr["target"], tr["ticketId"]) == \
        ("TSLA", 8, 364.2, 358.32, 370.04, tid)
    assert tr["lastPrice"] == 366.48 and tr["unrealizedPnl"] == round((366.48 - 364.2) * 8, 2)

    d = client.get("/dashboard").json()
    assert d["tradesToday"] == 1 and d["riskUsed"] == 46.88

    ws = client.app.state.services.ctx.ws
    pf = ws.read_json("trader/portfolio.json")
    assert pf["positions"][0]["ticker"] == "TSLA" and pf["positions"][0]["shares"] == 8
    log = ws.read_json("trader/state/broker.json")["orders"]
    assert any(o["status"] == "placed" and o["kind"] == "entry" and o["max_loss"] == 46.88 for o in log)

    too_many = client.post("/fills", json={"symbol": "TSLA", "side": "sell", "qty": 9, "price": 370})
    assert too_many.status_code == 422 and too_many.json()["code"] == "insufficient_position"
    sell = client.post("/fills", json={"symbol": "TSLA", "side": "sell", "qty": 8, "price": 370.04}).json()
    assert sell["realizedPnl"] == round((370.04 - 364.2) * 8, 2)
    assert client.get("/trades").json() == []
    fills = client.get("/fills").json()
    validate_list(fills, "Fill")
    assert [f["side"] for f in fills] == ["sell", "buy"]
    assert client.get("/dashboard").json()["dayPnl"] == sell["realizedPnl"]

    assert client.post("/fills", json={"symbol": "TSLA", "side": "buy", "qty": 0, "price": 1}).status_code == 422
    assert client.post("/fills", json={"symbol": "TSLA", "side": "buy", "qty": 1, "price": 1,
                                       "ticketId": "nope"}).json()["code"] == "ticket_not_found"

    # the next TSLA entry the same day is a duplicate for trader-risk
    run2 = run_all(client, ticker="TSLA", params={"timemachine": {"replays": 500}})
    st = {s["key"]: s for s in run2["steps"]}
    assert st["risk"]["status"] == "blocked" and "duplicate" in st["risk"]["checks"]


def test_alerts(client):
    from conftest import run_all
    run = run_all(client, params={"timemachine": {"replays": 500}})
    r = client.post("/alerts/from-plan", json={"runId": run["id"]})
    assert r.status_code == 201
    made = r.json()
    validate_list(made, "Alert")
    assert [(a["type"], a.get("level"), a.get("time")) for a in made] == \
        [("stop", 358.32, None), ("target", 370.04, None), ("flat_by", None, "15:55")]
    above = client.post("/alerts", json={"type": "above", "symbol": "TSLA", "level": 366}).json()
    validate(above, "Alert")
    bell = client.post("/alerts", json={"type": "open_bell"}).json()
    assert client.post("/alerts", json={"type": "above", "symbol": "TSLA"}).json()["code"] == "invalid_alert"
    assert client.post("/alerts", json={"type": "laser"}).status_code == 422
    assert client.post("/alerts/from-plan", json={"runId": "nope"}).status_code == 404

    svc = client.app.state.services
    rung = client.portal.call(svc.alerts.check)
    ids = {a["id"] for a in rung}
    # the fixture quote is 366.48: over 366, between the stop and the target; the NYSE is open at 10:15
    assert ids == {above["id"], bell["id"]}
    again = client.portal.call(svc.alerts.check)
    assert again == []  # each alert rings once
    listed = {a["id"]: a for a in client.get("/alerts").json()}
    validate_list(list(listed.values()), "Alert")
    assert listed[above["id"]]["status"] == "rung" and listed[above["id"]]["rungAt"] == "2026-10-19T10:15:00-04:00"
    assert listed[made[0]["id"]]["status"] == "armed"

    assert client.delete("/alerts/%s" % above["id"]).status_code == 204
    assert client.delete("/alerts/%s" % above["id"]).status_code == 404
    assert above["id"] not in {a["id"] for a in client.get("/alerts").json()}


def test_events_stream_accepts_query_token(tmp_path, monkeypatch):
    from levelset_engine.api import routes_system
    monkeypatch.setattr(routes_system, "HEARTBEAT_SECONDS", 0.2)
    with make_client(tmp_path / "ws") as c:
        bus = c.app.state.services.ctx.bus
        with c.stream("GET", "/events?token=%s" % TOKEN, headers={"Authorization": ""}) as r:
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("text/event-stream")
            lines = r.iter_lines()
            assert next(lines).startswith(": connected")
            c.portal.call(_publish, bus)
            got = []
            for line in lines:
                if line.startswith("event:") or line.startswith("data:"):
                    got.append(line)
                if len(got) == 2:
                    break
        assert got[0] == "event: run.updated"
        assert json.loads(got[1][len("data: "):]) == {"id": "x"}


async def _publish(bus):
    bus.publish("run.updated", {"id": "x"})


def test_problem_for_unknown_route(demo):
    client, _ = demo
    r = client.get("/nope", headers=AUTH)
    assert r.status_code == 404 and r.json()["code"] == "not_found"


def test_live_mode_status_and_settings(tmp_path):
    with make_client(tmp_path / "live", demo=False) as c:
        s = c.get("/status").json()
        validate(s, "Status")
        assert s["mode"] == "live" and s["dataDelaySeconds"] > 0
        assert c.get("/settings").json()["data"]["demoMode"] is False
        assert c.get("/watchlist").json() == [] and c.get("/tickets").json() == []
