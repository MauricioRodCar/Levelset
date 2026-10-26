/**
 * Pipeline simulation for the mock engine: POST /pipeline/runs, run-all progress over the
 * simulated SSE, POST .../steps/{key}/run and GET /bars. Behaves like
 * engine/levelset_engine/pipeline/service.py (409s, re-running a step resets the later ones,
 * a run-all stops at a step that halts and ends with status "check").
 */
import type { Bars, PipelineRun, PipelineRunRequest, Step, StepKey } from '../types';
import { STEP_KEYS } from '../types';
import { db, demoNow, mockConfig, nextId, toEtIso } from './db';
import { mockEmit } from './eventBus';
import { paperFollow } from './paperMock';
import {
  HISTORY_SPECS,
  SESSION_OPEN,
  aggregate,
  buildStep,
  halts,
  mergedParams,
  mockBars,
  pendingStep,
  specFor,
  ticketFor,
  type MockRunSpec,
} from './pipelineScenarios';

/** Spec per run object (a fresh db after resetMockDb() gets fresh specs). */
const specs = new WeakMap<PipelineRun, MockRunSpec>();

function specOf(run: PipelineRun): MockRunSpec {
  let spec = specs.get(run);
  if (!spec) {
    const known = HISTORY_SPECS.find((s) => s.id === run.id);
    spec = known ? structuredClone(known) : specFor(run.id, run.ticker ?? undefined, run.startedAt);
    spec.mode = run.mode;
    specs.set(run, spec);
  }
  return spec;
}

function summaryOf(run: PipelineRun) {
  const { steps: _s, ...rest } = run;
  return rest;
}
const emitRun = (run: PipelineRun) => mockEmit('run.updated', summaryOf(run));
const emitStep = (run: PipelineRun, key: StepKey) =>
  mockEmit('step.updated', { runId: run.id, step: run.steps.find((s) => s.key === key)! });

function setStep(run: PipelineRun, step: Step) {
  run.steps = run.steps.map((s) => (s.key === step.key ? step : s));
}

/** Run one step for real (spec -> engine-shaped Step), with a ticket for the ticket step. */
function execute(run: PipelineRun, key: StepKey): Step {
  const spec = specOf(run);
  let ticketId: string | null = null;
  if (key === 'ticket') {
    ticketId = nextId('tkt');
    // v1.1: auto-follow fills it in the active paper account (or logs it as skipped)
    const ticket = paperFollow(ticketFor(spec, ticketId, toEtIso(demoNow())));
    db.tickets = [ticket, ...db.tickets.filter((x) => x.symbol !== ticket.symbol)];
    run.ticketId = ticketId;
    spec.ticketId = ticketId;
  }
  const built = buildStep(spec, key, ticketId);
  const now = toEtIso(demoNow());
  const step: Step = { ...built, startedAt: now, endedAt: now };
  setStep(run, step);
  return step;
}

function markRunning(run: PipelineRun, key: StepKey) {
  const prev = run.steps.find((s) => s.key === key)!;
  setStep(run, {
    ...pendingStep(key, prev.params),
    status: 'running',
    startedAt: toEtIso(demoNow()),
  });
  run.status = 'running';
  run.endedAt = null;
  emitStep(run, key);
  emitRun(run);
}

function finish(run: PipelineRun) {
  run.status = aggregate(run.steps, run.mode);
  run.endedAt = ['running', 'pending'].includes(run.status) ? null : toEtIso(demoNow());
  emitRun(run);
}

function announceTicket(run: PipelineRun) {
  const t = db.tickets.find((x) => x.id === run.ticketId);
  if (t) mockEmit('ticket.created', t);
}

export function createMockRun(body: PipelineRunRequest): PipelineRun {
  const id = nextId('run');
  const startedAt = toEtIso(demoNow());
  const spec = specFor(id, body.ticker, startedAt);
  spec.mode = body.mode;
  spec.setup = body.setup ?? 'orb';
  const overrides = (body.params ?? {}) as Partial<Record<StepKey, Record<string, unknown>>>;
  spec.params = { ...spec.params };
  for (const key of STEP_KEYS)
    if (overrides[key]) spec.params[key] = { ...spec.params[key], ...overrides[key] };
  const run: PipelineRun = {
    id,
    ticker: spec.ticker,
    setup: spec.setup,
    mode: body.mode,
    status: body.mode === 'all' ? 'running' : 'pending',
    startedAt,
    endedAt: null,
    ticketId: null,
    steps: STEP_KEYS.map((k) => pendingStep(k, mergedParams(k, spec.params?.[k]))),
  };
  specs.set(run, spec);
  db.runs.unshift(run);
  emitRun(run);
  if (body.mode === 'all') simulateRunAll(run);
  return run;
}

function simulateRunAll(run: PipelineRun) {
  let i = 0;
  const tick = () => {
    if (!db.runs.includes(run)) return; // db was reset
    if (i >= STEP_KEYS.length) {
      finish(run);
      announceTicket(run);
      return;
    }
    const key = STEP_KEYS[i];
    markRunning(run, key);
    setTimeout(() => {
      if (!db.runs.includes(run)) return;
      const step = execute(run, key);
      emitStep(run, key);
      emitRun(run);
      i += 1;
      if (halts(step)) {
        finish(run);
        return;
      }
      setTimeout(tick, mockConfig.stepDelayMs / 3);
    }, mockConfig.stepDelayMs);
  };
  setTimeout(tick, mockConfig.stepDelayMs / 3);
}

export type StepRunResult =
  | { ok: true; step: Step }
  | { ok: false; status: number; code: string; title: string; detail?: string };

export async function runMockStep(
  runId: string,
  key: StepKey,
  params: Record<string, unknown> | undefined,
  wait: (ms: number) => Promise<unknown>,
): Promise<StepRunResult> {
  const run = db.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, status: 404, code: 'not_found', title: 'Run not found' };
  const idx = STEP_KEYS.indexOf(key);
  if (idx === -1) return { ok: false, status: 404, code: 'not_found', title: 'Unknown step' };
  if (run.status === 'running')
    return { ok: false, status: 409, code: 'run_busy', title: 'This run is still running' };
  for (const prev of run.steps.slice(0, idx)) {
    const ok =
      prev.status === 'done' ||
      prev.status === 'check' ||
      (key === 'ticket' && prev.key === 'risk' && prev.status === 'blocked');
    if (!ok)
      return {
        ok: false,
        status: 409,
        code: 'previous_step_not_done',
        title: 'Run the previous steps first',
        detail: `${prev.key} is ${prev.status}`,
      };
  }
  const spec = specOf(run);
  // a re-run invalidates everything after it
  for (const later of STEP_KEYS.slice(idx + 1)) {
    const row = run.steps.find((s) => s.key === later)!;
    if (row.status !== 'pending') {
      setStep(run, pendingStep(later, row.params));
      emitStep(run, later);
    }
  }
  if (params && Object.keys(params).length)
    spec.params = { ...spec.params, [key]: { ...spec.params?.[key], ...params } };
  if (key === 'entry')
    spec.entryChecks = (spec.entryChecks ?? 1) + (run.steps[idx].status === 'pending' ? 0 : 1);
  markRunning(run, key);
  await wait(mockConfig.stepDelayMs);
  const step = execute(run, key);
  emitStep(run, key);
  finish(run);
  if (key === 'ticket') announceTicket(run);
  return { ok: true, step: structuredClone(step) };
}

/** GET /bars: the demo bars completed by the demo clock. */
export function mockBarsResponse(symbol: string): Bars | null {
  const all = mockBars(symbol);
  if (!all) return null;
  const now = Math.floor(demoNow().getTime() / 1000);
  const bars = all.filter((b) => b.t + 300 <= now);
  const first = bars.filter((b) => b.t < SESSION_OPEN + 900);
  const complete = first.length === 3;
  return {
    symbol: symbol.toUpperCase(),
    interval: '5m',
    bars,
    rangeHigh: complete ? Math.max(...first.map((b) => b.h)) : null,
    rangeLow: complete ? Math.min(...first.map((b) => b.l)) : null,
  };
}
