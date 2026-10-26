"""/paper/*: the paper account (v1.1). Simulated in the engine; never touches the real books or a broker."""

from __future__ import annotations

import datetime as dt
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response

from ..paper.service import PaperError, PaperService
from .deps import require_token
from .errors import ApiError
from .models import dump
from .models_paper import (PaperAccount, PaperAccountCreate, PaperAccountReset, PaperComparison, PaperPosition,
                           PaperSettings, PaperSettingsUpdate, PaperStats, PaperTrade)

router = APIRouter(dependencies=[Depends(require_token)])

Kind = Literal["closed", "skipped", "all"]


def paper(request: Request) -> PaperService:
    return request.app.state.paper


def _call(fn: Any, *args: Any, **kw: Any) -> Any:
    try:
        return fn(*args, **kw)
    except PaperError as e:
        raise ApiError(e.status, e.code, e.title, e.detail)


def _day(v: Optional[dt.date]) -> Optional[str]:
    return v.isoformat() if v else None


@router.get("/paper/accounts", response_model=list[PaperAccount])
def accounts(p: PaperService = Depends(paper)) -> list[dict]:
    return p.accounts()


@router.post("/paper/accounts", response_model=PaperAccount, status_code=201)
def create_account(body: Optional[PaperAccountCreate] = None, p: PaperService = Depends(paper)) -> dict:
    b = body or PaperAccountCreate()
    return p.create_account(b.name, b.starting_balance_usd, b.activate)


@router.post("/paper/accounts/{accountId}/reset", response_model=PaperAccount)
async def reset(accountId: str, body: Optional[PaperAccountReset] = None, p: PaperService = Depends(paper)) -> dict:
    try:
        return await p.reset(accountId, (body or PaperAccountReset()).starting_balance_usd)
    except PaperError as e:
        raise ApiError(e.status, e.code, e.title, e.detail)


@router.post("/paper/accounts/{accountId}/activate", response_model=PaperAccount)
def activate(accountId: str, p: PaperService = Depends(paper)) -> dict:
    return _call(p.activate, accountId)


@router.get("/paper/positions", response_model=list[PaperPosition])
def positions(accountId: Optional[str] = Query(None), p: PaperService = Depends(paper)) -> list[dict]:
    return _call(p.positions, accountId)


@router.get("/paper/trades", response_model=list[PaperTrade])
def trades(accountId: Optional[str] = Query(None), periodId: Optional[str] = Query(None),
           from_: Optional[dt.date] = Query(None, alias="from"), to: Optional[dt.date] = Query(None),
           symbol: Optional[str] = Query(None), kind: Kind = Query("all"),
           limit: int = Query(500, ge=1, le=5000), p: PaperService = Depends(paper)) -> list[dict]:
    return _call(p.trades, accountId, periodId, _day(from_), _day(to), symbol, kind, limit)


@router.get("/paper/trades/export", response_class=Response,
            responses={200: {"content": {"text/csv": {"schema": {"type": "string"}}}}})
def export(accountId: Optional[str] = Query(None), periodId: Optional[str] = Query(None),
           from_: Optional[dt.date] = Query(None, alias="from"), to: Optional[dt.date] = Query(None),
           kind: Kind = Query("all"), p: PaperService = Depends(paper)) -> Response:
    acct, text = _call(p.export_csv, accountId, periodId, _day(from_), _day(to), kind)
    return Response(text, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="levelset-paper-%s.csv"' % acct})


@router.get("/paper/stats", response_model=PaperStats)
def stats(accountId: Optional[str] = Query(None), periodId: Optional[str] = Query(None),
          from_: Optional[dt.date] = Query(None, alias="from"), to: Optional[dt.date] = Query(None),
          groupBy: Optional[Literal["ticker", "setup", "hour", "weekday"]] = Query(None),
          p: PaperService = Depends(paper)) -> dict:
    return _call(p.stats, accountId, periodId, _day(from_), _day(to), groupBy)


@router.get("/paper/compare", response_model=PaperComparison)
def compare(accountId: Optional[str] = Query(None), periodId: Optional[str] = Query(None),
            from_: Optional[dt.date] = Query(None, alias="from"), to: Optional[dt.date] = Query(None),
            p: PaperService = Depends(paper)) -> dict:
    return _call(p.compare, accountId, periodId, _day(from_), _day(to))


@router.get("/paper/settings", response_model=PaperSettings)
def get_settings(p: PaperService = Depends(paper)) -> dict:
    return p.settings()


@router.patch("/paper/settings", response_model=PaperSettings)
def patch_settings(body: PaperSettingsUpdate, p: PaperService = Depends(paper)) -> dict:
    return p.update_settings(dump(body))
