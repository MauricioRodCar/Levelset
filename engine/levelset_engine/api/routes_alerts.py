"""/alerts, /alerts/from-plan, /alerts/{id}."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from ..services.alerts import AlertRejected
from ..storage import workspace as wsf
from .deps import Services, require_token, services
from .errors import ApiError
from .models import Alert, AlertCreate, AlertsFromPlan, dump

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


@router.delete("/alerts/{alertId}", status_code=204)
def delete_alert(alertId: str, s: Services = Depends(services)) -> Response:
    if not s.alerts.delete(alertId):
        raise ApiError(404, "alert_not_found", "Alert not found", alertId)
    return Response(status_code=204)
