"""/ai/*: optional AI assistant (explain, coach, chat). See ai/service.py.

PUT /ai/key is called by the Tauri shell only. The key is kept in memory and never
logged, persisted or returned; no response or error text contains it.
"""

from __future__ import annotations

import datetime as dt
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from ..ai.keystore import InvalidKey
from ..ai.service import AiError, AiService
from .deps import require_token
from .errors import ApiError

router = APIRouter(dependencies=[Depends(require_token)])

AiModel = Literal["haiku", "sonnet", "opus"]
AiLang = Literal["en", "es"]
StepKey = Literal["scanner", "news", "entry", "exit", "timemachine", "budget", "risk", "ticket"]


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AiKey(_In):
    key: str = Field(min_length=1, max_length=4096, repr=False)

    def __repr__(self) -> str:
        return "AiKey(key=[redacted])"


class AiStatus(BaseModel):
    keyPresent: bool
    enabled: bool
    ready: bool
    reason: Optional[Literal["disabled", "no_key", "cap_reached"]]
    model: AiModel
    modelId: str
    month: str
    monthlyCapUsd: float
    spentThisMonthUsd: float
    remainingUsd: float


class AiSettings(BaseModel):
    enabled: bool
    model: AiModel
    monthlyCapUsd: float


class AiSettingsUpdate(_In):
    enabled: Optional[bool] = None
    model: Optional[AiModel] = None
    monthlyCapUsd: Optional[float] = Field(default=None, ge=0, le=1000)


class AiExplainRequest(_In):
    kind: Literal["pipeline_step", "blocked_ticket", "news_summary", "analyst_quarter"]
    lang: AiLang
    runId: Optional[str] = Field(default=None, max_length=80)
    stepKey: Optional[StepKey] = None
    ticketId: Optional[str] = Field(default=None, max_length=80)
    tickers: Optional[list[str]] = Field(default=None, max_length=50)
    hours: Optional[int] = Field(default=None, ge=1, le=72)
    symbol: Optional[str] = Field(default=None, pattern=r"^[A-Za-z]{1,5}([.\-][A-Za-z]{1,2})?$")
    quarterEnd: Optional[dt.date] = None


class AiCoachRequest(_In):
    from_: dt.date = Field(alias="from")
    to: dt.date
    lang: AiLang
    accountId: Optional[str] = Field(default=None, max_length=80)


class AiChatMessage(_In):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class AiChatRequest(_In):
    messages: list[AiChatMessage] = Field(min_length=1, max_length=40)
    lang: AiLang


class AiUsage(BaseModel):
    inputTokens: int
    outputTokens: int
    costUsd: float


class AiAnswer(BaseModel):
    model_config = ConfigDict(extra="allow")
    text: str
    lang: AiLang
    citations: list[dict[str, Any]]
    usage: AiUsage
    model: str
    disclaimerKey: str


def _ai(request: Request) -> AiService:
    return request.app.state.ai


async def _guarded(svc: AiService, coro: Any) -> dict[str, Any]:
    try:
        return await coro
    except AiError as e:
        raise ApiError(e.status, e.code, e.title, svc.keys.scrub(e.detail) if e.detail else None) from None
    except ApiError:
        raise
    except Exception as e:  # never let an unexpected error carry the key out
        raise ApiError(500, "internal_error", "Internal error", svc.keys.scrub(e)[:400]) from None


@router.put("/ai/key", status_code=204, response_class=Response)
def put_key(body: AiKey, svc: AiService = Depends(_ai)) -> Response:
    try:
        svc.set_key(body.key)
    except InvalidKey:
        raise ApiError(422, "invalid_ai_key", "This does not look like a Claude API key") from None
    return Response(status_code=204)


@router.delete("/ai/key", status_code=204, response_class=Response)
def delete_key(svc: AiService = Depends(_ai)) -> Response:
    svc.clear_key()
    return Response(status_code=204)


@router.get("/ai/status", response_model=AiStatus)
def get_status(svc: AiService = Depends(_ai)) -> dict[str, Any]:
    return svc.status()


@router.get("/ai/settings", response_model=AiSettings)
def get_settings(svc: AiService = Depends(_ai)) -> dict[str, Any]:
    return svc.settings()


@router.patch("/ai/settings", response_model=AiSettings)
def patch_settings(body: AiSettingsUpdate, svc: AiService = Depends(_ai)) -> dict[str, Any]:
    return svc.update_settings(body.model_dump(exclude_none=True))


@router.post("/ai/explain", response_model=AiAnswer)
async def explain(body: AiExplainRequest, svc: AiService = Depends(_ai)) -> dict[str, Any]:
    req = body.model_dump(exclude_none=True, mode="json")
    return await _guarded(svc, svc.explain(req))


@router.post("/ai/coach", response_model=AiAnswer)
async def coach(body: AiCoachRequest, svc: AiService = Depends(_ai)) -> dict[str, Any]:
    req = body.model_dump(exclude_none=True, mode="json", by_alias=True)
    return await _guarded(svc, svc.coach(req))


@router.post("/ai/chat", response_model=AiAnswer)
async def chat(body: AiChatRequest, svc: AiService = Depends(_ai)) -> dict[str, Any]:
    return await _guarded(svc, svc.chat(body.model_dump(mode="json")))


def attach(app: FastAPI, ctx: Any) -> AiService:
    """Create the AI service (it calls the app's own GET routes as tools) and mount /ai/*."""
    svc = AiService(ctx, app)
    app.state.ai = svc
    app.include_router(router)
    return svc
