"""Tickets: trader/orders.json + trader-risk's verdict + the time machine result."""

from __future__ import annotations

import datetime as dt
from typing import Any

from ..clock import iso, ny_local_to_utc
from .codes import risk_codes, tm_summary


def _f(x: Any) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def build_ticket(ticket_id: str, run_id: str, order: dict[str, Any], risk_result: dict[str, Any] | None,
                 tm_doc: dict[str, Any] | None, plan: dict[str, Any] | None, cfg: dict[str, Any],
                 created_at: dt.datetime) -> dict[str, Any]:
    oplan = order.get("plan") or {}
    plan = plan or {}
    rr = risk_result or {}
    entry = _f(rr.get("entry_ref")) or _f(order.get("limit_price")) or _f(oplan.get("entry")) or _f(plan.get("entry"))
    stop = _f(order.get("stop_loss_stop_price")) or _f(oplan.get("stop")) or _f(plan.get("stop"))
    target = _f(order.get("take_profit_limit_price")) or _f(oplan.get("target")) or _f(plan.get("target"))
    qty = int(float(order.get("qty") or 0))
    if entry is None or stop is None or target is None:
        raise ValueError("the order has no entry, stop or target")
    risk_ps = _f(rr.get("risk_per_share")) or round(abs(entry - stop), 2)
    reward_ps = round(abs(target - entry), 2)
    max_loss = _f(rr.get("max_loss"))
    if max_loss is None:
        max_loss = _f(oplan.get("max_loss")) or round(qty * risk_ps, 2)
    verdict = rr.get("verdict")
    reasons = list(rr.get("reasons") or [])
    status = "blocked" if verdict != "PASS" else "ready"
    if verdict is None:
        reasons = reasons or ["risk: trader-risk has not checked this order"]
    t: dict[str, Any] = {
        "id": ticket_id,
        "runId": run_id,
        "symbol": str(order.get("symbol", "")).upper(),
        "side": "sell" if str(order.get("side", "buy")).lower() == "sell" else "buy",
        "qty": qty,
        "orderType": "limit" if str(order.get("type", "market")) == "limit" else "market",
        "timeInForce": "gtc" if str(order.get("time_in_force", "day")) == "gtc" else "day",
        "entry": round(entry, 2),
        "stop": round(stop, 2),
        "target": round(target, 2),
        "riskPerShare": round(risk_ps, 2),
        "rewardPerShare": reward_ps,
        "rMultiple": round(reward_ps / risk_ps, 2) if risk_ps else 0.0,
        "maxLoss": round(max_loss, 2),
        "positionUsd": round(qty * entry, 2),
        "flatBy": oplan.get("flat_by") or plan.get("flat_by") or cfg.get("flat_by") or "15:55",
        "status": status,
        "riskReasons": risk_codes(reasons) if status == "blocked" else [],
        "riskDetail": reasons + list(rr.get("info") or []) + list(rr.get("warnings") or []),
        "timeMachine": tm_summary(tm_doc),
        "createdAt": iso(created_at),
        # internal, never on the wire
        "_date": plan.get("date") or (risk_result or {}).get("date"),
        "_noEntriesAfter": cfg.get("no_entries_after"),
    }
    return t


def window_closes_at(ticket: dict[str, Any]) -> dt.datetime | None:
    day, after = ticket.get("_date"), ticket.get("_noEntriesAfter")
    if not day:
        return None
    try:
        d = dt.date.fromisoformat(str(day))
        hh, mm = (int(x) for x in str(after or "15:30").split(":"))
    except ValueError:
        return None
    return ny_local_to_utc(dt.datetime.combine(d, dt.time(hh, mm)))


def with_live_status(ticket: dict[str, Any], now_utc: dt.datetime) -> dict[str, Any]:
    """A ready ticket becomes stale once its entry window has passed."""
    if ticket.get("status") != "ready":
        return ticket
    closes = window_closes_at(ticket)
    if closes is not None and now_utc > closes:
        return dict(ticket, status="stale")
    return ticket
