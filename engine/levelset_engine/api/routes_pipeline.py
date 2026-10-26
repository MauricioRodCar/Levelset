"""/pipeline/runs and step-by-step execution."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Body, Depends, Query

from ..pipeline.service import PipelineError
from .deps import Services, require_token, services
from .errors import ApiError
from .models import PipelineRun, PipelineRunRequest, PipelineRunSummary, Step, StepRunRequest, dump

router = APIRouter(dependencies=[Depends(require_token)])

StepKeyParam = Literal["scanner", "news", "entry", "exit", "timemachine", "budget", "risk", "ticket"]


@router.get("/pipeline/runs", response_model=list[PipelineRunSummary])
def list_runs(limit: int = Query(50, ge=1, le=500), s: Services = Depends(services)) -> list[dict]:
    return s.pipeline.list_runs(limit)


@router.post("/pipeline/runs", response_model=PipelineRun, status_code=202)
async def start_run(body: PipelineRunRequest, s: Services = Depends(services)) -> dict:
    return s.pipeline.create_run(body.mode, body.ticker, body.setup, body.params)


@router.get("/pipeline/runs/{runId}", response_model=PipelineRun)
def get_run(runId: str, s: Services = Depends(services)) -> dict:
    run = s.pipeline.run_json(runId)
    if run is None:
        raise ApiError(404, "run_not_found", "Run not found", runId)
    return run


@router.post("/pipeline/runs/{runId}/steps/{stepKey}/run", response_model=Step)
async def run_step(runId: str, stepKey: StepKeyParam, body: StepRunRequest | None = Body(default=None),
                   s: Services = Depends(services)) -> dict:
    try:
        return await s.pipeline.run_step(runId, stepKey, (body.params if body else None) or {})
    except PipelineError as e:
        raise ApiError(e.status, e.code, e.title, e.detail)


__all__ = ["router", "dump"]
