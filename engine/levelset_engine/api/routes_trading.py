"""/tickets, /tickets/{id}/export, /trades, /fills."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import PlainTextResponse

from ..adapters.export import export_ticket
from ..clock import iso, parse_iso, to_ny
from ..services.trading import FillRejected
from ..storage import workspace as wsf
from .deps import Services, require_token, services
from .errors import ApiError
from .models import Fill, FillCreate, OpenTrade, Ticket, dump

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/tickets", response_model=list[Ticket])
def tickets(status: Literal["ready", "blocked", "stale", "all"] = Query("all"),
            s: Services = Depends(services)) -> list[dict]:
    return s.trading.tickets(status)


@router.get("/tickets/{ticketId}", response_model=Ticket)
def ticket(ticketId: str, s: Services = Depends(services)) -> dict:
    t = s.trading.ticket(ticketId)
    if t is None:
        raise ApiError(404, "ticket_not_found", "Ticket not found", ticketId)
    return t


@router.get("/tickets/{ticketId}/export", response_class=PlainTextResponse)
def export(ticketId: str, format: Literal["text", "csv", "json", "ctrader", "mt4", "mt5"] = Query(...),
           s: Services = Depends(services)) -> PlainTextResponse:
    t = s.trading.ticket(ticketId)
    if t is None:
        raise ApiError(404, "ticket_not_found", "Ticket not found", ticketId)
    public = dump(Ticket.model_validate(t))
    return PlainTextResponse(export_ticket(public, format), media_type="text/plain; charset=utf-8")


@router.get("/trades", response_model=list[OpenTrade])
async def trades(s: Services = Depends(services)) -> list[dict]:
    return await s.trading.open_trades()


@router.get("/fills", response_model=list[Fill])
def fills(s: Services = Depends(services)) -> list[dict]:
    return s.trading.fills()


@router.post("/fills", response_model=Fill, status_code=201)
async def create_fill(body: FillCreate, s: Services = Depends(services)) -> dict:
    try:
        return await s.trading.record_fill(dump(body))
    except FillRejected as e:
        raise ApiError(404 if e.code == "ticket_not_found" else 422, e.code, "Fill not recorded", e.detail)


# ---------------------------------------------------------------- DELETE /fills/{id}

def _fifo(fills: list[dict[str, Any]]) -> tuple[dict[str, list[list[Any]]], dict[str, list[list[Any]]]]:
    """Replay fills oldest first. Returns (open lots per symbol, lots each sell consumed by fill id).
    A lot is [qty, price, date]. Raises ValueError(fill_id) if a sell has no shares to sell."""
    lots: dict[str, list[list[Any]]] = {}
    consumed: dict[str, list[list[Any]]] = {}
    for f in fills:
        book = lots.setdefault(f["symbol"], [])
        day = _day(f)
        if f["side"] == "buy":
            book.append([int(f["qty"]), float(f["price"]), day])
            continue
        left, took = int(f["qty"]), []
        while left > 0 and book:
            take = min(left, book[0][0])
            took.append([take, book[0][1], book[0][2]])
            book[0][0] -= take
            left -= take
            if book[0][0] == 0:
                book.pop(0)
        if left > 0:
            raise ValueError(f["id"])
        consumed[f["id"]] = took
    return lots, consumed


def _day(f: dict[str, Any]) -> str:
    d = parse_iso(f.get("at"))
    return to_ny(d).date().isoformat() if d else ""


def _reverse_in_portfolio(pf: dict[str, Any], fill: dict[str, Any], consumed: list[list[Any]]) -> None:
    """Undo one fill in trader/portfolio.json (the shape trader-broker's apply_fill writes)."""
    sym, qty, price = fill["symbol"].upper(), float(fill["qty"]), float(fill["price"])
    cost = round(qty * price, 2)
    positions = pf.setdefault("positions", [])
    pos = next((p for p in positions if str(p.get("ticker", "")).upper() == sym), None)
    if fill["side"] == "buy":
        if pos is not None:
            lots = pos.setdefault("lots", [])
            exact = next((l for l in reversed(lots) if l.get("date") == _day(fill)
                          and abs(float(l.get("shares", 0)) - qty) < 1e-9
                          and abs(float(l.get("cost", 0)) - cost) < 0.011), None)
            if exact is not None:
                lots.remove(exact)
            else:  # the lot was partly sold since: take the shares from the newest lots
                left = qty
                for lot in sorted(lots, key=lambda l: l.get("date", ""), reverse=True):
                    if left <= 1e-9:
                        break
                    take = min(left, float(lot["shares"]))
                    per = float(lot["cost"]) / float(lot["shares"]) if float(lot["shares"]) else 0
                    lot["cost"] = round(float(lot["cost"]) - per * take, 2)
                    lot["shares"] = round(float(lot["shares"]) - take, 6)
                    left -= take
                pos["lots"] = [l for l in lots if float(l["shares"]) > 1e-9]
            pos["shares"] = round(float(pos.get("shares", 0)) - qty, 6)
            if pos["shares"] <= 1e-9:
                positions.remove(pos)
        pf["cash"] = round(float(pf.get("cash", 0)) + cost, 2)
    else:
        if pos is None:
            pos = {"ticker": sym, "shares": 0.0, "lots": []}
            positions.append(pos)
        lots = pos.setdefault("lots", [])
        for i, (q, px, day) in enumerate(consumed):
            lots.append({"id": "%s-r%d-%d" % (sym, len(lots) + 1, i), "date": day, "shares": float(q),
                         "cost": round(q * px, 2)})
        lots.sort(key=lambda l: l.get("date", ""))
        pos["shares"] = round(float(pos.get("shares", 0)) + qty, 6)
        pf["cash"] = round(float(pf.get("cash", 0)) - cost, 2)


def _void_in_broker_log(state: dict[str, Any], fill: dict[str, Any], now: str) -> None:
    """Mark the fill's records in trader/state/broker.json as voided (trader-risk only counts
    "placed" and "filled"), keeping the append-only log readable."""
    day, sym, qty = _day(fill), fill["symbol"].upper(), float(fill["qty"])

    def same_qty(rec: dict[str, Any]) -> bool:
        try:
            return abs(float(rec.get("qty")) - qty) < 1e-9
        except (TypeError, ValueError):
            return False

    def void(match: Any) -> None:
        for rec in reversed(state.get("orders") or []):
            if match(rec):
                rec.update(status="voided", voided_at=now, voided_reason="fill deleted in Levelset")
                return

    void(lambda r: r.get("status") == "filled" and r.get("date") == day and str(r.get("symbol", "")).upper() == sym
         and r.get("side") == fill["side"] and same_qty(r)
         and abs(float(r.get("price") or 0) - float(fill["price"])) < 1e-6)
    if fill["side"] == "buy" and fill.get("ticketId"):
        void(lambda r: r.get("status") == "placed" and r.get("kind") == "entry"
             and r.get("source") == "levelset-manual-fill" and r.get("ticket_id") == fill["ticketId"]
             and r.get("date") == day and same_qty(r))


@router.delete("/fills/{fillId}", status_code=204)
async def delete_fill(fillId: str, s: Services = Depends(services)) -> Response:
    ctx = s.ctx
    fill = ctx.db.get_fill(fillId)
    if fill is None:
        raise ApiError(404, "fill_not_found", "Fill not found", fillId)
    everything = ctx.db.list_fills(newest_first=False)
    _, consumed = _fifo(everything)
    try:
        _fifo([f for f in everything if f["id"] != fillId])
    except ValueError as e:
        raise ApiError(409, "fill_in_use", "Fill not deleted",
                       "a later sell (%s) needs the shares of this buy: delete that sell first" % e.args[0])
    async with ctx.lock:
        pf = ctx.ws.read_json(wsf.PORTFOLIO)
        if isinstance(pf, dict):
            _reverse_in_portfolio(pf, fill, consumed.get(fillId, []))
            ctx.ws.write_json(wsf.PORTFOLIO, pf)
        state = ctx.ws.read_json(wsf.BROKER)
        if isinstance(state, dict):
            _void_in_broker_log(state, fill, iso(ctx.clock.now()) or "")
            ctx.ws.write_json(wsf.BROKER, state)
        ctx.db.delete_fill(fillId)
    return Response(status_code=204)
