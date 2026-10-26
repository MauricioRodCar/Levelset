"""GET /bars: intraday bars for the Pipeline charts (demo reads the vendored fixtures)."""

from __future__ import annotations

from contract import validate

from levelset_engine.api.routes_bars import completed, opening_range, parse_yahoo_chart


def test_demo_tsla_bars_stop_at_the_pinned_clock(client):
    r = client.get("/bars", params={"symbol": "tsla"})
    assert r.status_code == 200, r.text
    body = r.json()
    validate(body, "Bars")
    assert body["symbol"] == "TSLA" and body["interval"] == "5m"
    bars = body["bars"]
    # 09:30 .. 10:10 ET: nine 5-minute bars closed by 10:15
    assert len(bars) == 9
    assert bars[0]["t"] == 1792416600 and bars[-1]["t"] == 1792419000
    assert bars[-1]["c"] == 364.18  # the trigger bar
    assert (body["rangeHigh"], body["rangeLow"]) == (362.18, 354.47)


def test_demo_other_symbols_come_from_the_scanner_wall(client):
    body = client.get("/bars", params={"symbol": "AAPL"}).json()
    validate(body, "Bars")
    assert body["bars"] and all(b["t"] + 300 <= 1792419300 for b in body["bars"])
    assert body["rangeHigh"] is not None and body["rangeHigh"] >= body["rangeLow"]


def test_unknown_and_invalid_symbols(client):
    r = client.get("/bars", params={"symbol": "ZZZZ"})
    assert r.status_code == 404 and r.json()["code"] == "not_found"
    r = client.get("/bars", params={"symbol": "not a ticker"})
    assert r.status_code == 422
    r = client.get("/bars")
    assert r.status_code == 422


def test_bars_need_the_token(client):
    assert client.get("/bars", params={"symbol": "TSLA"}, headers={"Authorization": ""}).status_code == 401


def test_parsing_helpers():
    doc = {"chart": {"result": [{
        "meta": {"currentTradingPeriod": {"regular": {"start": 1000 * 300}}},
        "timestamp": [1000 * 300, 1001 * 300, 1002 * 300, 1003 * 300, 1003 * 300 + 17],
        "indicators": {"quote": [{"open": [1, 2, None, 4, 5], "high": [2, 3, 4, 5, 5],
                                  "low": [0.5, 1, 2, 3, 5], "close": [1.5, 2.5, 3.5, 4.5, 5],
                                  "volume": [10, 20, 30, None, 0]}]}}]}}
    rows, start = parse_yahoo_chart(doc)
    assert start == 300000 and [b["t"] for b in rows] == [300000, 300300, 300900, 300917]
    assert rows[2]["v"] == 0.0
    done = completed(rows, "5m", 300900 + 300)
    assert [b["t"] for b in done] == [300000, 300300, 300900]
    assert opening_range(done, start, 300) == (3, 0.5)  # 300600 has no price; 300900 is after the range
    assert opening_range(done[:2], start, 300) == (None, None)  # the 15-minute range is not complete yet
    assert parse_yahoo_chart({}) == ([], None)
