"""Pipeline runs: create, run all in the background, run one step, history."""

from __future__ import annotations

import asyncio
import logging
import traceback
from typing import Any

from ..api.models import STEP_KEYS
from ..clock import iso
from ..context import EngineContext, new_id
from . import params as P
from .steps import HANDLERS, Outcome, StepCtx

log = logging.getLogger("levelset.pipeline")

FINISHED = ("done", "check", "blocked", "error")
READY_BEFORE = ("done", "check")


class PipelineError(Exception):
    def __init__(self, status: int, code: str, title: str, detail: str = "") -> None:
        super().__init__(title)
        self.status, self.code, self.title, self.detail = status, code, title, detail


def aggregate(steps: list[dict[str, Any]], mode: str, running: bool = False) -> str:
    sts = [s["status"] for s in steps]
    if running or "running" in sts:
        return "running"
    if "error" in sts:
        return "error"
    if "blocked" in sts:
        return "blocked"
    if all(s in FINISHED for s in sts):
        return "check" if "check" in sts else "done"
    if mode == "all" and any(s in FINISHED for s in sts):
        return "check"  # a run-all that stopped early (entry still waiting, no hits...)
    return "pending"


class PipelineService:
    def __init__(self, ctx: EngineContext) -> None:
        self.ctx = ctx
        self._busy: set[str] = set()
        self._background: set[str] = set()  # catch-up runs: their steps let user-started runs go first
        self._user_runs = 0
        self._user_idle: asyncio.Event | None = None
        self.ticket_hooks: list[Any] = []  # called with each new ticket (the paper account's auto-follow)
        self.recover()

    # ---------------------------------------------------------------- serialization
    @staticmethod
    def step_json(row: dict[str, Any]) -> dict[str, Any]:
        return {"key": row["key"], "status": row["status"], "params": row.get("params") or {},
                "inputs": row.get("inputs") or {}, "outputs": row.get("outputs") or {},
                "summary": row.get("summary") or {}, "checks": row.get("checks") or [],
                "error": row.get("error"), "startedAt": row.get("started_at"), "endedAt": row.get("ended_at")}

    @staticmethod
    def summary_json(run: dict[str, Any]) -> dict[str, Any]:
        return {"id": run["id"], "ticker": run.get("ticker"), "setup": run["setup"], "mode": run["mode"],
                "status": run["status"], "startedAt": run["started_at"], "endedAt": run.get("ended_at"),
                "ticketId": run.get("ticket_id")}

    def run_json(self, run_id: str) -> dict[str, Any] | None:
        run = self.ctx.db.get_run(run_id)
        if run is None:
            return None
        return dict(self.summary_json(run), steps=[self.step_json(s) for s in self.ctx.db.get_steps(run_id)])

    def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        return [self.summary_json(r) for r in self.ctx.db.list_runs(limit)]

    # ---------------------------------------------------------------- lifecycle
    def recover(self) -> None:
        """Runs left 'running' by a previous engine process are marked as errors."""
        for run in self.ctx.db.list_runs(1000):
            if run["status"] != "running":
                continue
            for s in self.ctx.db.get_steps(run["id"]):
                if s["status"] == "running":
                    s.update(status="error", error="the engine stopped during this step")
                    self.ctx.db.upsert_step(run["id"], s)
            self.ctx.db.update_run(run["id"], status="error", ended_at=iso(self.ctx.clock.now()))

    # ---------------------------------------------------------------- user runs go first
    def _idle_event(self) -> asyncio.Event:
        if self._user_idle is None:
            self._user_idle = asyncio.Event()
            self._user_idle.set()
        return self._user_idle

    def _user_started(self) -> None:
        self._user_runs += 1
        self._idle_event().clear()

    def _user_ended(self) -> None:
        self._user_runs = max(0, self._user_runs - 1)
        if self._user_runs == 0:
            self._idle_event().set()

    def create_run(self, mode: str, ticker: str | None, setup: str, overrides: dict[str, Any] | None,
                   background: bool = False) -> dict[str, Any]:
        """background=True (the paper catch-up): before each step the run waits until no user-started run
        is busy, so the user's own runs never queue behind it for more than the step in progress."""
        run_id = new_id("run")
        now = iso(self.ctx.clock.now())
        run = {"id": run_id, "ticker": ticker.upper() if ticker else None, "setup": setup, "mode": mode,
               "status": "running" if mode == "all" else "pending", "started_at": now, "ended_at": None,
               "ticket_id": None, "params": overrides or {}}
        self.ctx.db.insert_run(run)
        for i, key in enumerate(STEP_KEYS):
            self.ctx.db.upsert_step(run_id, {"key": key, "idx": i, "status": "pending",
                                             "params": P.merged(key, (overrides or {}).get(key))})
        self._publish_run(run_id)
        if background:
            self._background.add(run_id)
        if mode == "all":
            if not background:
                self._user_started()  # counted now, so a catch-up step that is about to start waits
            task = asyncio.get_running_loop().create_task(self._run_all(run_id))
            self.ctx.tasks[run_id] = task
        return self.run_json(run_id) or {}

    async def _run_all(self, run_id: str) -> None:
        self._busy.add(run_id)
        background = run_id in self._background
        try:
            for key in STEP_KEYS:
                if background:
                    await self._idle_event().wait()
                outcome = await self._execute(run_id, key, None)
                if outcome.halt:
                    break
        except Exception:  # noqa: BLE001 - never leave a run spinning
            log.error("run %s crashed:\n%s", run_id, traceback.format_exc())
        finally:
            self._busy.discard(run_id)
            self._background.discard(run_id)
            if not background:
                self._user_ended()
            self._finish(run_id)
            self.ctx.tasks.pop(run_id, None)

    async def run_step(self, run_id: str, key: str, overrides: dict[str, Any] | None) -> dict[str, Any]:
        run = self.ctx.db.get_run(run_id)
        if run is None:
            raise PipelineError(404, "run_not_found", "Run not found", run_id)
        if key not in STEP_KEYS:
            raise PipelineError(404, "step_not_found", "Unknown step", key)
        if run_id in self._busy or run["status"] == "running":
            raise PipelineError(409, "run_busy", "This run is still running")
        steps = {s["key"]: s for s in self.ctx.db.get_steps(run_id)}
        idx = STEP_KEYS.index(key)
        for prev in STEP_KEYS[:idx]:
            st = steps[prev]["status"]
            if st in READY_BEFORE or (key == "ticket" and prev == "risk" and st == "blocked"):
                continue
            raise PipelineError(409, "previous_step_not_done", "Run the previous steps first",
                                "%s is %s" % (prev, st))
        if key != "scanner" and not run.get("ticker"):
            raise PipelineError(409, "no_ticker", "No ticker yet: run the scanner step or give a ticker")
        self._busy.add(run_id)
        self._user_started()
        try:
            # a re-run invalidates everything after it
            for later in STEP_KEYS[idx + 1:]:
                row = steps[later]
                if row["status"] != "pending":
                    self.ctx.db.upsert_step(run_id, {"key": later, "idx": row["idx"], "status": "pending",
                                                     "params": row.get("params") or P.merged(later)})
                    self._publish_step(run_id, later)
            await self._execute(run_id, key, overrides)
        finally:
            self._busy.discard(run_id)
            self._user_ended()
            self._finish(run_id)
        row = next(s for s in self.ctx.db.get_steps(run_id) if s["key"] == key)
        return self.step_json(row)

    # ---------------------------------------------------------------- one step
    async def _execute(self, run_id: str, key: str, overrides: dict[str, Any] | None) -> Outcome:
        db, ctx = self.ctx.db, self.ctx
        run = db.get_run(run_id) or {}
        rows = {s["key"]: s for s in db.get_steps(run_id)}
        row = rows[key]
        params = P.merged(key, run.get("params", {}).get(key), row.get("params"), overrides)
        started = iso(ctx.clock.now())
        row.update(status="running", params=params, started_at=started, ended_at=None, error=None,
                   inputs={}, outputs={}, summary={}, checks=[], files=None)
        db.upsert_step(run_id, row)
        db.update_run(run_id, status="running", ended_at=None)
        self._publish_step(run_id, key)
        self._publish_run(run_id)
        # the files the previous step left, so other runs' files never leak in
        idx = STEP_KEYS.index(key)
        prev_files: dict[str, Any] = {}
        for prev in reversed(STEP_KEYS[:idx]):
            if rows[prev].get("files") is not None:
                prev_files = rows[prev]["files"]
                break
        async with ctx.lock:
            ctx.ws.restore(prev_files)
            sc = StepCtx(ctx, run, params, rows)
            try:
                outcome = await HANDLERS[key](sc)
            except Exception as e:  # noqa: BLE001
                log.error("step %s/%s failed:\n%s", run_id, key, traceback.format_exc())
                outcome = Outcome("error", error="internal error: %s" % e, halt=True,
                                  summary={"code": key + ".internal_error", "outLine": str(e)})
            files = ctx.ws.snapshot()
        row.update(status=outcome.status, inputs=outcome.inputs, outputs=outcome.outputs, summary=outcome.summary,
                   checks=outcome.checks, error=outcome.error, ended_at=iso(ctx.clock.now()), files=files)
        db.upsert_step(run_id, row)
        if outcome.ticker and outcome.ticker != run.get("ticker"):
            db.update_run(run_id, ticker=outcome.ticker)
        if outcome.ticket is not None:
            db.put_ticket(outcome.ticket)
            db.update_run(run_id, ticket_id=outcome.ticket["id"])
            ctx.bus.publish("ticket.created", _public_ticket(outcome.ticket))
            for hook in self.ticket_hooks:
                try:
                    hook(outcome.ticket)
                except Exception:  # noqa: BLE001 - a hook never breaks the run
                    log.error("ticket hook failed:\n%s", traceback.format_exc())
        self._publish_step(run_id, key)
        self._publish_run(run_id)
        return outcome

    def _finish(self, run_id: str) -> None:
        run = self.ctx.db.get_run(run_id)
        if run is None:
            return
        steps = self.ctx.db.get_steps(run_id)
        status = aggregate(steps, run["mode"])
        ended = iso(self.ctx.clock.now()) if status not in ("running", "pending") else None
        self.ctx.db.update_run(run_id, status=status, ended_at=ended)
        self._publish_run(run_id)

    # ---------------------------------------------------------------- events
    def _publish_run(self, run_id: str) -> None:
        run = self.ctx.db.get_run(run_id)
        if run:
            self.ctx.bus.publish("run.updated", self.summary_json(run))

    def _publish_step(self, run_id: str, key: str) -> None:
        row = next((s for s in self.ctx.db.get_steps(run_id) if s["key"] == key), None)
        if row:
            self.ctx.bus.publish("step.updated", {"runId": run_id, "step": self.step_json(row)})


def _public_ticket(t: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in t.items() if not k.startswith("_")}
