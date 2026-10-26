/**
 * The mock pipeline (pipelineScenarios / pipelineSim) mirrors the real engine: contract shapes,
 * the TSLA numbers, the early stop and the step-mode rules.
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
import { NVDA_WAIT_RUN_ID, historyRuns } from './pipelineScenarios';

setupMockServer();

const spec = parse(
  readFileSync(path.resolve(__dirname, '../../../../docs/api/openapi.yaml'), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'openapi', components: spec.components });
const check = (name: string, data: unknown) => {
  const v = ajv.compile({ $ref: `openapi#/components/schemas/${name}` });
  return v(data) ? [] : (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
};
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(`${getEngineInfo().url}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const byKey = (run: { steps: { key: string }[] }, key: string) =>
  run.steps.find((s) => s.key === key) as unknown as {
    status: string;
    checks: string[];
    summary: { code: string; values: Record<string, unknown> };
    outputs: Record<string, unknown>;
  };

describe('mock pipeline scenarios', () => {
  it('history runs pass the contract and keep the README numbers', () => {
    const runs = historyRuns();
    for (const run of runs) expect(check('PipelineRun', run)).toEqual([]);
    const tsla = runs.find((r) => r.id === fx.TSLA_RUN_ID)!;
    expect(tsla.status).toBe('check');
    expect(tsla.steps.map((s) => s.status)).toEqual([
      'done',
      'check',
      'done',
      'done',
      'check',
      'done',
      'done',
      'done',
    ]);
    expect(byKey(tsla, 'exit').outputs).toMatchObject({ stop: 358.32, target: 370.04 });
    expect(byKey(tsla, 'timemachine').summary.values).toMatchObject({
      targetFirstPct: 29.4,
      stopFirstPct: 25.5,
      openAtClosePct: 45.1,
      verdict: 'coin_flip',
    });
    expect(byKey(tsla, 'timemachine').checks).toEqual(['coin_flip', 'many_open_at_close']);
    expect(byKey(tsla, 'budget').summary.values).toMatchObject({ qty: 8, maxLoss: 46.88 });
    const amd = runs.find((r) => r.id === fx.AMD_RUN_ID)!;
    expect(amd.status).toBe('blocked');
    expect(byKey(amd, 'risk').checks).toEqual(['daily_limit']);
    const nvda = runs.find((r) => r.id === NVDA_WAIT_RUN_ID)!;
    expect(nvda.status).toBe('check');
    expect(byKey(nvda, 'entry').checks).toEqual(['entry_waiting']);
    expect(nvda.steps.slice(3).every((s) => s.status === 'pending')).toBe(true);
  });

  it('GET /bars returns the TSLA bars closed by 10:15 with the opening range', async () => {
    const r = await call('GET', '/bars?symbol=TSLA&interval=5m&range=1d');
    expect(r.status).toBe(200);
    expect(check('Bars', r.body)).toEqual([]);
    expect(r.body.bars.length).toBeGreaterThanOrEqual(9);
    expect([r.body.rangeHigh, r.body.rangeLow]).toEqual([362.18, 354.47]);
    expect((await call('GET', '/bars?symbol=ZZZZ')).status).toBe(404);
  });

  it('step mode: 409 before the previous step, re-run resets the later steps', async () => {
    const run = (await call('POST', '/pipeline/runs', { mode: 'step', ticker: 'TSLA' })).body;
    const early = await call('POST', `/pipeline/runs/${run.id}/steps/entry/run`, {});
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({
      code: 'previous_step_not_done',
      detail: 'scanner is pending',
    });
    for (const key of ['scanner', 'news', 'entry', 'exit']) {
      const r = await call('POST', `/pipeline/runs/${run.id}/steps/${key}/run`, { params: {} });
      expect(r.status).toBe(200);
      expect(check('Step', r.body)).toEqual([]);
    }
    const exit2 = await call('POST', `/pipeline/runs/${run.id}/steps/exit/run`, {
      params: { stop: 'or-low', target: '2R' },
    });
    expect(exit2.body.outputs).toMatchObject({ stop: 354.47, target_r: 2, stop_rule: 'or_low' });
    const news = await call('POST', `/pipeline/runs/${run.id}/steps/news/run`, {});
    expect(news.status).toBe(200);
    const after = (await call('GET', `/pipeline/runs/${run.id}`)).body;
    expect(after.steps.slice(2).every((s: { status: string }) => s.status === 'pending')).toBe(
      true,
    );
  });

  it('the NVDA early stop triggers on the third check', async () => {
    const id = NVDA_WAIT_RUN_ID;
    const c2 = await call('POST', `/pipeline/runs/${id}/steps/entry/run`, {});
    expect(c2.body.checks).toEqual(['entry_waiting']);
    const c3 = await call('POST', `/pipeline/runs/${id}/steps/entry/run`, {});
    expect(c3.body.status).toBe('done');
    expect(c3.body.summary.code).toBe('entry.triggered');
  });
});
