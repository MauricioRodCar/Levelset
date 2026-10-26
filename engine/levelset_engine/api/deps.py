"""Shared request dependencies: the service container and bearer auth."""

from __future__ import annotations

import hmac
from dataclasses import dataclass

from fastapi import Request

from ..context import EngineContext
from ..pipeline.service import PipelineService
from ..services.alerts import AlertService
from ..services.market import MarketService
from ..services.trading import TradingService
from .errors import ApiError


@dataclass
class Services:
    ctx: EngineContext
    market: MarketService
    trading: TradingService
    alerts: AlertService
    pipeline: PipelineService


def build_services(ctx: EngineContext) -> Services:
    market = MarketService(ctx)
    return Services(ctx=ctx, market=market, trading=TradingService(ctx, market), alerts=AlertService(ctx),
                    pipeline=PipelineService(ctx))


def services(request: Request) -> Services:
    return request.app.state.services


def _token_ok(given: str | None, expected: str) -> bool:
    return bool(given) and hmac.compare_digest(str(given), expected)


def require_token(request: Request) -> None:
    expected = request.app.state.services.ctx.config.token
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() == "bearer" and _token_ok(value.strip(), expected):
        return
    raise ApiError(401, "unauthorized", "Missing or invalid bearer token")


def require_token_or_query(request: Request) -> None:
    """/events: EventSource cannot set headers, so ?token= is accepted too."""
    expected = request.app.state.services.ctx.config.token
    if _token_ok(request.query_params.get("token"), expected):
        return
    require_token(request)
