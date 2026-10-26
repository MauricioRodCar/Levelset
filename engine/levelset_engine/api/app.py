"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import contextlib
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .. import __version__
from ..config import EngineConfig
from ..context import EngineContext
from . import errors, routes_alerts, routes_bars, routes_market, routes_pipeline, routes_system, routes_trading
from .deps import build_services
from . import routes_paper
from ..paper import PaperService
from . import routes_bridges
from ..bridges.service import BridgeService
from . import routes_research
from . import routes_ai
from ..services.research import ResearchService

# The Tauri WebView and the Vite dev server call the engine from another origin.
CORS_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
                "http://localhost:1420", "http://localhost:5173", "http://127.0.0.1:1420", "http://127.0.0.1:5173"]


def create_app(config: EngineConfig) -> FastAPI:
    ctx = EngineContext(config)
    svc = build_services(ctx)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        loop_task = None
        if config.start_background and not config.demo:
            loop_task = asyncio.create_task(svc.alerts.loop(config.alert_interval, svc.market))
        if config.start_background:  # bridges: read acks + heartbeats (also in demo; local files only)
            ctx.tasks["bridges.loop"] = asyncio.create_task(app.state.bridges.loop())
        if config.start_background and not config.demo:  # paper: catch-up for today, then the bar loop
            ctx.tasks["paper.loop"] = asyncio.create_task(app.state.paper.background())
        try:
            yield
        finally:
            if loop_task:
                loop_task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await loop_task
            for t in list(ctx.tasks.values()):
                t.cancel()
            ctx.close()

    app = FastAPI(title="Levelset Engine API", version=__version__, lifespan=lifespan,
                  docs_url="/docs" if config.demo else None, redoc_url=None)
    app.state.services = svc
    app.state.paper = PaperService(ctx)
    app.state.paper.pipeline = svc.pipeline
    svc.pipeline.ticket_hooks.append(app.state.paper.on_ticket)
    app.state.bridges = BridgeService(ctx)
    app.state.research = ResearchService(ctx, svc.market, svc.trading)
    app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
    errors.install(app)
    app.include_router(routes_system.public)
    app.include_router(routes_system.router)
    app.include_router(routes_system.events_router)
    app.include_router(routes_market.router)
    app.include_router(routes_bars.router)
    app.include_router(routes_pipeline.router)
    app.include_router(routes_trading.router)
    app.include_router(routes_alerts.router)
    app.include_router(routes_paper.router)
    app.include_router(routes_bridges.router)
    app.include_router(routes_research.router)
    routes_ai.attach(app, ctx)
    return app
