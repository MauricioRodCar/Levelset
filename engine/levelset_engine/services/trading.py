"""Manual fills (v1 has no broker link), open trades, tickets and the dashboard KPIs."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from ..clock import iso, parse_iso, to_ny
from ..context import EngineContext, new_id
from ..pipeline.tickets import with_live_status
from ..storage import workspace as wsf
from .market import MarketService


class FillRejected(Exception):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code, self.detail = code, detail


def _ny_date(ts: str | None) -> str | None:
    d = parse_iso(ts)
    return to_ny(d).date().isoformat() if d else None


class TradingService:
    def __init__(self, ctx: EngineContext, market: MarketService) -> None:
        self.ctx = ctx
        self.market = market

    # ---------------------------------------------------------------- tickets
    def tickets(self, status: str = "all") -> list[dict[str, Any]]:
        now = self.ctx.clock.now()
        out = [with_live_status(t, now) for t in self.ctx.db.list_tickets()]
        return out if status == "all" else [t for t in out if t["status"] == status]

    def ticket(self, ticket_id: str) -> dict[str, Any] | None:
        t = self.ctx.db.get_ticket(ticket_id)
        return with_live_status(t, self.ctx.clock.now()) if t else None

    # ---------------------------------------------------------------- positions from fills
    def _positions(self) -> dict[str, dict[str, Any]]:
        """FIFO lots per symbol from the recorded fills, oldest first."""
        pos: dict[str, dict[str, Any]] = defaultdict(lambda: {"lots": [], "ticketId": None})
        for f in self.ctx.db.list_fills(newest_first=False):
            p = pos[f["symbol"]]
            if f["side"] == "buy":
                p["lots"].append([f["qty"], f["price"]])
                if f.get("ticketId"):
                    p["ticketId"] = f["ticketId"]
            else:
                left = f["qty"]
                while left > 0 and p["lots"]:
                    take = min(left, p["lots"][0][0])
                    p["lots"][0][0] -= take
                    left -= take
                    if p["lots"][0][0] == 0:
                        p["lots"].pop(0)
        return {s: p for s, p in pos.items() if sum(q for q, _ in p["lots"]) > 0}

    def held(self, symbol: str) -> int:
        p = self._positions().get(symbol.upper())
        return sum(q for q, _ in p["lots"]) if p else 0

    def fills(self) -> list[dict[str, Any]]:
        return self.ctx.db.list_fills()

    async def record_fill(self, body: dict[str, Any]) -> dict[str, Any]:
        ctx = self.ctx
        sym = body["symbol"].upper()
        side, qty, price = body["side"], int(body["qty"]), float(body["price"])
        ticket = ctx.db.get_ticket(body["ticketId"]) if body.get("ticketId") else None
        if body.get("ticketId") and ticket is None:
            raise FillRejected("ticket_not_found", "no ticket %s" % body["ticketId"])
        at = parse_iso(body.get("at")) or ctx.clock.now()
        realized = None
        if side == "sell":
            pos = self._positions().get(sym)
            have = sum(q for q, _ in pos["lots"]) if pos else 0
            if qty > have:
                raise FillRejected("insufficient_position", "selling %d %s but %d are open" % (qty, sym, have))
            left, cost = qty, 0.0
            for lq, lp in pos["lots"] if pos else []:
                take = min(left, lq)
                cost += take * lp
                left -= take
                if left == 0:
                    break
            realized = round(qty * price - cost, 2)
        day = to_ny(at).date().isoformat()
        # keep the skills' own books in step: trader/portfolio.json and the broker log (ticket.py fill)
        res = await ctx.run_skill("broker", ["fill", "--symbol", sym, "--side", side, "--qty", str(qty),
                                             "--price", "%.4f" % price, "--date", day] + ctx.now_args(),
                                  json_output=False)
        if res.code != 0:
            raise FillRejected("fill_not_recorded", res.error_message())
        if side == "buy" and ticket is not None:
            self._log_entry_for_risk(ticket, qty, at)
        fill = {"id": new_id("fill"), "symbol": sym, "side": side, "qty": qty, "price": price,
                "at": iso(at), "realizedPnl": realized}
        if body.get("ticketId"):
            fill["ticketId"] = body["ticketId"]
        ctx.db.put_fill(fill, iso(ctx.clock.now()) or "")
        return fill

    def _log_entry_for_risk(self, ticket: dict[str, Any], qty: int, at: Any) -> None:
        """trader-risk counts today's entries and their max losses from trader/state/broker.json
        (status "placed", kind "entry"). A manual fill of a ticket is that entry in v1."""
        state = self.ctx.ws.read_json(wsf.BROKER, {"orders": []}) or {"orders": []}
        max_loss = round(qty * float(ticket["riskPerShare"]), 2)
        state.setdefault("orders", []).append({
            "at": iso(at), "date": to_ny(at).date().isoformat(), "status": "placed", "kind": "entry",
            "symbol": ticket["symbol"], "side": ticket["side"], "qty": str(qty), "max_loss": max_loss,
            "stop": ticket["stop"], "source": "levelset-manual-fill", "ticket_id": ticket["id"],
            "plain": "%s %d %s (recorded by hand in Levelset)" % (ticket["side"].upper(), qty, ticket["symbol"])})
        self.ctx.ws.write_json(wsf.BROKER, state)

    # ---------------------------------------------------------------- open trades
    async def open_trades(self) -> list[dict[str, Any]]:
        pos = self._positions()
        quotes = await self.market.quotes(list(pos)) if pos else {}
        out = []
        for sym, p in sorted(pos.items()):
            qty = sum(q for q, _ in p["lots"])
            avg = round(sum(q * px for q, px in p["lots"]) / qty, 4)
            last = (quotes.get(sym) or {}).get("price")
            last = round(float(last), 2) if last is not None else None
            t = self.ctx.db.get_ticket(p["ticketId"]) if p["ticketId"] else None
            out.append({"symbol": sym, "qty": qty, "avgPrice": avg,
                        "lastPrice": last,
                        "unrealizedPnl": round((last - avg) * qty, 2) if last is not None else None,
                        "stop": t["stop"] if t else None, "target": t["target"] if t else None,
                        "flatBy": t["flatBy"] if t else None, "ticketId": p["ticketId"]})
        return out

    # ---------------------------------------------------------------- dashboard
    async def dashboard(self) -> dict[str, Any]:
        cfg = self.ctx.config_doc()
        today = self.ctx.clock.today_ny()
        fills_today = [f for f in self.ctx.db.list_fills() if _ny_date(f.get("at")) == today]
        realized = sum(float(f.get("realizedPnl") or 0) for f in fills_today)
        trades = await self.open_trades()
        unrealized = sum(float(t["unrealizedPnl"] or 0) for t in trades)
        entries = [f for f in fills_today if f["side"] == "buy"]
        risk_used = 0.0
        for f in entries:
            t = self.ctx.db.get_ticket(f["ticketId"]) if f.get("ticketId") else None
            if t:
                risk_used += f["qty"] * float(t["riskPerShare"])
        wl = self.market.last_watchlist()
        return {"dayPnl": round(realized + unrealized, 2), "riskUsed": round(risk_used, 2),
                "dailyLossLimit": float(cfg.get("max_daily_loss_usd") or 0),
                "tradesToday": len(entries), "maxTradesPerDay": int(cfg.get("max_trades_per_day") or 0),
                "setupsFound": len(wl.get("hits") or []), "lastScanAt": self.market.last_scan_at()}
