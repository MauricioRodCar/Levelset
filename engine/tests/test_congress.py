"""/congress/*: trader-pelosi ptr.py over the vendored House index and PTR texts (no network)."""

from __future__ import annotations

import json

from conftest import make_client
from contract import response_schema, validate

from levelset_engine.services.research import to_trade


def _research(client):
    return client.app.state.research


def test_demo_feed(client):
    r = client.get("/congress/trades")
    assert r.status_code == 200, r.text
    feed = r.json()
    validate(feed, "CongressFeed")
    trades = feed["trades"]
    assert feed["lastCheckedAt"] == "2026-10-19T10:15:00-04:00"
    assert len(trades) == 22
    assert [t["filedDate"] for t in trades] == sorted((t["filedDate"] for t in trades), reverse=True)
    calls = [t for t in trades if t["option"] and t["ticker"] == "BE"]
    assert calls and calls[0]["member"] == "Hon. Nancy Pelosi" and calls[0]["owner"] == "spouse"
    assert calls[0]["option"] == {"kind": "call", "strike": 100.0, "expires": "2027-06-17", "contracts": 100,
                                  "exercised": False}
    assert calls[0]["type"] == "buy" and calls[0]["daysToDisclose"] == 28 and calls[0]["late"] is False
    assert calls[0]["filingUrl"].endswith("/2026/20035143.pdf") and calls[0]["id"].startswith("20035143-")
    partial = next(t for t in trades if t["partial"])
    assert partial["type"] == "sell"
    # PTRs without a text fixture stand in for "pdftotext is not installed": linked, not read
    unread = feed["unreadFilings"]
    assert unread and all(not f["parsed"] and f["tradeCount"] == 0 for f in unread)
    assert any(f["docId"] == "20035553" for f in unread)


def test_filters(client):
    get = lambda **p: client.get("/congress/trades", params=p).json()  # noqa: E731
    pelosi = get(member="pelosi")
    assert pelosi["trades"] and all("Pelosi" in t["member"] for t in pelosi["trades"])
    assert all("Pelosi" in f["member"] for f in pelosi["unreadFilings"])
    assert {t["ticker"] for t in get(ticker="be")["trades"]} == {"BE"}
    assert all(t["type"] == "sell" for t in get(type="sell")["trades"])
    oct_ = get(**{"from": "2026-10-01", "to": "2026-10-31"})
    assert oct_["trades"] and all(t["filedDate"] >= "2026-10-01" for t in oct_["trades"])
    assert len(get(limit=3)["trades"]) == 3
    assert client.get("/congress/trades", params={"type": "gift"}).status_code == 422
    assert client.get("/congress/trades", params={"from": "10/01/2026"}).status_code == 422


def test_watchlist_flags_and_one_event_per_filing(client, monkeypatch):
    client.get("/congress/trades")
    svc = _research(client)
    monkeypatch.setattr(svc, "_watch_sets", lambda: ({"BE"}, {"AMAT"}))
    feed = client.get("/congress/trades", params={"watchlistOnly": True}).json()
    assert {t["ticker"] for t in feed["trades"]} == {"BE", "AMAT"}
    assert all(t["inWatchlist"] for t in feed["trades"] if t["ticker"] == "BE")
    assert all(t["inPositions"] and not t["inWatchlist"] for t in feed["trades"] if t["ticker"] == "AMAT")
    # forget one filing, so the next refresh sees it as new
    svc.ctx.db._exec("DELETE FROM congress_filings WHERE doc_id = '20035143'")
    svc.ctx.db._exec("DELETE FROM congress_trades WHERE doc_id = '20035143'")
    q = svc.ctx.bus.subscribe()
    r = client.post("/congress/refresh")
    assert r.status_code == 200
    validate(r.json(), schema=response_schema("/congress/refresh", "post", "200"))
    assert r.json()["newFilings"] == 1 and r.json()["newTrades"] == 7 and r.json()["unreadFilings"] == 0
    name, payload = q.get_nowait()
    assert name == "congress.filing"
    ev = json.loads(payload)
    validate(ev, "CongressFilingEvent")
    assert ev["filing"]["docId"] == "20035143" and ev["trades"] and all(t["ticker"] == "BE" for t in ev["trades"])
    assert q.empty()
    assert client.post("/congress/refresh").json()["newFilings"] == 0
    assert q.empty()  # alerts once per filing


def test_settings_and_notify_off(client, monkeypatch):
    r = client.get("/congress/settings")
    validate(r.json(), "CongressSettings")
    assert r.json() == {"notifyOnWatchlist": True, "members": []}
    r = client.patch("/congress/settings", json={"notifyOnWatchlist": False, "members": ["pelosi", " Pelosi "]})
    assert r.status_code == 200 and r.json() == {"notifyOnWatchlist": False, "members": ["pelosi"]}
    assert client.get("/congress/settings").json()["notifyOnWatchlist"] is False
    assert client.patch("/congress/settings", json={"members": "x"}).status_code == 422
    svc = _research(client)
    monkeypatch.setattr(svc, "_watch_sets", lambda: ({"BE"}, set()))
    q = svc.ctx.bus.subscribe()
    client.post("/congress/refresh")
    assert q.empty()


def test_settings_persist(tmp_path):
    ws = tmp_path / "ws"
    with make_client(ws) as c:
        c.patch("/congress/settings", json={"members": ["Pelosi"]})
    with make_client(ws) as c:
        assert c.get("/congress/settings").json()["members"] == ["Pelosi"]


def test_to_trade_mapping():
    filing = {"docId": "1", "member": "Hon. A B", "district": "CA01", "filedDate": "2026-10-01", "filingUrl": "u"}
    t = to_trade({"owner": "DC", "type": "S (partial)", "type_name": "partial sale", "date": "2026-08-01",
                  "asset": "X", "amount": "$1,001 - $15,000", "amount_low": 1001, "amount_high": 15000,
                  "days_to_disclose": 61, "late": True}, 2, filing)
    assert (t["id"], t["owner"], t["type"], t["partial"], t["late"]) == ("1-2", "dependent_child", "sell", True, True)
    assert t["ticker"] is None and t["option"] is None
    validate(t, "CongressTrade")
    e = to_trade({"type": "E", "date": "2026-09-01", "asset": "Y", "amount": "$1"}, 1, filing)
    assert e["type"] == "exchange" and e["owner"] == "self"
