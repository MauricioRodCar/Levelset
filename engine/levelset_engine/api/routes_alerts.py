"""/alerts, /alerts/from-plan, /alerts/{id}."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Response
from pydantic import Field

from ..services.alerts import AlertRejected
from ..storage import workspace as wsf
from .deps import Services, require_token, services
from .errors import ApiError
from .models import Alert, AlertCreate, AlertsFromPlan, AlertType, ApiModel, dump

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/alerts", response_model=list[Alert])
def list_alerts(s: Services = Depends(services)) -> list[dict]:
    return s.alerts.list()


@router.post("/alerts", response_model=Alert, status_code=201)
def create_alert(body: AlertCreate, s: Services = Depends(services)) -> dict:
    try:
        return s.alerts.create(dump(body))
    except AlertRejected as e:
        raise ApiError(e.status, e.code, "Alert not created", e.detail)


@router.post("/alerts/from-plan", response_model=list[Alert], status_code=201)
def alerts_from_plan(body: AlertsFromPlan, s: Services = Depends(services)) -> list[dict]:
    steps = s.ctx.db.get_steps(body.run_id)
    if not steps and s.ctx.db.get_run(body.run_id) is None:
        raise ApiError(404, "run_not_found", "Run not found", body.run_id)
    plan = None
    for row in reversed(steps):  # the newest snapshot that holds the plan
        files = row.get("files") or {}
        if files.get(wsf.PLAN):
            plan = files[wsf.PLAN]
            break
    if not plan:
        raise ApiError(409, "no_plan", "This run has no exit plan yet", body.run_id)
    try:
        return s.alerts.from_plan(plan)
    except AlertRejected as e:
        raise ApiError(e.status, e.code, "Alerts not created", e.detail)


class AlertUpdate(ApiModel):
    """PATCH body: any AlertCreate field (null clears it) and/or status "armed" to re-arm."""
    type: Optional[AlertType] = None
    symbol: Optional[str] = Field(default=None, pattern=r"^[A-Za-z]{1,5}([.\-][A-Za-z]{1,2})?$")
    level: Optional[float] = Field(default=None, gt=0)
    pct: Optional[float] = Field(default=None, gt=0)
    time: Optional[str] = Field(default=None, pattern=r"^([01]?\d|2[0-3]):[0-5]\d$")
    note: Optional[str] = None
    status: Optional[Literal["armed"]] = None


_DEFINITION = ("type", "symbol", "level", "pct", "time", "note")


@router.patch("/alerts/{alertId}", response_model=Alert)
def update_alert(alertId: str, body: AlertUpdate, s: Services = Depends(services)) -> dict:
    a = s.ctx.db.get_alert(alertId)
    if a is None:
        raise ApiError(404, "alert_not_found", "Alert not found", alertId)
    changes = {k: getattr(body, k) for k in body.model_fields_set if k in _DEFINITION}
    merged = {k: a.get(k) for k in _DEFINITION}
    merged.update(changes)
    if merged.get("type") is None:
        raise ApiError(422, "invalid_alert", "Alert not updated", "type cannot be cleared")
    try:
        s.alerts.validate(merged)
    except AlertRejected as e:
        raise ApiError(e.status, e.code, "Alert not updated", e.detail)
    for k in _DEFINITION:
        if merged.get(k) is None:
            a.pop(k, None)
        else:
            a[k] = merged[k]
    if a.get("symbol"):
        a["symbol"] = a["symbol"].upper()
    if a["type"] == "flat_by" and not a.get("time"):
        a["time"] = s.ctx.config_doc().get("flat_by") or "15:55"
    if body.status == "armed":
        a.update(status="armed", rungAt=None)
        a.pop("_message", None)
        # a plan alert is pinned to its plan's day; re-armed on a later day it would never ring
        if a.get("_date") and a["_date"] != s.ctx.clock.today_ny():
            a.pop("_date")
    s.ctx.db.put_alert(a)
    return {k: v for k, v in a.items() if not k.startswith("_")}


@router.delete("/alerts/{alertId}", status_code=204)
def delete_alert(alertId: str, s: Services = Depends(services)) -> Response:
    if not s.alerts.delete(alertId):
        raise ApiError(404, "alert_not_found", "Alert not found", alertId)
    return Response(status_code=204)
