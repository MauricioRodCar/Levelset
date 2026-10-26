"""Alerts: stored in SQLite, checked by trader-alerts (alerts.py check), each rings once.

The engine owns trader/alerts.json: before every check it writes the armed
alerts there in the skill's rule format, runs `alerts.py check --json`, and
marks the rules that rang.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from ..clock import iso
from ..context import EngineContext, new_id
from ..storage import workspace as wsf

log = logging.getLogger("levelset.alerts")

PRICE_TYPES = {"above", "below", "stop", "target"}


class AlertRejected(Exception):
    def __init__(self, code: str, detail: str, status: int = 422) -> None:
        super().__init__(detail)
        self.code, self.detail, self.status = code, detail, status


def _public(a: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in a.items() if not k.startswith("_")}


class AlertService:
    def __init__(self, ctx: EngineContext) -> None:
        self.ctx = ctx

    def list(self) -> list[dict[str, Any]]:
        return [_public(a) for a in self.ctx.db.list_alerts()]

    def validate(self, body: dict[str, Any]) -> None:
        t = body["type"]
        if t in PRICE_TYPES and (not body.get("symbol") or body.get("level") is None):
            raise AlertRejected("invalid_alert", "an alert of type %s needs a symbol and a level" % t)
        if t == "pct_move" and (not body.get("symbol") or body.get("pct") is None):
            raise AlertRejected("invalid_alert", "a pct_move alert needs a symbol and a pct")
        if t == "time" and not body.get("time"):
            raise AlertRejected("invalid_alert", "a time alert needs a time (HH:MM, New York)")

    def create(self, body: dict[str, Any], date: str | None = None) -> dict[str, Any]:
        self.validate(body)
        a = {k: body.get(k) for k in ("type", "symbol", "level", "pct", "time", "note") if body.get(k) is not None}
        if a.get("symbol"):
            a["symbol"] = a["symbol"].upper()
        if a["type"] == "flat_by" and not a.get("time"):
            a["time"] = self.ctx.config_doc().get("flat_by") or "15:55"
        a.update(id=new_id("alr"), status="armed", createdAt=iso(self.ctx.clock.now()), rungAt=None)
        if date:
            a["_date"] = date
        self.ctx.db.put_alert(a)
        return _public(a)

    def delete(self, alert_id: str) -> bool:
        return self.ctx.db.delete_alert(alert_id)

    def from_plan(self, plan: dict[str, Any]) -> list[dict[str, Any]]:
        """Stop, target and flat-by alerts for the plan's day (trader-alerts add --from-plan rules)."""
        sym = str(plan.get("symbol") or "").upper()
        if not sym or plan.get("stop") is None or plan.get("target") is None:
            raise AlertRejected("no_plan", "the run has no complete plan (stop and target)", 409)
        date = plan.get("date")
        flat = plan.get("flat_by") or self.ctx.config_doc().get("flat_by") or "15:55"
        made = [
            self.create({"type": "stop", "symbol": sym, "level": float(plan["stop"]), "note": plan.get("stop_label")},
                        date),
            self.create({"type": "target", "symbol": sym, "level": float(plan["target"]),
                         "note": plan.get("target_label")}, date),
            self.create({"type": "flat_by", "symbol": sym, "time": flat}, date),
        ]
        return made

    # ---------------------------------------------------------------- the check
    @staticmethod
    def to_rule(a: dict[str, Any]) -> dict[str, Any]:
        t = a["type"]
        r: dict[str, Any] = {"id": a["id"]}
        if t in PRICE_TYPES:
            r.update(type=t, symbol=a["symbol"], price=float(a["level"]))
        elif t == "pct_move":
            r.update(type="pct_move", symbol=a["symbol"], pct=float(a["pct"]))
        elif t == "open_bell":
            r.update(type="opening_bell")
        elif t == "flat_by":
            r.update(type="time", at=a["time"], label="flat by close", before_close=True)
        else:
            r.update(type="time", at=a["time"], label=a.get("note") or "time alert")
        if a.get("symbol") and "symbol" not in r:
            r["symbol"] = a["symbol"]
        if a.get("note") and t != "time":
            r["note"] = a["note"]
        if a.get("_date"):
            r["date"] = a["_date"]
        return r

    async def check(self) -> list[dict[str, Any]]:
        """Run trader-alerts' check over the armed alerts; returns the alerts that rang now."""
        ctx = self.ctx
        armed = [a for a in ctx.db.list_alerts() if a.get("status") == "armed"]
        if not armed:
            return []
        async with ctx.lock:
            ctx.ws.write_json(wsf.ALERT_RULES, {"rules": [self.to_rule(a) for a in armed]})
            ctx.ws.write_json(wsf.ALERT_STATE, {"rung": {}})
            args = ["check"] + ctx.demo_args("alerts") + ctx.now_args() + (["--no-write"] if ctx.demo else [])
            res = await ctx.run_skill("alerts", args, locked=True)
        data = res.data if isinstance(res.data, dict) else None
        if data is None:
            log.warning("alerts check failed: %s", res.error_message())
            return []
        rung = []
        by_id = {a["id"]: a for a in armed}
        for ring in data.get("rings") or []:
            a = by_id.get(ring.get("id"))
            if not a:
                continue
            a.update(status="rung", rungAt=iso(ctx.clock.now()), _message=ring.get("message"))
            ctx.db.put_alert(a)
            pub = _public(a)
            ctx.bus.publish("alert.rung", pub)
            rung.append(pub)
        return rung

    async def loop(self, interval: float, market: Any) -> None:
        """Live mode: check armed alerts every `interval` seconds; emit status.changed on open/close."""
        last_open: bool | None = None
        while True:
            try:
                st = market.status()
                if last_open is not None and st["marketOpen"] != last_open:
                    self.ctx.bus.publish("status.changed", st)
                last_open = st["marketOpen"]
                await self.check()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - keep the loop alive
                log.exception("alert loop iteration failed")
            await asyncio.sleep(interval)
