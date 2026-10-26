/**
 * MSW request handlers implementing docs/api/openapi.yaml against the in-memory demo db.
 * Paths are prefixed with the configured engine URL (VITE_ENGINE_URL, default http://127.0.0.1:8765).
 */
import { delay, http, HttpResponse, type JsonBodyType } from 'msw';
import type {
  Alert,
  AlertCreate,
  AlertUpdate,
  FillCreate,
  PipelineRun,
  PipelineRunRequest,
  ScanRequest,
  Settings,
  Status,
  StepKey,
  Ticket,
  TicketExportFormat,
} from '../types';
import { getEngineInfo } from '../engine';
import { db, demoNow, mockConfig, nextId, toEtIso } from './db';
import * as fx from './fixtures';
import { makePaperHandlers, paperPnlToday } from './paperMock';
import { makeResearchHandlers } from './researchMock';
import { makeBridgeHandlers } from './bridgeMock';
import { makeAiHandlers } from './aiMock';
import { createMockRun, mockBarsResponse, runMockStep } from './pipelineSim';

/** Engine base URL (static in mock mode). Not a bare wildcard, so SPA routes like /settings are never intercepted. */
const P = getEngineInfo().url;

async function latency() {
  if (mockConfig.latencyMs > 0) await delay(mockConfig.latencyMs);
}

function problem(status: number, code: string, title: string, detail?: string) {
  return HttpResponse.json(
    { title, detail, code },
    {
      status,
      headers: { 'Content-Type': 'application/problem+json' },
    },
  );
}

function json<T extends JsonBodyType>(data: T, status = 200) {
  return HttpResponse.json(data, { status });
}

export function currentStatus(): Status {
  return { ...fx.status, nowEt: toEtIso(demoNow()) };
}

// ---------------------------------------------------------------- pipeline simulation

function summaryOf(run: PipelineRun) {
  const { steps: _s, ...rest } = run;
  return rest;
}

// ---------------------------------------------------------------- exports

function exportTicket(t: Ticket, format: TicketExportFormat): string {
  const f = (n: number) => n.toFixed(2);
  const side = t.side.toUpperCase();
  switch (format) {
    case 'csv':
      return [
        'symbol,side,qty,order_type,entry,stop_loss,take_profit,max_loss,flat_by',
        [
          t.symbol,
          t.side,
          t.qty,
          t.orderType,
          f(t.entry),
          f(t.stop),
          f(t.target),
          f(t.maxLoss),
          t.flatBy ?? '',
        ].join(','),
      ].join('\n');
    case 'json':
      return JSON.stringify(
        {
          symbol: t.symbol,
          side: t.side,
          qty: t.qty,
          orderType: t.orderType,
          entry: t.entry,
          stopLoss: t.stop,
          takeProfit: t.target,
          maxLoss: t.maxLoss,
          flatBy: t.flatBy,
        },
        null,
        2,
      );
    case 'ctrader':
    case 'mt4':
    case 'mt5': {
      const platform = { ctrader: 'cTrader', mt4: 'MetaTrader 4', mt5: 'MetaTrader 5' }[format];
      return [
        `${platform} - ${side} ${t.symbol}`,
        `Symbol: ${t.symbol} (check your broker's CFD symbol and contract size)`,
        `Volume: ${t.qty} shares`,
        `Order: ${t.orderType === 'market' ? 'Market' : 'Limit'} ${t.orderType === 'limit' ? f(t.entry) : ''}`.trim(),
        `Stop loss: ${f(t.stop)}`,
        `Take profit: ${f(t.target)}`,
        `Close by: ${t.flatBy ?? '15:55'} ET`,
      ].join('\n');
    }
    case 'text':
    default:
      return [
        `${side} ${t.qty} ${t.symbol} @ ${t.orderType} (${t.timeInForce ?? 'day'})`,
        `Entry ${f(t.entry)}`,
        `Stop loss ${f(t.stop)}`,
        `Take profit ${f(t.target)}`,
        `Max loss $${f(t.maxLoss)} · ${f(t.rMultiple)}R · flat by ${t.flatBy ?? '15:55'} ET`,
      ].join('\n');
  }
}

// ---------------------------------------------------------------- alerts validation (engine rules)

const ALERT_TYPES: AlertCreate['type'][] = [
  'above',
  'below',
  'stop',
  'target',
  'pct_move',
  'time',
  'open_bell',
  'flat_by',
];

/** Same checks as the engine's AlertService.validate; returns the detail of an invalid_alert or null. */
function alertInvalid(a: Partial<AlertCreate>): string | null {
  if (!a.type || !ALERT_TYPES.includes(a.type)) return 'unknown alert type';
  if (['above', 'below', 'stop', 'target'].includes(a.type) && (!a.symbol || !(a.level! > 0)))
    return `an alert of type ${a.type} needs a symbol and a level`;
  if (a.type === 'pct_move' && (!a.symbol || !(a.pct! > 0)))
    return 'a pct_move alert needs a symbol and a pct';
  if (a.type === 'time' && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(a.time ?? ''))
    return 'a time alert needs a time (HH:MM, New York)';
  return null;
}

// ---------------------------------------------------------------- handlers

export const handlers = [
  http.get(`${P}/health`, async () => {
    await latency();
    return json({ ok: true, version: fx.ENGINE_VERSION });
  }),

  http.get(`${P}/status`, async () => {
    await latency();
    return json(currentStatus());
  }),

  http.get(`${P}/dashboard`, async () => {
    await latency();
    return json({
      ...db.dashboard,
      dailyLossLimit: db.settings.limits.maxDailyLossUsd ?? db.dashboard.dailyLossLimit,
      maxTradesPerDay: db.settings.limits.maxTradesPerDay ?? db.dashboard.maxTradesPerDay,
      paperPnlToday: paperPnlToday(),
    });
  }),

  http.get(`${P}/settings`, async () => {
    await latency();
    return json(db.settings);
  }),

  http.put(`${P}/settings`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as Settings;
    if (!body?.account || !body.limits || !body.data) {
      return problem(
        422,
        'validation_error',
        'Invalid settings',
        'account, limits and data are required',
      );
    }
    if (!(body.account.accountSizeUsd >= 0)) {
      return problem(
        422,
        'validation_error',
        'Invalid account size',
        'accountSizeUsd must be >= 0',
      );
    }
    const l = body.limits;
    if (
      l.maxLossPerTradeUsd != null &&
      l.maxDailyLossUsd != null &&
      l.maxLossPerTradeUsd > l.maxDailyLossUsd
    ) {
      return problem(422, 'validation_error', 'Max loss per trade is above the daily limit');
    }
    // data.demoMode is readOnly (chosen at engine start): ignore it on PUT.
    db.settings = { ...body, data: { ...body.data, demoMode: db.settings.data.demoMode } };
    return json(db.settings);
  }),

  http.get(`${P}/watchlist`, async () => {
    await latency();
    return json(db.watchlist);
  }),

  http.post(`${P}/scanner/run`, async ({ request }) => {
    await latency();
    await delay(mockConfig.stepDelayMs);
    let body: ScanRequest = {};
    try {
      body = ((await request.json()) as ScanRequest) ?? {};
    } catch {
      /* empty body allowed */
    }
    const hits = body.tickers?.length
      ? fx.scanHits.filter((h) => body.tickers!.includes(h.symbol))
      : fx.scanHits;
    db.dashboard.lastScanAt = toEtIso(demoNow());
    db.dashboard.setupsFound = hits.length;
    return json({ kind: body.kind ?? 'orb', scanned: 5873, hits, at: toEtIso(demoNow()) });
  }),

  http.get(`${P}/news`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const tickers = (url.searchParams.get('tickers') ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!tickers.length) return problem(422, 'validation_error', 'tickers is required');
    const items = db.news
      .filter((n) => tickers.includes(n.symbol))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return json(items);
  }),

  http.get(`${P}/pipeline/runs`, async ({ request }) => {
    await latency();
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50);
    const list = [...db.runs]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
      .map(summaryOf);
    return json(list);
  }),

  http.post(`${P}/pipeline/runs`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as PipelineRunRequest;
    if (body?.mode !== 'all' && body?.mode !== 'step') {
      return problem(422, 'validation_error', 'mode must be all or step');
    }
    const run = createMockRun(body);
    return json(structuredClone(run), 202);
  }),

  http.get(`${P}/pipeline/runs/:runId`, async ({ params }) => {
    await latency();
    const run = db.runs.find((r) => r.id === params.runId);
    if (!run) return problem(404, 'not_found', 'Run not found');
    return json(structuredClone(run));
  }),

  http.post(`${P}/pipeline/runs/:runId/steps/:stepKey/run`, async ({ params, request }) => {
    await latency();
    let body: { params?: Record<string, unknown> } = {};
    try {
      body = ((await request.json()) as typeof body) ?? {};
    } catch {
      /* empty body allowed */
    }
    const r = await runMockStep(
      String(params.runId),
      params.stepKey as StepKey,
      body.params,
      delay,
    );
    if (!r.ok) return problem(r.status, r.code, r.title, r.detail);
    return json(r.step);
  }),

  http.get(`${P}/bars`, async ({ request }) => {
    await latency();
    const symbol = (new URL(request.url).searchParams.get('symbol') ?? '').trim();
    if (!/^[A-Za-z]{1,5}([.-][A-Za-z]{1,2})?$/.test(symbol))
      return problem(422, 'invalid_ticker', 'Invalid ticker', symbol);
    const bars = mockBarsResponse(symbol);
    if (!bars || !bars.bars.length)
      return problem(404, 'not_found', 'No demo bars for this symbol');
    return json(bars);
  }),

  http.get(`${P}/tickets`, async ({ request }) => {
    await latency();
    const status = new URL(request.url).searchParams.get('status') ?? 'all';
    const list = status === 'all' ? db.tickets : db.tickets.filter((t) => t.status === status);
    return json(list);
  }),

  http.get(`${P}/tickets/:ticketId/export`, async ({ params, request }) => {
    await latency();
    const t = db.tickets.find((x) => x.id === params.ticketId);
    if (!t) return problem(404, 'not_found', 'Ticket not found');
    const format = (new URL(request.url).searchParams.get('format') ??
      'text') as TicketExportFormat;
    return HttpResponse.text(exportTicket(t, format));
  }),

  http.get(`${P}/tickets/:ticketId`, async ({ params }) => {
    await latency();
    const t = db.tickets.find((x) => x.id === params.ticketId);
    if (!t) return problem(404, 'not_found', 'Ticket not found');
    return json(t);
  }),

  http.get(`${P}/trades`, async () => {
    await latency();
    return json(db.trades);
  }),

  http.get(`${P}/fills`, async () => {
    await latency();
    return json(db.fills);
  }),

  http.post(`${P}/fills`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as FillCreate;
    if (!body?.symbol || !(body.qty >= 1) || !(body.price > 0)) {
      return problem(422, 'validation_error', 'Invalid fill');
    }
    if (body.side === 'sell') {
      const held = db.trades.filter((x) => x.symbol === body.symbol).reduce((n, x) => n + x.qty, 0);
      if (body.qty > held)
        return problem(422, 'insufficient_position', 'Not enough shares to sell');
    }
    const fill = {
      ...body,
      id: nextId('fill'),
      at: body.at ?? toEtIso(demoNow()),
      realizedPnl: null,
    };
    db.fills.push(fill);
    if (body.side === 'buy') {
      const t = db.tickets.find((x) => x.id === body.ticketId);
      db.trades.push({
        symbol: body.symbol,
        qty: body.qty,
        avgPrice: body.price,
        lastPrice: body.price,
        unrealizedPnl: 0,
        stop: t?.stop ?? null,
        target: t?.target ?? null,
        flatBy: t?.flatBy ?? db.settings.limits.flatBy ?? null,
        ticketId: body.ticketId ?? null,
      });
      db.dashboard.tradesToday += 1;
      if (t) db.dashboard.riskUsed = Math.round((db.dashboard.riskUsed + t.maxLoss) * 100) / 100;
    } else {
      db.trades = db.trades.filter((x) => x.symbol !== body.symbol);
    }
    return json(fill, 201);
  }),

  http.delete(`${P}/fills/:fillId`, async ({ params }) => {
    await latency();
    const i = db.fills.findIndex((f) => f.id === params.fillId);
    if (i === -1) return problem(404, 'fill_not_found', 'Fill not found');
    const fill = db.fills[i];
    if (
      fill.side === 'buy' &&
      db.fills.slice(i + 1).some((f) => f.side === 'sell' && f.symbol === fill.symbol)
    ) {
      return problem(409, 'fill_in_use', 'Fill not deleted', 'a later sell needs these shares');
    }
    db.fills.splice(i, 1);
    if (fill.side === 'buy') {
      const j = db.trades.findIndex(
        (x) =>
          x.symbol === fill.symbol &&
          x.qty === fill.qty &&
          (x.ticketId ?? null) === (fill.ticketId ?? null),
      );
      if (j !== -1) db.trades.splice(j, 1);
      db.dashboard.tradesToday = Math.max(0, db.dashboard.tradesToday - 1);
      const t = db.tickets.find((x) => x.id === fill.ticketId);
      if (t)
        db.dashboard.riskUsed = Math.max(
          0,
          Math.round((db.dashboard.riskUsed - t.maxLoss) * 100) / 100,
        );
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${P}/alerts`, async () => {
    await latency();
    return json(db.alerts);
  }),

  http.post(`${P}/alerts/from-plan`, async ({ request }) => {
    await latency();
    const { runId } = (await request.json()) as { runId: string };
    const run = db.runs.find((r) => r.id === runId);
    const exit = run?.steps.find((s) => s.key === 'exit');
    if (!run || !exit?.outputs || exit.status === 'pending') {
      return problem(409, 'previous_step_not_done', 'The run has no exit plan yet');
    }
    const o = exit.outputs as { stop: number; target: number };
    const now = toEtIso(demoNow());
    const created: Alert[] = [
      {
        id: nextId('alr'),
        type: 'stop',
        symbol: run.ticker ?? undefined,
        level: o.stop,
        status: 'armed',
        createdAt: now,
        rungAt: null,
      },
      {
        id: nextId('alr'),
        type: 'target',
        symbol: run.ticker ?? undefined,
        level: o.target,
        status: 'armed',
        createdAt: now,
        rungAt: null,
      },
      {
        id: nextId('alr'),
        type: 'flat_by',
        symbol: run.ticker ?? undefined,
        time: db.settings.limits.flatBy ?? '15:55',
        status: 'armed',
        createdAt: now,
        rungAt: null,
      },
    ];
    db.alerts.push(...created);
    return json(created, 201);
  }),

  http.post(`${P}/alerts`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as AlertCreate;
    const types: AlertCreate['type'][] = [
      'above',
      'below',
      'stop',
      'target',
      'pct_move',
      'time',
      'open_bell',
      'flat_by',
    ];
    if (!body || !types.includes(body.type))
      return problem(422, 'invalid_alert', 'Invalid alert type');
    const invalid = alertInvalid(body);
    if (invalid) return problem(422, 'invalid_alert', 'Alert not created', invalid);
    const alert: Alert = {
      ...body,
      id: nextId('alr'),
      status: 'armed',
      createdAt: toEtIso(demoNow()),
      rungAt: null,
    };
    db.alerts.push(alert);
    return json(alert, 201);
  }),

  http.patch(`${P}/alerts/:alertId`, async ({ params, request }) => {
    await latency();
    const i = db.alerts.findIndex((a) => a.id === params.alertId);
    if (i === -1) return problem(404, 'alert_not_found', 'Alert not found');
    const patch = (await request.json()) as AlertUpdate;
    const { status, ...fields } = patch ?? {};
    const merged: Alert = { ...db.alerts[i] };
    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined) delete (merged as Record<string, unknown>)[k];
      else (merged as Record<string, unknown>)[k] = v;
    }
    if (merged.symbol) merged.symbol = merged.symbol.toUpperCase();
    if (merged.type === 'flat_by' && !merged.time)
      merged.time = db.settings.limits.flatBy ?? '15:55';
    const invalid = alertInvalid(merged);
    if (invalid) return problem(422, 'invalid_alert', 'Alert not updated', invalid);
    if (status === 'armed') {
      merged.status = 'armed';
      merged.rungAt = null;
    }
    db.alerts[i] = merged;
    return json(merged);
  }),

  http.delete(`${P}/alerts/:alertId`, async ({ params }) => {
    await latency();
    db.alerts = db.alerts.filter((a) => a.id !== params.alertId);
    return new HttpResponse(null, { status: 204 });
  }),

  ...makePaperHandlers(P, latency),

  ...makeResearchHandlers(P, latency),

  ...makeBridgeHandlers(P, latency),

  ...makeAiHandlers(P, latency),

  // SSE is simulated in-process (see eventBus.ts); answer the real URL so nothing leaks to the network.
  http.get(
    `${P}/events`,
    () => new HttpResponse('', { headers: { 'Content-Type': 'text/event-stream' } }),
  ),
];
