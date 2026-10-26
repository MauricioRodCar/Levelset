"""/watchlist, /scanner/run, /news."""

from __future__ import annotations

import re

from fastapi import APIRouter, Body, Depends, Query

from ..services.market import NewsFailed, ScanFailed
from .deps import Services, require_token, services
from .errors import ApiError
from .models import NewsItem, ScanRequest, ScanResult, WatchItem

router = APIRouter(dependencies=[Depends(require_token)])
TICKER = re.compile(r"^[A-Z]{1,5}([.\-][A-Z]{1,2})?$")


@router.get("/watchlist", response_model=list[WatchItem])
def watchlist(s: Services = Depends(services)) -> list[dict]:
    return s.market.watchlist()


@router.post("/scanner/run", response_model=ScanResult)
async def scanner_run(body: ScanRequest | None = Body(default=None), s: Services = Depends(services)) -> dict:
    req = body or ScanRequest()
    tickers = [t.strip().upper() for t in (req.tickers or []) if t.strip()]
    bad = [t for t in tickers if not TICKER.match(t)]
    if bad:
        raise ApiError(422, "invalid_ticker", "Invalid ticker", ", ".join(bad))
    try:
        return await s.market.scan(req.kind, req.at, tickers or None)
    except ScanFailed as e:
        raise ApiError(502, "scan_failed", "The scanner could not run", str(e))


@router.get("/news", response_model=list[NewsItem])
async def news(tickers: str = Query(...), hours: int = Query(12, ge=1, le=24 * 30),
               s: Services = Depends(services)) -> list[dict]:
    syms = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not syms or any(not TICKER.match(t) for t in syms):
        raise ApiError(422, "invalid_ticker", "Invalid tickers", tickers)
    try:
        return await s.market.news(syms, hours)
    except NewsFailed as e:
        raise ApiError(502, "news_failed", "News could not be fetched", str(e))
