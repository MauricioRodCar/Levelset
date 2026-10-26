"""/health, /status, /dashboard, /settings, /events."""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from .. import __version__
from ..adapters.settings_map import config_from_settings
from ..storage import workspace as wsf
from .deps import Services, require_token, require_token_or_query, services
from .models import DashboardSummary, Health, Settings, Status, dump

public = APIRouter()
router = APIRouter(dependencies=[Depends(require_token)])
events_router = APIRouter(dependencies=[Depends(require_token_or_query)])

HEARTBEAT_SECONDS = 15.0


@public.get("/health", response_model=Health)
def health() -> Health:
    return Health(ok=True, version=__version__)


@router.get("/status", response_model=Status)
def status(s: Services = Depends(services)) -> dict:
    return s.market.status()


@router.get("/dashboard", response_model=DashboardSummary)
async def dashboard(request: Request, s: Services = Depends(services)) -> dict:
    d = await s.trading.dashboard()
    d["paperPnlToday"] = request.app.state.paper.pnl_today()  # v1.1; never part of dayPnl
    return d


@router.get("/settings", response_model=Settings)
def get_settings(s: Services = Depends(services)) -> dict:
    return s.market.settings()


@router.put("/settings", response_model=Settings)
async def put_settings(body: Settings, s: Services = Depends(services)) -> dict:
    """Writes the skills' trader/config.json, keeping every key Levelset does not manage.
    data.demoMode is read-only here: demo is chosen when the engine starts (--demo)."""
    async with s.ctx.lock:
        current = s.ctx.ws.read_json(wsf.CONFIG, {}) or {}
        s.ctx.ws.write_json(wsf.CONFIG, config_from_settings(dump(body), current))
    return s.market.settings()


@events_router.get("/events")
async def events(request: Request, s: Services = Depends(services)) -> StreamingResponse:
    bus = s.ctx.bus
    queue = bus.subscribe()

    async def stream() -> AsyncIterator[str]:
        try:
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                yield "event: %s\ndata: %s\n\n" % (event, data)
        finally:
            bus.unsubscribe(queue)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
