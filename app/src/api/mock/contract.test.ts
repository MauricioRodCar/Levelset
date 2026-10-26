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
    ['/paper/accounts', 'PaperAccount', true],
    ['/paper/positions', 'PaperPosition', true],
    ['/paper/trades', 'PaperTrade', true],
    ['/paper/trades?kind=skipped&periodId=all', 'PaperTrade', true],
    ['/paper/stats', 'PaperStats', false],
    ['/paper/stats?groupBy=weekday&periodId=all', 'PaperStats', false],
    ['/paper/stats?groupBy=hour&from=2026-10-01&to=2026-10-19', 'PaperStats', false],
    ['/paper/compare', 'PaperComparison', false],
    ['/paper/settings', 'PaperSettings', false],
    ['/bridges/settings', 'BridgeSettings', false],
    ['/bridges/status', 'BridgeStatus', true],
    ['/bridges/symbol-map', 'SymbolMap', false],
    ['/ai/status', 'AiStatus', false],
    ['/ai/settings', 'AiSettings', false],
    ['/analyst/TSLA', 'AnalystReport', false],
    ['/analyst/aapl?quarters=4', 'AnalystReport', false],
    ['/congress/trades', 'CongressFeed', false],
    [
      '/congress/trades?member=pelosi&type=buy&from=2026-01-01&to=2026-12-31',
      'CongressFeed',
      false,
    ],
    ['/congress/trades?watchlistOnly=true&ticker=NVDA', 'CongressFeed', false],
    ['/congress/settings', 'CongressSettings', false],
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

  it('ai endpoints return contract shapes', async () => {
    const off = await send('POST', '/ai/explain', { kind: 'news_summary', lang: 'en' });
    expect(off.status).toBe(409);
    expect(check('Problem', off.body)).toEqual([]);
    expect(off.body.code).toBe('ai_disabled');

    const on = await send('PATCH', '/ai/settings', {
      enabled: true,
      model: 'haiku',
      monthlyCapUsd: 5,
    });
    expect(check('AiSettings', on.body)).toEqual([]);
    const bad = await send('PATCH', '/ai/settings', { monthlyCapUsd: 5000 });
    expect(bad.status).toBe(422);
    expect((await send('PUT', '/ai/key', { key: 'nope' })).body.code).toBe('invalid_ai_key');
    expect((await send('PUT', '/ai/key', { key: 'sk-ant-api03-abcdefghijklmnop' })).status).toBe(
      204,
    );

    const answers = [
      await send('POST', '/ai/explain', {
        kind: 'pipeline_step',
        lang: 'en',
        runId: fx.TSLA_RUN_ID,
        stepKey: 'exit',
      }),
      await send('POST', '/ai/explain', {
        kind: 'blocked_ticket',
        lang: 'es',
        ticketId: fx.AMD_TICKET_ID,
      }),
      await send('POST', '/ai/explain', { kind: 'news_summary', lang: 'en', hours: 12 }),
      await send('POST', '/ai/explain', { kind: 'analyst_quarter', lang: 'es', symbol: 'TSLA' }),
      await send('POST', '/ai/coach', { lang: 'en', from: '2026-10-01', to: '2026-10-19' }),
      await send('POST', '/ai/chat', {
        lang: 'es',
        messages: [{ role: 'user', content: '¿Cuánto arriesga mi ticket?' }],
      }),
    ];
    for (const a of answers) {
      expect(a.status).toBe(200);
      expect(check('AiAnswer', a.body)).toEqual([]);
      expect(a.body.disclaimerKey).toBe('ai.disclaimer');
    }
    const status = await get('/ai/status');
    expect(check('AiStatus', status.body)).toEqual([]);
    expect(status.body.spentThisMonthUsd).toBeGreaterThan(0);

    const missing = await send('POST', '/ai/explain', {
      kind: 'blocked_ticket',
      lang: 'en',
      ticketId: 'x',
    });
    expect(missing.body.code).toBe('ticket_not_found');
    expect((await send('DELETE', '/ai/key')).status).toBe(204);
    const noKey = await send('POST', '/ai/chat', {
      lang: 'en',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(noKey.body.code).toBe('ai_no_key');
  });

  it('bridge write endpoints return contract shapes', async () => {
    const settings = await send('PATCH', '/bridges/settings', {
      platforms: { mt5: { enabled: true } },
    });
    expect(settings.status).toBe(200);
    expect(check('BridgeSettings', settings.body)).toEqual([]);
    const map = await get('/bridges/symbol-map');
    const saved = await send('PUT', '/bridges/symbol-map', map.body);
    expect(check('SymbolMap', saved.body)).toEqual([]);

    const sent = await send('POST', `/tickets/${fx.TSLA_TICKET_ID}/send-to-bridge`, {});
    expect(sent.status).toBe(200);
    expect(check('BridgeTicketState', sent.body)).toEqual([]);
    const ticket = await get(`/tickets/${fx.TSLA_TICKET_ID}`);
    expect(check('Ticket', ticket.body)).toEqual([]);
    expect(ticket.body.bridge.signalId).toBe(sent.body.signalId);
    const cancelled = await send('POST', `/tickets/${fx.TSLA_TICKET_ID}/cancel-bridge`);
    expect(check('BridgeTicketState', cancelled.body)).toEqual([]);

    const blocked = await send('POST', `/tickets/${fx.AMD_TICKET_ID}/send-to-bridge`, {});
    expect(blocked.status).toBe(409);
    expect(check('Problem', blocked.body)).toEqual([]);
    expect(blocked.body.code).toBe('ticket_not_ready');
    const notSent = await send('POST', `/tickets/${fx.AMD_TICKET_ID}/cancel-bridge`);
    expect(notSent.body.code).toBe('bridge_not_sent');
  });

  it('analyst + congress endpoints return contract shapes', async () => {
    const missing = await get('/analyst/ZZZZ');
    expect(missing.status).toBe(404);
    expect(check('Problem', missing.body)).toEqual([]);
    expect(missing.body.code).toBe('no_sec_filer');

    const refreshed = await send('POST', '/congress/refresh');
    expect(check('CongressRefreshResult', refreshed.body)).toEqual([]);
    const again = await send('POST', '/congress/refresh');
    expect(again.body.newFilings).toBe(0);

    const saved = await send('PATCH', '/congress/settings', { notifyOnWatchlist: false });
    expect(check('CongressSettings', saved.body)).toEqual([]);
    expect(saved.body.notifyOnWatchlist).toBe(false);
  });

  it('paper write endpoints return contract shapes', async () => {
    const created = await send('POST', '/paper/accounts', {
      name: 'Test',
      startingBalanceUsd: 2500,
    });
    expect(created.status).toBe(201);
    expect(check('PaperAccount', created.body)).toEqual([]);
    expect(created.body.active).toBe(true);

    const activated = await send('POST', '/paper/accounts/pacc_1/activate');
    expect(check('PaperAccount', activated.body)).toEqual([]);

    const reset = await send('POST', '/paper/accounts/pacc_1/reset', {});
    expect(check('PaperAccount', reset.body)).toEqual([]);
    expect(reset.body.periods).toHaveLength(3);
    const closed = await get('/paper/trades?periodId=pper_1_2&kind=closed');
    expect(closed.body[0]).toMatchObject({ symbol: 'TSLA', exitReason: 'reset' });
    expect(check('PaperTrade', closed.body, true)).toEqual([]);

    const settings = await send('PATCH', '/paper/settings', { slippagePct: 0.05 });
    expect(check('PaperSettings', settings.body)).toEqual([]);
    expect(settings.body).toMatchObject({ autoFollow: true, slippagePct: 0.05 });

    const bad = await send('PATCH', '/paper/settings', { slippagePct: 9 });
    expect(bad.status).toBe(422);
    expect(check('Problem', bad.body)).toEqual([]);
    const missing = await get('/paper/stats?accountId=nope');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('paper_account_not_found');

    const csv = await fetch(`${base()}/paper/trades/export?periodId=all`);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text.split('\n')[0]).toBe(
      'id,accountId,periodId,kind,symbol,setup,qty,entryAt,entryPrice,exitAt,exitPrice,exitReason,rMultiple,pnl,slippageUsd,skipReason,backfilled,ticketId,runId,createdAt',
    );
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

  it('paper follows the TSLA ticket at the next bar open plus slippage', async () => {
    const [pos] = (await get('/paper/positions')).body;
    // 10:15 bar opened 364.21; buy fill = 364.21 * 1.0002 + 0.01 = 364.29
    expect(pos).toMatchObject({
      symbol: 'TSLA',
      qty: 8,
      avgPrice: 364.29,
      stop: 358.32,
      target: 370.04,
    });
    const ticket = (await get(`/tickets/${fx.TSLA_TICKET_ID}`)).body;
    expect([ticket.entry, ticket.stop, ticket.target, ticket.qty]).toEqual([
      364.18, 358.32, 370.04, 8,
    ]);
    expect(ticket.paper).toMatchObject({ status: 'opened', entryPrice: 364.29 });
    expect((await get(`/tickets/${fx.AMD_TICKET_ID}`)).body.paper).toMatchObject({
      status: 'skipped',
      skipReason: 'blocked',
    });
    expect((await get('/dashboard')).body.paperPnlToday).toBe(-0.88);
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
