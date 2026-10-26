/**
 * Validates every mock engine response against docs/api/openapi.yaml with JSON Schema (Ajv 2020).
 * If this fails, either the mock drifted or the contract changed: fix the mock, never the contract.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { setupMockServer } from '@/test/server';
import { getEngineInfo } from '../engine';
import * as fx from './fixtures';

setupMockServer();

const spec = parse(
  readFileSync(path.resolve(__dirname, '../../../../docs/api/openapi.yaml'), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'openapi', components: spec.components });

function check(schemaRef: string, data: unknown, array = false) {
  const ref = { $ref: `openapi#/components/schemas/${schemaRef}` };
  const validate = ajv.compile(array ? { type: 'array', items: ref } : ref);
  const ok = validate(data);
  return ok ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

const base = () => getEngineInfo().url;
const get = async (p: string) => {
  const r = await fetch(`${base()}${p}`, { headers: { Authorization: 'Bearer dev' } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const send = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(`${base()}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

describe('mock engine matches openapi.yaml', () => {
  it.each([
    ['/status', 'Status', false],
    ['/dashboard', 'DashboardSummary', false],
    ['/settings', 'Settings', false],
    ['/watchlist', 'WatchItem', true],
    ['/news?tickers=TSLA,NVDA,AAPL,AMD', 'NewsItem', true],
    ['/pipeline/runs', 'PipelineRunSummary', true],
    [`/pipeline/runs/${fx.TSLA_RUN_ID}`, 'PipelineRun', false],
    [`/pipeline/runs/${fx.AMD_RUN_ID}`, 'PipelineRun', false],
    ['/tickets', 'Ticket', true],
    [`/tickets/${fx.TSLA_TICKET_ID}`, 'Ticket', false],
    ['/trades', 'OpenTrade', true],
    ['/fills', 'Fill', true],
    ['/alerts', 'Alert', true],
  ] as const)('GET %s -> %s', async (p, schema, isArray) => {
    const { status, body } = await get(p);
    expect(status).toBe(200);
    expect(check(schema, body, isArray)).toEqual([]);
  });

  it('every fixture run passes the PipelineRun schema', () => {
    for (const run of fx.runs) expect(check('PipelineRun', run)).toEqual([]);
  });

  it('write endpoints return contract shapes', async () => {
    const settings = await send('PUT', '/settings', fx.settings);
    expect(check('Settings', settings.body)).toEqual([]);

    const scan = await send('POST', '/scanner/run', { kind: 'orb' });
    expect(check('ScanResult', scan.body)).toEqual([]);

    const run = await send('POST', '/pipeline/runs', { mode: 'step', ticker: 'TSLA' });
    expect(run.status).toBe(202);
    expect(check('PipelineRun', run.body)).toEqual([]);

    const step = await send('POST', `/pipeline/runs/${run.body.id}/steps/scanner/run`, {
      params: {},
    });
    expect(check('Step', step.body)).toEqual([]);

    const fill = await send('POST', '/fills', {
      symbol: 'TSLA',
      side: 'buy',
      qty: 8,
      price: 364.18,
    });
    expect(fill.status).toBe(201);
    expect(check('Fill', fill.body)).toEqual([]);

    const alert = await send('POST', '/alerts', { type: 'above', symbol: 'NVDA', level: 187 });
    expect(alert.status).toBe(201);
    expect(check('Alert', alert.body)).toEqual([]);

    const fromPlan = await send('POST', '/alerts/from-plan', { runId: fx.TSLA_RUN_ID });
    expect(check('Alert', fromPlan.body, true)).toEqual([]);

    const patched = await send('PATCH', `/alerts/${alert.body.id}`, {
      level: 188,
      status: 'armed',
    });
    expect(patched.status).toBe(200);
    expect(check('Alert', patched.body)).toEqual([]);

    const del = await send('DELETE', `/alerts/${alert.body.id}`);
    expect(del.status).toBe(204);

    const delFill = await send('DELETE', `/fills/${fill.body.id}`);
    expect(delFill.status).toBe(204);
    const noFill = await send('DELETE', `/fills/${fill.body.id}`);
    expect(check('Problem', noFill.body)).toEqual([]);
    expect(noFill.body.code).toBe('fill_not_found');
  });

  it('errors use the Problem shape', async () => {
    const r = await get('/pipeline/runs/nope');
    expect(r.status).toBe(404);
    expect(check('Problem', r.body)).toEqual([]);
    expect(r.body.code).toBe('not_found');

    const run = await send('POST', '/pipeline/runs', { mode: 'step' });
    const conflict = await send('POST', `/pipeline/runs/${run.body.id}/steps/risk/run`, {});
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('previous_step_not_done');
  });
});

describe('demo numbers (TSLA 2026-10-19 example)', () => {
  it('reproduces the published levels', () => {
    const t = fx.tslaTicket;
    expect([t.entry, t.stop, t.target, t.qty, t.maxLoss]).toEqual([
      364.18, 358.32, 370.04, 8, 46.88,
    ]);
    expect(t.timeMachine).toMatchObject({
      targetFirstPct: 29.4,
      stopFirstPct: 25.5,
      openAtClosePct: 45.1,
      verdict: 'coin_flip',
      historyFired: 33,
      historyWon: 13,
      historyLost: 15,
    });
    const exit = fx.tslaRun.steps.find((s) => s.key === 'exit')!;
    expect(exit.outputs).toMatchObject({ stop: 358.32, target: 370.04 });
    const entry = fx.tslaRun.steps.find((s) => s.key === 'entry')!;
    expect(entry.inputs).toMatchObject({ openingRange: { high: 362.18, low: 354.47 } });
    const risk = fx.tslaRun.steps.find((s) => s.key === 'risk')!;
    expect(risk.outputs).toMatchObject({ verdict: 'PASS' });
    expect(fx.tslaRun.steps).toHaveLength(8);
  });

  it('blocks AMD on the daily limit', () => {
    expect(fx.amdTicket).toMatchObject({
      symbol: 'AMD',
      side: 'buy',
      qty: 12,
      status: 'blocked',
      riskReasons: ['daily_limit'],
    });
    expect(fx.amdRun.status).toBe('blocked');
  });

  it('exports the ticket as text', async () => {
    const r = await fetch(`${base()}/tickets/${fx.TSLA_TICKET_ID}/export?format=text`);
    const text = await r.text();
    expect(text).toContain('Stop loss 358.32');
    expect(text).toContain('Take profit 370.04');
  });
});
