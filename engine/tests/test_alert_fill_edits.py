"""PATCH /alerts/{id} (edit / re-arm) and DELETE /fills/{id} (fix a wrong manual fill)."""

from __future__ import annotations

from conftest import run_all
from contract import validate


def test_patch_alert_edit_and_rearm(client):
    above = client.post("/alerts", json={"type": "above", "symbol": "TSLA", "level": 366}).json()

    r = client.patch("/alerts/%s" % above["id"], json={"level": 368.5, "note": "breakout"})
    assert r.status_code == 200, r.text
    edited = r.json()
    validate(edited, "Alert")
    assert (edited["level"], edited["note"], edited["status"], edited["createdAt"]) == \
        (368.5, "breakout", "armed", above["createdAt"])

    # change the type: the merged alert is validated like a new one
    bad = client.patch("/alerts/%s" % above["id"], json={"type": "pct_move"})
    assert bad.status_code == 422 and bad.json()["code"] == "invalid_alert"
    moved = client.patch("/alerts/%s" % above["id"], json={"type": "pct_move", "pct": 3, "level": None}).json()
    assert moved["type"] == "pct_move" and moved["pct"] == 3 and "level" not in moved
    assert client.patch("/alerts/%s" % above["id"], json={"level": -1}).status_code == 422
    assert client.patch("/alerts/%s" % above["id"], json={"status": "rung"}).status_code == 422
    nope = client.patch("/alerts/nope", json={"status": "armed"})
    assert nope.status_code == 404 and nope.json()["code"] == "alert_not_found"

    # ring it, then re-arm it: it rings again on the next check
    client.patch("/alerts/%s" % above["id"], json={"type": "above", "level": 366, "pct": None})
    svc = client.app.state.services
    assert above["id"] in {a["id"] for a in client.portal.call(svc.alerts.check)}
    rung = {a["id"]: a for a in client.get("/alerts").json()}[above["id"]]
    assert rung["status"] == "rung" and rung["rungAt"]
    rearmed = client.patch("/alerts/%s" % above["id"], json={"status": "armed"}).json()
    validate(rearmed, "Alert")
    assert rearmed["status"] == "armed" and rearmed["rungAt"] is None
    assert above["id"] in {a["id"] for a in client.portal.call(svc.alerts.check)}


def test_patch_flat_by_keeps_a_time(client):
    a = client.post("/alerts", json={"type": "flat_by", "symbol": "tsla"}).json()
    r = client.patch("/alerts/%s" % a["id"], json={"time": None, "symbol": "nvda"}).json()
    assert r["time"] == "15:55" and r["symbol"] == "NVDA"


def test_delete_fill_reverses_portfolio_and_risk_log(client):
    run = run_all(client, params={"timemachine": {"replays": 500}})
    tid = run["ticketId"]
    ws = client.app.state.services.ctx.ws
    before = ws.read_json("trader/portfolio.json")
    cash0 = before["cash"] if before else None

    buy = client.post("/fills", json={"symbol": "TSLA", "side": "buy", "qty": 8, "price": 364.20,
                                      "ticketId": tid}).json()
    sell = client.post("/fills", json={"symbol": "TSLA", "side": "sell", "qty": 3, "price": 370.0}).json()
    assert ws.read_json("trader/portfolio.json")["positions"][0]["shares"] == 5

    # the buy can't go while a later sell depends on it
    r = client.delete("/fills/%s" % buy["id"])
    assert r.status_code == 409 and r.json()["code"] == "fill_in_use"

    # delete the sell: the 3 shares come back at their cost, cash goes back down
    assert client.delete("/fills/%s" % sell["id"]).status_code == 204
    pf = ws.read_json("trader/portfolio.json")
    pos = pf["positions"][0]
    assert pos["shares"] == 8 and round(sum(l["cost"] for l in pos["lots"]), 2) == round(8 * 364.20, 2)
    assert client.get("/trades").json()[0]["qty"] == 8

    # now the buy: the position disappears, cash is restored, trader-risk stops counting the entry
    assert client.delete("/fills/%s" % buy["id"]).status_code == 204
    pf = ws.read_json("trader/portfolio.json")
    assert pf["positions"] == []
    if cash0 is not None:
        assert pf["cash"] == cash0
    log = ws.read_json("trader/state/broker.json")["orders"]
    assert not any(o.get("status") in ("placed", "filled") and o.get("symbol") == "TSLA"
                   and (o.get("source") == "levelset-manual-fill" or o.get("status") == "filled") for o in log)
    assert sum(1 for o in log if o.get("status") == "voided") == 3
    assert client.get("/fills").json() == []
    assert client.get("/trades").json() == []
    d = client.get("/dashboard").json()
    assert d["tradesToday"] == 0 and d["riskUsed"] == 0

    gone = client.delete("/fills/%s" % buy["id"])
    assert gone.status_code == 404 and gone.json()["code"] == "fill_not_found"

    # with the entry voided, a new TSLA entry today is no longer a duplicate for trader-risk
    run2 = run_all(client, ticker="TSLA", params={"timemachine": {"replays": 500}})
    st = {s["key"]: s for s in run2["steps"]}
    assert "duplicate" not in (st["risk"].get("checks") or [])
