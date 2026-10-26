"""Platform bridges: signal files, cancel, acks, heartbeat status, symbol map and volume rounding.

The engine only writes files; nothing here (or anywhere) sends an order."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Iterator

import pytest
from fastapi.testclient import TestClient

from levelset_engine.bridges import files
from levelset_engine.bridges.service import convert_volume

from conftest import make_client
from contract import response_schema, validate, validate_list

TSLA_ROWS = [
    {"platform": "ctrader", "usSymbol": "TSLA", "brokerSymbol": "TSLA.US", "volumePerShare": 1,
     "minVolume": 1, "volumeStep": 1},
    {"platform": "mt5", "usSymbol": "TSLA", "brokerSymbol": "TSLA.US", "volumePerShare": 0.01,
     "minVolume": 0.01, "volumeStep": 0.01},
    {"platform": "mt4", "usSymbol": "TSLA", "brokerSymbol": "#TSLA", "volumePerShare": 0.1,
     "minVolume": 1, "volumeStep": 1},
]


def _ticket(tid: str = "tkt_bridge_tsla", status: str = "ready", qty: int = 8) -> dict[str, Any]:
    """The README TSLA ticket (2026-10-19), stored straight in SQLite."""
    return {
        "id": tid, "runId": "run_bridge", "symbol": "TSLA", "side": "buy", "qty": qty, "orderType": "market",
        "timeInForce": "day", "entry": 364.18, "stop": 358.32, "target": 370.04, "riskPerShare": 5.86,
        "rewardPerShare": 5.86, "rMultiple": 1.0, "maxLoss": round(qty * 5.86, 2), "positionUsd": 2913.44,
        "flatBy": "15:55", "status": status, "riskReasons": ["daily_limit"] if status == "blocked" else [],
        "riskDetail": [], "timeMachine": None, "createdAt": "2026-10-19T10:15:00-04:00",
        "_date": "2026-10-19", "_noEntriesAfter": "15:30",
    }


@pytest.fixture
def env(tmp_path: Path) -> Iterator[tuple[TestClient, Path]]:
    folder = tmp_path / "signals"
    with make_client(tmp_path / "ws") as c:
        db = c.app.state.services.ctx.db
        db.put_ticket(_ticket())
        db.put_ticket(_ticket("tkt_bridge_blocked", "blocked"))
        r = c.patch("/bridges/settings", json={"signalsFolder": str(folder),
                                                "platforms": {"ctrader": {"enabled": True}, "mt5": {"enabled": True}}})
        assert r.status_code == 200, r.text
        r = c.put("/bridges/symbol-map", json={"rows": TSLA_ROWS})
        assert r.status_code == 200, r.text
        yield c, folder


def _json(p: Path) -> dict[str, Any]:
    raw = p.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf"), "no BOM"
    assert b"\n" not in raw, "flat one-line JSON"
    return json.loads(raw.decode("utf-8"))


# ---------------------------------------------------------------- volume conversion

def test_volume_rounds_down_never_up() -> None:
    row = {"volumePerShare": 0.01, "minVolume": 0.01, "volumeStep": 0.01}
    assert convert_volume(8, row) == 0.08
    assert convert_volume(3, {"volumePerShare": 0.1, "minVolume": 1, "volumeStep": 1}) == 0.0
    assert convert_volume(29, {"volumePerShare": 0.1, "minVolume": 0.1, "volumeStep": 0.5}) == 2.5
    assert convert_volume(7, {"volumePerShare": 1, "minVolume": 1, "volumeStep": 5}) == 5.0
    assert convert_volume(3, {"volumePerShare": 0.1, "minVolume": 0.1, "volumeStep": 0.1}) == 0.3  # no float drift


# ---------------------------------------------------------------- settings / status / symbol map

def test_settings_status_and_map_match_contract(env: tuple[TestClient, Path]) -> None:
    c, folder = env
    s = c.get("/bridges/settings").json()
    validate(s, "BridgeSettings")
    assert s["signalsFolder"] == str(folder)
    assert s["platforms"] == {"ctrader": {"enabled": True}, "mt4": {"enabled": False}, "mt5": {"enabled": True}}
    for p in ("ctrader", "mt5"):
        for sub in ("signals", "cancel", "acks"):
            assert (folder / p / sub).is_dir()
    st = c.get("/bridges/status").json()
    validate(st, schema=response_schema("/bridges/status", "get", "200"))
    assert [r["state"] for r in st] == ["not_installed"] * 3
    m = c.get("/bridges/symbol-map").json()
    validate(m, "SymbolMap")
    assert [r["brokerSymbol"] for r in m["rows"]] == ["TSLA.US", "TSLA.US", "#TSLA"]


def test_default_folder_and_validation(tmp_path: Path) -> None:
    with make_client(tmp_path / "ws") as c:
        s = c.get("/bridges/settings").json()
        assert Path(s["signalsFolder"]).is_absolute()  # demo: inside the demo workspace
        assert s["platforms"]["ctrader"] == {"enabled": False}
        r = c.patch("/bridges/settings", json={"signalsFolder": "relative\\folder"})
        assert r.status_code == 422 and r.json()["code"] == "validation_error"
        dup = {"rows": [TSLA_ROWS[0], dict(TSLA_ROWS[0], brokerSymbol="TSLA")]}
        r = c.put("/bridges/symbol-map", json=dup)
        assert r.status_code == 422 and r.json()["code"] == "validation_error"
        r = c.put("/bridges/symbol-map", json={"rows": [dict(TSLA_ROWS[0], volumeStep=0)]})
        assert r.status_code == 422 and r.json()["code"] == "validation_error"


def test_unwritable_folder(tmp_path: Path) -> None:
    blocker = tmp_path / "a-file"
    blocker.write_text("x")
    with make_client(tmp_path / "ws") as c:
        r = c.patch("/bridges/settings", json={"signalsFolder": str(blocker / "sub"),
                                               "platforms": {"ctrader": {"enabled": True}}})
        assert r.status_code == 500 and r.json()["code"] == "bridge_folder_unwritable"


# ---------------------------------------------------------------- send

def test_send_writes_one_signal_per_platform(env: tuple[TestClient, Path]) -> None:
    c, folder = env
    r = c.post("/tickets/tkt_bridge_tsla/send-to-bridge", json={})
    assert r.status_code == 200, r.text
    state = r.json()
    validate(state, "BridgeTicketState")
    assert [p["platform"] for p in state["platforms"]] == ["ctrader", "mt5"]
    assert {p["state"] for p in state["platforms"]} == {"written"}
    sid = state["signalId"]
    ct = _json(folder / "ctrader" / "signals" / ("%s.json" % sid))
    validate(ct, "BridgeSignal")
    assert (ct["brokerSymbol"], ct["volume"], ct["volumeUnit"]) == ("TSLA.US", 8, "units")
    assert (ct["entry"], ct["stopLoss"], ct["takeProfit"], ct["qtyShares"], ct["maxLossUsd"]) == \
        (364.18, 358.32, 370.04, 8, 46.88)
    assert ct["expiresAtUnix"] > ct["createdAtUnix"] and len(ct["comment"]) <= 31
    mt5 = _json(folder / "mt5" / "signals" / ("%s.json" % sid))
    validate(mt5, "BridgeSignal")
    assert (mt5["volume"], mt5["volumeUnit"]) == (0.08, "lots")
    assert not list((folder / "mt5" / "signals").glob("*.tmp"))
    assert not (folder / "mt4").exists()  # mt4 is not enabled
    t = c.get("/tickets/tkt_bridge_tsla").json()
    validate(t, "Ticket")
    assert t["bridge"]["signalId"] == sid
    assert "bridge" not in c.get("/tickets/tkt_bridge_blocked").json()


def test_only_ready_tickets_can_be_sent(env: tuple[TestClient, Path]) -> None:
    c, folder = env
    r = c.post("/tickets/tkt_bridge_blocked/send-to-bridge")
    assert r.status_code == 409 and r.json()["code"] == "ticket_not_ready"
    db = c.app.state.services.ctx.db
    stale = dict(_ticket("tkt_bridge_stale"), _date="2026-10-16")  # entry window long gone
    db.put_ticket(stale)
    r = c.post("/tickets/tkt_bridge_stale/send-to-bridge")
    assert r.status_code == 409 and r.json()["code"] == "ticket_not_ready"
    assert c.post("/tickets/nope/send-to-bridge").json()["code"] == "ticket_not_found"
    assert not list((folder / "ctrader" / "signals").glob("*.json"))


def test_send_errors(env: tuple[TestClient, Path]) -> None:
    c, _ = env
    r = c.post("/tickets/tkt_bridge_tsla/send-to-bridge", json={"platforms": ["mt4"]})
    assert r.status_code == 409 and r.json()["code"] == "bridge_disabled"
    c.patch("/bridges/settings", json={"platforms": {"mt4": {"enabled": True}}})
    r = c.post("/tickets/tkt_bridge_tsla/send-to-bridge", json={"platforms": ["mt4"]})  # 8 * 0.1 = 0.8 < 1 lot
    assert r.status_code == 422 and r.json()["code"] == "bridge_volume_too_small"
    c.put("/bridges/symbol-map", json={"rows": TSLA_ROWS[1:]})
    r = c.post("/tickets/tkt_bridge_tsla/send-to-bridge", json={"platforms": ["ctrader"]})
    assert r.status_code == 422 and r.json()["code"] == "bridge_symbol_unmapped"
    validate(r.json(), "Problem")
    c.patch("/bridges/settings", json={"platforms": {"ctrader": {"enabled": False}, "mt4": {"enabled": False},
                                                     "mt5": {"enabled": False}}})
    r = c.post("/tickets/tkt_bridge_tsla/send-to-bridge")
    assert r.status_code == 409 and r.json()["code"] == "bridge_disabled"


def test_resend_replaces_and_cancel(env: tuple[TestClient, Path]) -> None:
    c, folder = env
    assert c.post("/tickets/tkt_bridge_tsla/cancel-bridge").json()["code"] == "bridge_not_sent"
    first = c.post("/tickets/tkt_bridge_tsla/send-to-bridge").json()
    second = c.post("/tickets/tkt_bridge_tsla/send-to-bridge", json={"platforms": ["ctrader"]}).json()
    assert second["signalId"] != first["signalId"]
    for p in ("ctrader", "mt5"):
        doc = _json(folder / p / "cancel" / ("%s.json" % first["signalId"]))
        validate(doc, "BridgeCancel")
        assert doc["reason"] == "replaced"
    r = c.post("/tickets/tkt_bridge_tsla/cancel-bridge")
    assert r.status_code == 200
    state = r.json()
    validate(state, "BridgeTicketState")
    assert state["cancelledAt"] and state["platforms"][0]["state"] == "cancelled"
    doc = _json(folder / "ctrader" / "cancel" / ("%s.json" % second["signalId"]))
    validate(doc, "BridgeCancel")
    assert doc["reason"] == "user"
    assert c.get("/tickets/tkt_bridge_tsla").json()["bridge"]["cancelledAt"] == state["cancelledAt"]


# ---------------------------------------------------------------- acks + heartbeat

def _write_ack(folder: Path, platform: str, state: dict[str, Any], ack_state: str, error: str = "",
               encoding: str = "utf-8") -> None:
    ack = {"schema": "levelset.ack/1", "signalId": state["signalId"], "ticketId": state["ticketId"],
           "platform": platform, "state": ack_state, "timeUnix": int(time.time()), "error": error}
    validate(ack, "BridgeAck")
    p = folder / platform / "acks" / ("%s.json" % state["signalId"])
    p.write_bytes(json.dumps(ack).encode(encoding))
    import os
    st = p.stat()
    os.utime(p, (st.st_atime, st.st_mtime + 1))  # make sure the engine sees a new version


def test_acks_update_ticket_bridge(env: tuple[TestClient, Path]) -> None:
    c, folder = env
    svc = c.app.state.bridges
    state = c.post("/tickets/tkt_bridge_tsla/send-to-bridge").json()
    _write_ack(folder, "ctrader", state, "shown")
    _write_ack(folder, "mt5", state, "rejected", "Invalid stops", encoding="utf-16")  # MQL default encoding
    updated = svc.poll()
    assert len(updated) == 1
    validate(updated[0], "BridgeTicketState")
    by = {p["platform"]: p for p in updated[0]["platforms"]}
    assert by["ctrader"]["state"] == "shown" and by["ctrader"]["error"] is None
    assert by["mt5"]["state"] == "rejected" and by["mt5"]["error"] == "Invalid stops"
    assert svc.poll() == []  # nothing new
    _write_ack(folder, "ctrader", state, "placed")
    svc.poll()
    t = c.get("/tickets/tkt_bridge_tsla").json()
    validate(t, "Ticket")
    assert t["bridge"]["platforms"][0]["state"] == "placed"
    # a cancel never "undoes" a placed order: it stays placed
    after = c.post("/tickets/tkt_bridge_tsla/cancel-bridge").json()
    assert {p["platform"]: p["state"] for p in after["platforms"]} == {"ctrader": "placed", "mt5": "cancelled"}
    _write_ack(folder, "mt5", state, "shown")  # a late ack after the cancel is ignored
    assert svc.poll() == []


def test_ack_for_replaced_signal_is_ignored(env: tuple[TestClient, Path]) -> None:
    c, folder = env
    first = c.post("/tickets/tkt_bridge_tsla/send-to-bridge").json()
    c.post("/tickets/tkt_bridge_tsla/send-to-bridge")
    _write_ack(folder, "ctrader", first, "placed")
    assert c.app.state.bridges.poll() == []


def _heartbeat(folder: Path, platform: str, age: float, state: str = "running", error: str = "") -> None:
    hb = {"schema": "levelset.heartbeat/1", "platform": platform, "bridgeVersion": "1.1.0",
          "platformVersion": "5.0.40", "state": state, "accountIsDemo": True, "broker": "Pepperstone",
          "timeUnix": int(time.time() - age), "pendingSignals": 1, "missingSymbols": ["NVDA.US"], "error": error}
    validate(hb, "BridgeHeartbeat")
    files.write_atomic(folder / platform / "heartbeat.json", hb)


def test_heartbeat_online_offline_error(env: tuple[TestClient, Path]) -> None:
    c, folder = env
    _heartbeat(folder, "ctrader", 2)
    _heartbeat(folder, "mt5", 120)
    (folder / "mt4").mkdir(parents=True, exist_ok=True)
    _heartbeat(folder, "mt4", 1, state="error", error="AutoTrading is off")
    rows = c.get("/bridges/status").json()
    validate(rows, schema=response_schema("/bridges/status", "get", "200"))
    by = {r["platform"]: r for r in rows}
    assert by["ctrader"]["state"] == "online" and by["ctrader"]["accountIsDemo"] is True
    assert by["ctrader"]["missingSymbols"] == ["NVDA.US"] and by["ctrader"]["bridgeVersion"] == "1.1.0"
    assert by["mt5"]["state"] == "offline"
    assert by["mt4"]["state"] == "error" and by["mt4"]["error"] == "AutoTrading is off"


def test_status_change_publishes_event(env: tuple[TestClient, Path]) -> None:
    c, folder = env
    svc = c.app.state.bridges
    seen: list[tuple[str, Any]] = []
    svc.ctx.bus.publish = lambda name, data: seen.append((name, data))  # type: ignore[method-assign]
    svc.poll()  # first poll records the baseline
    _heartbeat(folder, "ctrader", 1)
    svc.poll()
    assert [n for n, _ in seen] == ["bridge.status"]
    validate(seen[0][1], "BridgeStatus")
    _heartbeat(folder, "ctrader", 300)
    svc.poll()
    assert seen[-1][1]["state"] == "offline"


def test_every_bridge_path_is_served(env: tuple[TestClient, Path]) -> None:
    c, _ = env
    for path in ("/bridges/settings", "/bridges/status", "/bridges/symbol-map"):
        assert c.get(path).status_code == 200
    for path in ("/tickets/tkt_bridge_tsla/send-to-bridge", "/tickets/tkt_bridge_tsla/cancel-bridge"):
        assert c.post(path).status_code in (200, 404, 409, 422)
    validate_list(c.get("/bridges/status").json(), "BridgeStatus")
