"""/bridges/* and /tickets/{id}/send-to-bridge | cancel-bridge (v1.1, platform bridges).

The engine only writes signal files; the cBot / EA shows a panel and the user clicks
Place inside the platform. Nothing here places, modifies or closes an order.
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Body, Depends, Request
from pydantic import Field

from ..bridges.service import BridgeError, BridgeService
from .deps import require_token
from .errors import ApiError
from .models import ApiModel, BridgePlatform, BridgeTicketState, dump

router = APIRouter(dependencies=[Depends(require_token)])


class BridgePlatformSettings(ApiModel):
    enabled: bool = False


class BridgePlatformsSettings(ApiModel):
    ctrader: BridgePlatformSettings
    mt4: BridgePlatformSettings
    mt5: BridgePlatformSettings


class BridgeSettings(ApiModel):
    signals_folder: str
    platforms: BridgePlatformsSettings


class BridgePlatformsUpdate(ApiModel):
    ctrader: Optional[BridgePlatformSettings] = None
    mt4: Optional[BridgePlatformSettings] = None
    mt5: Optional[BridgePlatformSettings] = None


class BridgeSettingsUpdate(ApiModel):
    signals_folder: Optional[str] = None
    platforms: Optional[BridgePlatformsUpdate] = None


class BridgeStatus(ApiModel):
    NULLABLE = frozenset({"lastHeartbeatAt", "bridgeVersion", "platformVersion", "accountIsDemo", "error"})
    platform: BridgePlatform
    enabled: bool
    state: Literal["not_installed", "offline", "online", "error"]
    folder: str
    last_heartbeat_at: Optional[str] = None
    bridge_version: Optional[str] = None
    platform_version: Optional[str] = None
    account_is_demo: Optional[bool] = None
    missing_symbols: list[str] = Field(default_factory=list)
    error: Optional[str] = None


class SymbolMapRow(ApiModel):
    platform: BridgePlatform
    us_symbol: str = Field(min_length=1, max_length=16)
    broker_symbol: str = Field(min_length=1, max_length=64)
    volume_per_share: float = Field(gt=0)
    min_volume: float = Field(gt=0)
    volume_step: float = Field(gt=0)


class SymbolMap(ApiModel):
    rows: list[SymbolMapRow]


class BridgeSendRequest(ApiModel):
    platforms: Optional[list[BridgePlatform]] = Field(default=None, min_length=1)


def bridges(request: Request) -> BridgeService:
    return request.app.state.bridges


def _err(e: BridgeError) -> ApiError:
    titles = {"ticket_not_found": "Ticket not found", "bridge_not_sent": "Ticket not sent",
              "validation_error": "Invalid request"}
    return ApiError(e.status, e.code, titles.get(e.code, "Not sent to the platform"), e.detail)


@router.get("/bridges/settings", response_model=BridgeSettings)
def get_settings(b: BridgeService = Depends(bridges)) -> dict:
    return b.settings()


@router.patch("/bridges/settings", response_model=BridgeSettings)
def patch_settings(body: BridgeSettingsUpdate, b: BridgeService = Depends(bridges)) -> dict:
    try:
        return b.update_settings(dump(body))
    except BridgeError as e:
        raise _err(e)


@router.get("/bridges/status", response_model=list[BridgeStatus])
def get_status(b: BridgeService = Depends(bridges)) -> list[dict]:
    return b.status()


@router.get("/bridges/symbol-map", response_model=SymbolMap)
def get_symbol_map(b: BridgeService = Depends(bridges)) -> dict:
    return b.symbol_map()


@router.put("/bridges/symbol-map", response_model=SymbolMap)
def put_symbol_map(body: SymbolMap, b: BridgeService = Depends(bridges)) -> dict:
    try:
        return b.put_symbol_map(dump(body)["rows"])
    except BridgeError as e:
        raise _err(e)


@router.post("/tickets/{ticketId}/send-to-bridge", response_model=BridgeTicketState)
def send_to_bridge(ticketId: str, body: Optional[BridgeSendRequest] = Body(default=None),
                   b: BridgeService = Depends(bridges)) -> dict:
    try:
        return b.send(ticketId, (body.platforms if body else None) or None)
    except BridgeError as e:
        raise _err(e)


@router.post("/tickets/{ticketId}/cancel-bridge", response_model=BridgeTicketState)
def cancel_bridge(ticketId: str, b: BridgeService = Depends(bridges)) -> dict:
    try:
        return b.cancel(ticketId)
    except BridgeError as e:
        raise _err(e)
