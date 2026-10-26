"""/tickets, /tickets/{id}/export, /trades, /fills."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse

from ..adapters.export import export_ticket
from ..services.trading import FillRejected
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
