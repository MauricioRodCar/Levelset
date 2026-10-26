"""Platform adapters, v1 = export only. Plain text with the levels; never a broker call.

The instruction texts are the documented English fallbacks of the export files
(the UI shows its own translated how-to cards; these files are what gets copied
or saved).
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any, Callable

FORMATS = ("text", "csv", "json", "ctrader", "mt4", "mt5")

CSV_FIELDS = ("id", "symbol", "side", "qty", "orderType", "timeInForce", "entry", "stop", "target",
              "riskPerShare", "rewardPerShare", "rMultiple", "maxLoss", "positionUsd", "flatBy", "status",
              "createdAt")

NOTE = ("Levelset never sends orders. Check the symbol and contract size on your platform: "
        "a CFD can differ from the US stock analysed. Not financial advice.")


def _p(x: Any) -> str:
    return "%.2f" % float(x) if x is not None else "-"


def _side(t: dict[str, Any]) -> str:
    return str(t.get("side", "buy")).upper()


def as_text(t: dict[str, Any]) -> str:
    tm = t.get("timeMachine") or {}
    lines = [
        "%s %s %s (%s, %s)" % (_side(t), t["qty"], t["symbol"], t.get("orderType", "market"),
                               t.get("timeInForce", "day")),
        "Entry:       %s" % _p(t["entry"]),
        "Stop loss:   %s" % _p(t["stop"]),
        "Take profit: %s" % _p(t["target"]),
        "Max loss:    $%s (%s R target, %s a share at risk)" % (_p(t["maxLoss"]), _p(t["rMultiple"]),
                                                               _p(t["riskPerShare"])),
        "Flat by:     %s ET" % (t.get("flatBy") or "-"),
        "Risk check:  %s" % ("PASS" if t["status"] == "ready" else t["status"].upper()),
    ]
    if tm:
        lines.append("Time machine: target first %.1f %%, stop first %.1f %%, open at close %.1f %% (%s)"
                     % (tm["targetFirstPct"], tm["stopFirstPct"], tm["openAtClosePct"], tm["verdict"]))
    if t.get("riskReasons"):
        lines.append("Blocked: " + ", ".join(t["riskReasons"]))
    lines.append(NOTE)
    return "\n".join(lines) + "\n"


def as_csv(t: dict[str, Any]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(CSV_FIELDS)
    w.writerow(["" if t.get(k) is None else t.get(k) for k in CSV_FIELDS])
    return buf.getvalue()


def as_json(t: dict[str, Any]) -> str:
    return json.dumps(t, indent=2) + "\n"


def as_ctrader(t: dict[str, Any]) -> str:
    return "\n".join([
        "cTrader: manual order for %s" % t["symbol"],
        "1. Open the symbol that matches %s (check the CFD symbol and its contract size)." % t["symbol"],
        "2. New Order > %s > %s." % ("Market" if t.get("orderType", "market") == "market" else "Limit",
                                    "Buy" if t.get("side") == "buy" else "Sell"),
        "3. Quantity: %s shares (convert to lots if your broker uses lots)." % t["qty"],
        "%s" % ("4. Limit price: %s" % _p(t["entry"]) if t.get("orderType") == "limit"
                else "4. Expected entry around %s (market order)." % _p(t["entry"])),
        "5. Stop Loss (price): %s" % _p(t["stop"]),
        "6. Take Profit (price): %s" % _p(t["target"]),
        "7. Close the position by %s ET if neither level is hit." % (t.get("flatBy") or "15:55"),
        "Max loss at the stop: $%s." % _p(t["maxLoss"]),
        NOTE,
    ]) + "\n"


def _as_mt(t: dict[str, Any], version: str) -> str:
    market = t.get("orderType", "market") == "market"
    buy = t.get("side") == "buy"
    kind = ("Market Execution, %s" % ("Buy" if buy else "Sell")) if market else \
        ("Pending Order, %s Limit at %s" % ("Buy" if buy else "Sell", _p(t["entry"])))
    return "\n".join([
        "%s: manual order for %s" % (version, t["symbol"]),
        "1. Market Watch: find the symbol that matches %s (check the CFD symbol and contract size)." % t["symbol"],
        "2. New Order (F9). Type: %s." % kind,
        "3. Volume: %s shares (convert to lots if your broker quotes lots)." % t["qty"],
        "4. Stop Loss: %s" % _p(t["stop"]),
        "5. Take Profit: %s" % _p(t["target"]),
        "%s" % ("6. Expected entry around %s." % _p(t["entry"]) if market else "6. Expiration: end of day."),
        "7. Close the position by %s ET if neither level is hit." % (t.get("flatBy") or "15:55"),
        "Max loss at the stop: $%s." % _p(t["maxLoss"]),
        NOTE,
    ]) + "\n"


EXPORTERS: dict[str, Callable[[dict[str, Any]], str]] = {
    "text": as_text,
    "csv": as_csv,
    "json": as_json,
    "ctrader": as_ctrader,
    "mt4": lambda t: _as_mt(t, "MetaTrader 4"),
    "mt5": lambda t: _as_mt(t, "MetaTrader 5"),
}


def export_ticket(ticket: dict[str, Any], fmt: str) -> str:
    if fmt not in EXPORTERS:
        raise ValueError("unknown format %r" % fmt)
    return EXPORTERS[fmt](ticket)
