"""/analyst/{symbol} (trader-analyst) and /congress/* (trader-pelosi)."""

from __future__ import annotations

import re
from typing import Literal, Optional

from fastapi import APIRouter, Body, Depends, Query, Request
from pydantic import BaseModel, ConfigDict

from ..services.research import AnalystError, CongressFailed, ResearchService
from .deps import require_token
from .errors import ApiError

router = APIRouter(dependencies=[Depends(require_token)])
TICKER = re.compile(r"^[A-Z]{1,5}([.\-][A-Z]{1,2})?$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class CongressSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    notifyOnWatchlist: Optional[bool] = None
    members: Optional[list[str]] = None


def research(request: Request) -> ResearchService:
    return request.app.state.research


@router.get("/analyst/{symbol}")
async def analyst(symbol: str, quarters: int = Query(6, ge=1, le=12),
                  r: ResearchService = Depends(research)) -> dict:
    sym = symbol.strip().upper()
    if not TICKER.match(sym):
        raise ApiError(422, "validation_error", "Invalid ticker", symbol)
    try:
        return await r.analyst(sym, quarters)
    except AnalystError as e:
        raise ApiError(e.status, e.code, e.title, e.detail)


@router.get("/congress/trades")
async def congress_trades(member: Optional[str] = Query(None), ticker: Optional[str] = Query(None),
                          type: Optional[Literal["buy", "sell", "exchange"]] = Query(None),
                          date_from: Optional[str] = Query(None, alias="from"),
                          date_to: Optional[str] = Query(None, alias="to"),
                          watchlistOnly: bool = Query(False), limit: int = Query(200, ge=1, le=2000),
                          r: ResearchService = Depends(research)) -> dict:
    for v in (date_from, date_to):
        if v and not DATE.match(v):
            raise ApiError(422, "validation_error", "Invalid date", v)
    try:
        return await r.feed(member, ticker, type, date_from, date_to, watchlistOnly, limit)
    except CongressFailed as e:
        raise ApiError(502, "congress_failed", "The House Clerk site could not be reached", str(e))


@router.post("/congress/refresh")
async def congress_refresh(r: ResearchService = Depends(research)) -> dict:
    r.ensure_poll()
    try:
        return await r.refresh(notify=True)
    except CongressFailed as e:
        raise ApiError(502, "congress_failed", "The House Clerk site could not be reached", str(e))


@router.get("/congress/settings")
def congress_settings(r: ResearchService = Depends(research)) -> dict:
    return r.congress_settings()


@router.patch("/congress/settings")
async def patch_congress_settings(body: CongressSettingsUpdate = Body(...),
                                  r: ResearchService = Depends(research)) -> dict:
    r.ensure_poll()
    return r.update_congress_settings(body.model_dump(exclude_none=True))
