/**
 * Pipeline steps for the mock engine, shaped exactly like the real engine's Step objects
 * (engine/levelset_engine/pipeline/steps.py): raw skill JSON in `outputs`, the engine's
 * `summary.code` / `summary.values` and its `checks` codes. The UI renders these, so the mock and
 * the real engine must look the same.
 *
 * Scenarios (chosen by ticker when a run starts in the mock):
 *   ready    TSLA (or no ticker): the README example, ticket READY (news + time machine need a look)
 *   blocked  AMD: risk BLOCK on the daily loss limit, ticket blocked
 *   waiting  NVDA: a run-all that stops early at Entry (still below the range high) -> "Check again"
 *   no_data  any other ticker: the demo has no bars for it, Entry errors (like the real demo engine)
 */
import type { Bar, PipelineRun, PipelineRunSummary, Step, StepKey, Ticket } from '../types';
import { STEP_KEYS } from '../types';
import * as fx from './fixtures';

export type Scenario = 'ready' | 'blocked' | 'waiting' | 'no_data';
type Params = Record<string, unknown>;
type Tm = Required<NonNullable<Ticket['timeMachine']>>;

export interface MockRunSpec {
  id: string;
  ticker: string;
  startedAt: string;
  scenario: Scenario;
  setup?: 'orb' | 'level';
  mode?: 'all' | 'step';
  orHigh: number;
  orLow: number;
  /** Trigger price (the close of the bar that broke out). */
  entry: number;
  /** Last close while waiting. */
  lastClose?: number;
  tm: Tm;
  riskUsedBefore: number;
  tradesBefore: number;
  ticketId: string | null;
  earnings?: boolean;
  /** Per-step parameter overrides (what the user typed in the wizard). */
  params?: Partial<Record<StepKey, Params>>;
  /** How many times Entry was checked in this run (waiting -> triggered on the third check). */
  entryChecks?: number;
}

// ---------------------------------------------------------------- small helpers

const r2 = (n: number) => Math.round(n * 100) / 100;
const floorCent = (n: number) => Math.floor(n * 100 + 1e-6) / 100;
const fmt = (n: number) => n.toFixed(2);
const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function addSec(iso: string, s: number): string {
  const d = new Date(new Date(iso).getTime() + s * 1000);
  return `${new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 19)}-04:00`;
}
const etDate = (iso: string) => iso.slice(0, 10);
/** "10:15" (ET, from an ISO with the -04:00 offset) -> "10:15 AM", the skills' style. */
function ampm(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function barStartBefore(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(':').map(Number);
  const mins = h * 60 + m - 5 - (m % 5);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export const DEFAULT_PARAMS: Record<StepKey, Params> = {
  scanner: { kind: 'orb', orMinutes: 15 },
  news: { hours: 12 },
  entry: { orMinutes: 15, interval: '5m' },
  exit: { stop: 'or-mid', target: '1R' },
  timemachine: { replays: 10000, seed: 19, window: 2 },
  budget: {},
  risk: {},
  ticket: {},
};
const ALLOWED: Record<StepKey, string[]> = {
  scanner: ['kind', 'at', 'orMinutes', 'minPrice', 'minVolume', 'maxConfirm', 'ticker'],
  news: ['hours', 'forms', 'movePct', 'noSec'],
  entry: ['orMinutes', 'interval', 'level', 'minVolumeX'],
  exit: ['stop', 'target', 'flatBy', 'entry'],
  timemachine: ['replays', 'seed', 'window', 'until'],
  budget: ['limit', 'budget'],
  risk: [],
  ticket: [],
};

/** Defaults + allowed overrides, like engine/levelset_engine/pipeline/params.py merged(). */
export function mergedParams(key: StepKey, ...overrides: (Params | undefined)[]): Params {
  const out: Params = { ...DEFAULT_PARAMS[key] };
  for (const o of overrides)
    for (const [k, v] of Object.entries(o ?? {}))
      if (ALLOWED[key].includes(k) && v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

const paramsOf = (spec: MockRunSpec, key: StepKey) => mergedParams(key, spec.params?.[key]);

// ---------------------------------------------------------------- scanner hits (real skill shape)

interface RawHit {
  symbol: string;
  setups: string[];
  price: number;
  at: string;
  bar_start: string;
  bar_index: number;
  or_high: number;
  or_low: number;
  pct_over: number;
}
const hit = (
  symbol: string,
  price: number,
  at: string,
  barStart: string,
  barIndex: number,
  orHigh: number,
  orLow: number,
  pctOver: number,
): RawHit => ({
  symbol,
  setups: ['orb'],
  price,
  at,
  bar_start: barStart,
  bar_index: barIndex,
  or_high: orHigh,
  or_low: orLow,
  pct_over: pctOver,
});

/** Opening-range breakouts on the 2026-10-19 wall at 10:15 (subset of the real scan's 42 hits). */
export const ORB_HITS: RawHit[] = [
  hit('RCL', 280.99, '10:15 AM', '10:10', 8, 279.45, 275.78, 0.55),
  hit('TSLA', 364.18, '10:15 AM', '10:10', 8, 362.18, 354.47, 0.55),
  hit('MSFT', 534.15, '10:15 AM', '10:10', 8, 532.63, 528.74, 0.28),
  hit('W', 110.46, '10:15 AM', '10:10', 8, 110.25, 107.58, 0.19),
  hit('SNOW', 317.08, '10:15 AM', '10:10', 8, 316.5, 309.8, 0.18),
  hit('PLTR', 192.17, '10:15 AM', '10:10', 8, 191.88, 186.17, 0.15),
  hit('PNC', 218.3, '10:15 AM', '10:10', 8, 217.99, 216.18, 0.14),
  hit('SYK', 297.05, '10:15 AM', '10:10', 8, 296.64, 290.01, 0.14),
  hit('ISRG', 431.58, '10:15 AM', '10:10', 8, 431.0, 426.7, 0.13),
  hit('AMD', 158.4, '10:15 AM', '10:10', 8, 157.9, 150.7, 0.32),
  hit('CPNG', 14.39, '10:15 AM', '10:10', 8, 14.38, 14.23, 0.07),
  hit('VRTX', 504.12, '10:15 AM', '10:10', 8, 504.02, 499.5, 0.02),
  hit('AMGN', 434.08, '10:10 AM', '10:05', 7, 433.14, 428.23, 0.22),
  hit('AMZN', 258.21, '10:10 AM', '10:05', 7, 257.73, 255.24, 0.19),
  hit('DLTR', 124.87, '10:10 AM', '10:05', 7, 124.82, 123.03, 0.04),
  hit('META', 712.4, '9:50 AM', '09:45', 3, 711.9, 696.4, 0.07),
];
const SCAN_META = { universe: 234, scanned: 231, failed: 1 };

// ---------------------------------------------------------------- news (real skill shape)

interface RawNews {
  id: string;
  source: string;
  kind: 'headline' | 'filing';
  ticker: string;
  title: string;
  summary?: string;
  link: string;
  time: string;
  touches: string[];
  tags: string[];
  new: boolean;
  important?: boolean;
}
const yahoo = 'https://finance.yahoo.com/quote/';
const news = (
  ticker: string,
  n: number,
  title: string,
  time: string,
  tags: string[],
  kind: RawNews['kind'] = 'headline',
): RawNews => ({
  id: `rss:${ticker.toLowerCase()}-${n}`,
  source: kind === 'filing' ? 'SEC EDGAR' : 'Yahoo Finance',
  kind,
  ticker,
  title,
  link:
    kind === 'filing'
      ? 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=8-K'
      : `${yahoo}${ticker}/news`,
  time,
  touches: [ticker],
  tags,
  new: true,
});

/** TSLA items from the trader-news fixture (titles kept as published; UTC times). */
const NEWS: Record<string, RawNews[]> = {
  TSLA: [
    news(
      'TSLA',
      1,
      'Tech rebounds as semiconductor stocks jump: AlphaCheck',
      '2026-10-19T13:50:03+00:00',
      ['earnings'],
    ),
    news(
      'TSLA',
      2,
      'Earnings live updates: All eyes on Musk and Meta as Q3 earnings rev up',
      '2026-10-19T13:41:52+00:00',
      ['earnings'],
    ),
    news(
      'TSLA',
      3,
      'Update: Tech Stock Rebound Nudges US Equity Futures Mostly Higher',
      '2026-10-19T12:58:10+00:00',
      ['macro'],
    ),
    news(
      'TSLA',
      4,
      'SpaceX Stock Climbs After Musk Gift Pledge; Analysts Predict More Gains',
      '2026-10-19T12:31:44+00:00',
      ['deal'],
    ),
    news(
      'TSLA',
      5,
      'Tesla-SpaceX Merger Mania Strikes Wall Street Ahead of Earnings',
      '2026-10-19T11:05:00+00:00',
      ['earnings', 'deal'],
    ),
    news(
      'TSLA',
      6,
      'Tesla Stock vs. the S&P 500: Which Investment Wins Through 2030?',
      '2026-10-19T10:20:00+00:00',
      [],
    ),
  ],
  AMD: [
    news(
      'AMD',
      1,
      'AMD shares climb in early trade as chip stocks rally',
      '2026-10-19T13:47:00+00:00',
      [],
    ),
  ],
  META: [
    news(
      'META',
      1,
      'Meta and Musk earnings and September pending home sales: What to watch',
      '2026-10-19T11:30:00+00:00',
      ['earnings'],
    ),
  ],
  NVDA: [
    news(
      'NVDA',
      1,
      'Nvidia expands data-centre supply agreement with a cloud provider',
      '2026-10-19T13:12:00+00:00',
      ['deal'],
    ),
  ],
};

// ---------------------------------------------------------------- time machine history (TSLA from the fixture)

type Trade = [string, string, number, number, number, 'target' | 'stop' | 'close', number];
const TSLA_TRADES: Trade[] = [
  ['2026-07-28', '11:50 AM', 307.97, 304.89, 311.05, 'target', 1.0],
  ['2026-07-30', '10:05 AM', 307.79, 304.42, 311.16, 'stop', -1.0],
  ['2026-08-03', '10:00 AM', 318.9, 314.41, 323.39, 'target', 1.0],
  ['2026-08-04', '1:25 PM', 327.31, 323.97, 330.65, 'close', 0.03],
  ['2026-08-05', '10:10 AM', 326.38, 323.08, 329.68, 'stop', -1.0],
  ['2026-08-06', '10:00 AM', 320.23, 317.48, 322.98, 'target', 1.0],
  ['2026-08-07', '9:50 AM', 326.99, 323.89, 330.09, 'stop', -1.0],
  ['2026-08-10', '10:00 AM', 329.45, 327.78, 331.12, 'target', 1.0],
  ['2026-08-11', '10:05 AM', 334.86, 331.66, 338.06, 'stop', -1.0],
  ['2026-08-13', '9:55 AM', 332.46, 328.46, 336.46, 'target', 1.0],
  ['2026-08-14', '9:50 AM', 348.29, 344.9, 351.68, 'stop', -1.0],
  ['2026-08-17', '9:50 AM', 342.69, 339.45, 345.93, 'stop', -1.0],
  ['2026-08-19', '10:30 AM', 342.34, 339.41, 345.27, 'target', 1.0],
  ['2026-08-21', '10:00 AM', 354.36, 349.23, 359.49, 'target', 1.0],
  ['2026-08-25', '10:10 AM', 352.49, 350.72, 354.26, 'stop', -1.0],
  ['2026-08-27', '10:15 AM', 351.63, 348.1, 355.16, 'target', 1.0],
  ['2026-08-31', '9:50 AM', 359.42, 351.54, 367.3, 'target', 1.0],
  ['2026-09-03', '9:50 AM', 377.43, 370.54, 384.32, 'stop', -1.0],
  ['2026-09-08', '10:25 AM', 363.96, 359.2, 368.72, 'target', 1.0],
  ['2026-09-10', '9:50 AM', 366.3, 361.53, 371.07, 'close', -0.56],
  ['2026-09-16', '9:50 AM', 359.99, 357.19, 362.79, 'target', 1.0],
  ['2026-09-17', '10:10 AM', 372.92, 367.25, 378.59, 'stop', -1.0],
  ['2026-09-21', '9:55 AM', 377.57, 373.8, 381.34, 'stop', -1.0],
  ['2026-09-22', '1:55 PM', 379.35, 376.06, 382.64, 'close', -0.15],
  ['2026-09-23', '10:00 AM', 385.11, 381.77, 388.45, 'stop', -1.0],
  ['2026-09-24', '10:00 AM', 378.89, 377.43, 380.35, 'stop', -1.0],
  ['2026-09-30', '1:35 PM', 352.59, 349.46, 355.72, 'close', 0.73],
  ['2026-10-01', '10:50 AM', 358.66, 356.86, 360.46, 'stop', -1.0],
  ['2026-10-02', '10:05 AM', 371.34, 365.37, 377.31, 'close', -0.11],
  ['2026-10-05', '9:50 AM', 374.13, 368.36, 379.9, 'target', 1.0],
  ['2026-10-09', '9:50 AM', 387.58, 384.25, 390.91, 'stop', -1.0],
  ['2026-10-13', '10:45 AM', 375.52, 373.09, 377.95, 'stop', -1.0],
  ['2026-10-15', '10:45 AM', 360.77, 358.94, 362.6, 'target', 1.0],
];
const TSLA_HIST = {
  lo: 351.75,
  hi: 377.39,
  bins: [
    107, 109, 128, 199, 252, 331, 465, 571, 689, 694, 757, 811, 761, 732, 686, 558, 503, 452, 327,
    244, 160, 125, 102, 78,
  ],
};

function syntheticTrades(spec: MockRunSpec, risk: number, targetR: number): Trade[] {
  const { historyFired: n, historyWon: won, historyLost: lost } = spec.tm;
  const out: Trade[] = [];
  const start = new Date('2026-07-27T12:00:00Z').getTime();
  for (let i = 0; i < n; i += 1) {
    const day = new Date(start + Math.round((i * 80) / Math.max(n, 1)) * 86400000)
      .toISOString()
      .slice(0, 10);
    const entry = r2(spec.entry * (0.88 + ((i * 37) % 23) / 100));
    const stop = r2(entry - risk * (0.8 + ((i * 7) % 5) / 10));
    const target = r2(entry + (entry - stop) * targetR);
    const kind: Trade[5] = i % 3 === 0 && won > 0 ? 'target' : 'stop';
    out.push([day, '10:05 AM', entry, stop, target, kind, kind === 'target' ? targetR : -1]);
  }
  // exact won / lost / close counts
  let w = won;
  let l = lost;
  for (const t of out) {
    if (w > 0) {
      t[5] = 'target';
      t[6] = targetR;
      w -= 1;
    } else if (l > 0) {
      t[5] = 'stop';
      t[6] = -1;
      l -= 1;
    } else {
      t[5] = 'close';
      t[6] = 0.12;
    }
  }
  // interleave so the table doesn't read target, target, target...
  return out
    .map((t, i) => ({ t, k: (i * 7919) % out.length }))
    .sort((a, b) => a.k - b.k)
    .map((x, i) => {
      x.t[0] = out[i][0];
      return x.t;
    });
}

function syntheticHist(center: number, risk: number) {
  const lo = r2(center - 2.2 * risk);
  const hi = r2(center + 2.2 * risk);
  const bins = Array.from({ length: 24 }, (_, i) => {
    const x = (i - 11.5) / 5;
    return Math.round(820 * Math.exp(-x * x));
  });
  return { lo, hi, bins };
}

// ---------------------------------------------------------------- exit rules

interface ExitLevels {
  entry: number;
  stop: number;
  target: number;
  stopRule: string;
  stopLabel: string;
  stopDetail: string;
  targetR: number;
  targetLabel: string;
  risk: number;
  error?: string;
}

/** trader-exit's stop and target rules (or-mid | or-low | price:X | pct:X | atr:K ; NR | price:X). */
export function exitLevels(spec: MockRunSpec, params: Params): ExitLevels {
  const entry = typeof params.entry === 'number' ? params.entry : spec.entry;
  const stopArg = String(params.stop ?? 'or-mid');
  const targetArg = String(params.target ?? '1R');
  const [sKind, sVal] = stopArg.split(':');
  const atr = r2((spec.orHigh - spec.orLow) * 0.38);
  let stop: number;
  let stopRule: string;
  let stopLabel: string;
  let stopDetail: string;
  switch (sKind) {
    case 'or-low':
      stop = floorCent(spec.orLow);
      stopRule = 'or_low';
      stopLabel = 'opening-range low';
      stopDetail = `the range low $${fmt(spec.orLow)}`;
      break;
    case 'price':
      stop = floorCent(Number(sVal));
      stopRule = 'price';
      stopLabel = 'your price';
      stopDetail = `$${fmt(stop)} as given`;
      break;
    case 'pct':
      stop = floorCent(entry * (1 - Number(sVal) / 100));
      stopRule = 'pct';
      stopLabel = `${Number(sVal)}% below the entry`;
      stopDetail = `$${fmt(entry)} x (1 - ${Number(sVal)}%) = $${(entry * (1 - Number(sVal) / 100)).toFixed(3)}, rounded down`;
      break;
    case 'atr':
      stop = floorCent(entry - Number(sVal) * atr);
      stopRule = 'atr';
      stopLabel = `${Number(sVal)} x ATR below the entry`;
      stopDetail = `$${fmt(entry)} - ${Number(sVal)} x ${fmt(atr)} ATR, rounded down`;
      break;
    default: {
      const mid = (spec.orHigh + spec.orLow) / 2;
      stop = floorCent(mid);
      stopRule = 'or_mid';
      stopLabel = 'opening-range midpoint';
      stopDetail = `($${fmt(spec.orHigh)} + $${fmt(spec.orLow)}) / 2 = $${mid.toFixed(3)}, rounded down`;
    }
  }
  const risk = r2(entry - stop);
  let target: number;
  let targetR: number;
  let targetLabel: string;
  const [tKind, tVal] = targetArg.split(':');
  if (tKind === 'price') {
    target = r2(Number(tVal));
    targetR = risk > 0 ? r2((target - entry) / risk) : 0;
    targetLabel = 'your price';
  } else {
    targetR = Number(targetArg.replace(/r$/i, '')) || 1;
    target = r2(entry + targetR * risk);
    targetLabel =
      targetR === 1 ? '1R (one times the risk)' : `${targetR}R (${targetR} times the risk)`;
  }
  const base = {
    entry,
    stop,
    target,
    stopRule,
    stopLabel,
    stopDetail,
    targetR,
    targetLabel,
    risk,
  };
  if (!Number.isFinite(stop) || stop >= entry)
    return { ...base, error: `the stop ${fmt(stop)} must be below the entry ${fmt(entry)}` };
  if (!Number.isFinite(target) || target <= entry)
    return { ...base, error: `the target ${fmt(target)} must be above the entry ${fmt(entry)}` };
  if (risk < 0.02)
    return { ...base, error: `a ${fmt(risk)} stop is too tight to survive the spread` };
  return base;
}

// ---------------------------------------------------------------- the eight steps

const t = (spec: MockRunSpec, s: number) => addSec(spec.startedAt, s);

function finished(
  spec: MockRunSpec,
  key: StepKey,
  at: [number, number],
  body: Omit<Step, 'key' | 'params' | 'startedAt' | 'endedAt' | 'error'> & {
    error?: string | null;
  },
): Step {
  return {
    key,
    params: paramsOf(spec, key),
    error: null,
    ...body,
    startedAt: t(spec, at[0]),
    endedAt: t(spec, at[1]),
  };
}

export function pendingStep(key: StepKey, params?: Params): Step {
  return {
    key,
    status: 'pending',
    params: params ?? { ...DEFAULT_PARAMS[key] },
    inputs: {},
    outputs: {},
    summary: {},
    checks: [],
    error: null,
    startedAt: null,
    endedAt: null,
  };
}

function scannerStep(spec: MockRunSpec): Step {
  const hits = ORB_HITS.filter(
    (h) => !(h.symbol === 'AMD' && spec.ticker !== 'AMD') || spec.ticker === 'AMD',
  );
  const chosen = hits.find((h) => h.symbol === spec.ticker);
  const asOf = `${etDate(spec.startedAt)} ${spec.startedAt.slice(11, 16)} ET`;
  const outputs = {
    created_by: 'trader-scanner',
    mode: 'orb',
    as_of: asOf,
    ...SCAN_META,
    source: 'yahoo',
    or_minutes: 15,
    interval: '5m',
    note: 'A scan is a list of charts that match a rule, not a list of stocks to buy.',
    hits,
  };
  const values: Record<string, unknown> = {
    kind: 'orb',
    hits: hits.length,
    scanned: SCAN_META.scanned,
    universe: SCAN_META.universe,
    asOf,
    symbol: spec.ticker,
  };
  let outLine = `${hits.length} of ${SCAN_META.scanned} charts matched`;
  if (chosen) {
    Object.assign(values, {
      price: chosen.price,
      rangeHigh: chosen.or_high,
      rangeLow: chosen.or_low,
      at: chosen.at,
      pctOver: chosen.pct_over,
    });
    outLine += `; ${spec.ticker} range ${fmt(chosen.or_low)} to ${fmt(chosen.or_high)}, ${fmt(chosen.price)} at ${chosen.at} (+${chosen.pct_over.toFixed(2)}% over)`;
  } else {
    outLine += `; ${spec.ticker} not in the hits`;
  }
  return finished(spec, 'scanner', [0, 4], {
    status: chosen ? 'done' : 'check',
    inputs: {
      kind: 'orb',
      at: null,
      symbols: spec.scenario === 'ready' ? 'universe' : spec.ticker,
      config: { no_entries_after: fx.settings.limits.noEntriesAfter },
      source: 'fixtures',
    },
    outputs,
    checks: chosen ? [] : ['not_in_scan'],
    summary: {
      code: 'scanner.found',
      values,
      inLine: `orb scan, ${asOf}, ${SCAN_META.universe} charts`,
      outLine,
    },
  });
}

function newsStep(spec: MockRunSpec): Step {
  const items = NEWS[spec.ticker] ?? [];
  const tags = [...new Set(items.flatMap((i) => i.tags))].sort();
  const checks: string[] = [];
  if (spec.earnings && tags.includes('earnings')) checks.push('earnings_this_week');
  const latest = items[0]?.title ?? null;
  let outLine = `${items.length} item${items.length === 1 ? '' : 's'} for ${spec.ticker}`;
  if (checks.length) outLine += ` (${checks.join(', ')})`;
  if (latest) outLine += `; latest: ${latest}`;
  return finished(spec, 'news', [4, 7], {
    status: checks.length ? 'check' : 'done',
    inputs: { tickers: [spec.ticker], hours: 12, secUserAgentSet: true },
    outputs: { checked: `${etDate(spec.startedAt)}T14:15:00+00:00`, moves: [], items, notes: [] },
    checks,
    summary: {
      code: 'news.items',
      values: {
        symbol: spec.ticker,
        items: items.length,
        tags,
        latest,
        filings: items.filter((i) => i.kind === 'filing').length,
      },
      inLine: `Headlines and 8-Ks for ${spec.ticker}, last 12 h`,
      outLine,
    },
  });
}

function entryStep(spec: MockRunSpec): Step {
  const p = paramsOf(spec, 'entry');
  const setup = spec.setup ?? 'orb';
  const level = setup === 'level' && typeof p.level === 'number' ? p.level : spec.orHigh;
  const inLine = `${spec.ticker} ${setup} on 5m bars, range ${fmt(spec.orLow)} to ${fmt(spec.orHigh)}`;
  const orr = {
    high: spec.orHigh,
    low: spec.orLow,
    minutes: Number(p.orMinutes ?? 15),
    complete: true,
  };
  const inputs = {
    symbol: spec.ticker,
    setup,
    watchlistHit: ORB_HITS.find((h) => h.symbol === spec.ticker) ?? null,
    config: {
      no_entries_before: fx.settings.limits.noEntriesBefore,
      no_entries_after: fx.settings.limits.noEntriesAfter,
    },
  };
  const base = {
    symbol: spec.ticker,
    setup,
    side: 'buy',
    date: etDate(spec.startedAt),
    interval: String(p.interval ?? '5m'),
    or_minutes: orr.minutes,
    phase: 'open',
    opening_range: orr,
    level,
    no_entries_before: fx.settings.limits.noEntriesBefore,
    no_entries_after: fx.settings.limits.noEntriesAfter,
  };
  if (spec.scenario === 'no_data') {
    const message = `no data for ${spec.ticker}: the demo has bars for the scanned symbols only`;
    return finished(spec, 'entry', [7, 8], {
      status: 'error',
      inputs,
      outputs: { stderr: message, exitCode: 2 },
      checks: [],
      error: message,
      summary: { code: 'entry.error', values: { message }, outLine: message },
    });
  }
  const waiting = spec.scenario === 'waiting' && (spec.entryChecks ?? 1) < 3;
  if (waiting) {
    const checks = spec.entryChecks ?? 1;
    const last = checks >= 2 ? r2(level * (1 - 0.0018)) : (spec.lastClose ?? r2(level * 0.996));
    const vs = r2(((last - level) / level) * 100);
    const lastBar = barStartBefore(t(spec, 8));
    const reason = `no 5m bar has closed above the range high ${fmt(level)} yet (last close ${fmt(last)})`;
    return finished(spec, 'entry', [7, 8], {
      status: 'check',
      inputs,
      outputs: {
        ...base,
        now: `${etDate(spec.startedAt)} ${t(spec, 8).slice(11, 16)}:00`,
        status: 'waiting',
        reason,
        trigger: null,
        last: { bar_start: lastBar, close: last, vs_level_pct: vs },
      },
      checks: ['entry_waiting'],
      summary: {
        code: 'entry.waiting',
        values: {
          symbol: spec.ticker,
          status: 'waiting',
          phase: 'open',
          level,
          rangeHigh: spec.orHigh,
          rangeLow: spec.orLow,
          price: null,
          time: null,
          barStart: null,
          pctOver: null,
          lastClose: last,
          distancePct: vs,
        },
        inLine,
        outLine: `Waiting: ${reason}`,
      },
    });
  }
  const time = ampm(trigIso(spec));
  const barStart = barStartBefore(trigIso(spec));
  const pctOver = r2(((spec.entry - level) / level) * 100);
  return finished(spec, 'entry', [7, 8], {
    status: 'done',
    inputs,
    outputs: {
      ...base,
      now: `${etDate(spec.startedAt)} ${spec.startedAt.slice(11, 16)}:00`,
      status: 'triggered',
      reason: 'the bar closed above the range high',
      trigger: {
        time,
        bar_start: barStart,
        price: spec.entry,
        close: spec.entry,
        volume: 1000057,
        volume_x: 0.6,
        pct_over: pctOver,
      },
      last: { bar_start: barStart, close: spec.entry, vs_level_pct: pctOver },
    },
    checks: [],
    summary: {
      code: 'entry.triggered',
      values: {
        symbol: spec.ticker,
        status: 'triggered',
        phase: 'open',
        level,
        rangeHigh: spec.orHigh,
        rangeLow: spec.orLow,
        price: spec.entry,
        time,
        barStart,
        pctOver,
        lastClose: spec.entry,
        distancePct: pctOver,
      },
      inLine,
      outLine: `Triggered ${time} at ${fmt(spec.entry)}: the ${barStart} bar closed above ${fmt(level)}`,
    },
  });
}

function exitStep(spec: MockRunSpec): Step {
  const p = paramsOf(spec, 'exit');
  const x = exitLevels(spec, p);
  const flatBy = String(p.flatBy ?? fx.settings.limits.flatBy ?? '15:55');
  const inputs = {
    entry: { symbol: spec.ticker, status: 'triggered', price: x.entry, time: ampm(trigIso(spec)) },
    config: {
      flat_by: fx.settings.limits.flatBy,
      min_reward_risk: fx.settings.limits.minRewardRisk,
    },
    stop: p.stop,
    target: p.target,
  };
  if (x.error) {
    return finished(spec, 'exit', [8, 9], {
      status: 'error',
      inputs,
      outputs: { stderr: x.error, exitCode: 2 },
      checks: [],
      error: x.error,
      summary: { code: 'exit.error', values: { message: x.error }, outLine: x.error },
    });
  }
  const rr = r2((x.target - x.entry) / x.risk);
  const minRr = fx.settings.limits.minRewardRisk ?? 1;
  const warnings =
    rr + 1e-9 < minRr ? [`reward:risk ${fmt(rr)} is below min_reward_risk ${minRr}`] : [];
  return finished(spec, 'exit', [8, 9], {
    status: warnings.length ? 'check' : 'done',
    inputs,
    outputs: {
      created_by: 'trader-exit',
      symbol: spec.ticker,
      side: 'buy',
      date: etDate(spec.startedAt),
      setup: spec.setup ?? 'orb',
      entry: x.entry,
      entry_time: ampm(trigIso(spec)),
      interval: '5m',
      opening_range: { high: spec.orHigh, low: spec.orLow, minutes: 15 },
      stop: x.stop,
      stop_rule: x.stopRule,
      stop_label: x.stopLabel,
      target: x.target,
      target_r: x.targetR,
      target_label: x.targetLabel,
      risk_per_share: x.risk,
      reward_risk: rr,
      flat_by: flatBy,
      stop_detail: x.stopDetail,
      note: 'A stop is a plan, not a guarantee: a gap or a fast market can fill past it.',
      warnings,
    },
    checks: warnings.length ? ['reward_risk_below_min'] : [],
    summary: {
      code: 'exit.plan',
      values: {
        symbol: spec.ticker,
        entry: x.entry,
        stop: x.stop,
        target: x.target,
        riskPerShare: x.risk,
        rewardRisk: rr,
        targetR: x.targetR,
        stopRule: x.stopRule,
        flatBy,
      },
      inLine: `Entry ${fmt(x.entry)} at ${ampm(trigIso(spec))}, stop rule ${String(p.stop)}, target ${String(p.target)}`,
      outLine: `Stop ${fmt(x.stop)}: ${x.stopLabel}. Target ${fmt(x.target)}: ${x.targetLabel}. Risk ${fmt(x.risk)} a share, flat by ${flatBy}`,
    },
  });
}

export function tmVerdict(tm: Tm, rAtTarget: number): Tm['verdict'] {
  const pt = tm.targetFirstPct;
  const ps = tm.stopFirstPct;
  if (pt + ps <= 0) return 'coin_flip';
  const d = pt / (pt + ps) - 1 / (1 + rAtTarget);
  if (Math.abs(d) < 0.05) return 'coin_flip';
  return d > 0 ? 'favorable' : 'unfavorable';
}

function tmStep(spec: MockRunSpec): Step {
  const p = paramsOf(spec, 'timemachine');
  const x = exitLevels(spec, paramsOf(spec, 'exit'));
  const tm = spec.tm;
  const verdict = tmVerdict(tm, x.targetR);
  const checks: string[] = [];
  if (verdict === 'coin_flip') checks.push('coin_flip');
  else if (verdict === 'unfavorable') checks.push('unfavorable_odds');
  if (tm.openAtClosePct > 40) checks.push('many_open_at_close');
  const isTsla = spec.ticker === 'TSLA' && x.stop === fx.TSLA.stop && x.target === fx.TSLA.target;
  const trades = isTsla ? TSLA_TRADES : syntheticTrades(spec, x.risk, x.targetR);
  const neither = trades.filter((tr) => tr[5] === 'close').length;
  const until = String(p.until ?? '16:00');
  const lean =
    verdict === 'coin_flip'
      ? 'Close to a coin flip'
      : verdict === 'favorable'
        ? 'Leans your way'
        : 'Leans against you';
  const verdictText = `${lean}: target first ${tm.targetFirstPct} % vs stop first ${tm.stopFirstPct} %.`;
  const greenPct = r2(tm.targetFirstPct + tm.openAtClosePct * 0.5);
  const avgR = r2(
    (tm.targetFirstPct * x.targetR - tm.stopFirstPct + tm.openAtClosePct * 0.05) / 100,
  );
  const mc = {
    replays: Number(p.replays ?? 10000),
    seed: Number(p.seed ?? 19),
    window: Number(p.window ?? 2),
    p_target: tm.targetFirstPct / 100,
    p_stop: tm.stopFirstPct / 100,
    p_neither: tm.openAtClosePct / 100,
    p_green: greenPct / 100,
    median_close: isTsla ? 364.36 : r2(x.entry + x.risk * 0.03),
    p5_close: isTsla ? 355.54 : r2(x.entry - x.risk * 1.5),
    p95_close: isTsla ? 373.54 : r2(x.entry + x.risk * 1.6),
    avg_R: isTsla ? 0.034 : avgR,
    r_at_target: x.targetR,
    hist: isTsla ? TSLA_HIST : syntheticHist(x.entry, x.risk),
    until,
    pool_sessions: 59,
  };
  const history = {
    sessions: 59,
    triggered: tm.historyFired,
    target: tm.historyWon,
    stop: tm.historyLost,
    close: neither,
    green: Math.round(tm.historyWon + neither / 2),
    avg_R: isTsla
      ? -0.062
      : r2((tm.historyWon * x.targetR - tm.historyLost) / Math.max(1, tm.historyFired)),
    rule: { setup: 'orb', or_minutes: 15, stop_rule: x.stopRule, target_r: x.targetR },
    trades: trades.map(([date, time, entry, stop, target, outcome, R]) => ({
      date,
      time,
      entry,
      stop,
      target,
      outcome,
      R,
    })),
  };
  return finished(spec, 'timemachine', [9, 14], {
    status: checks.length ? 'check' : 'done',
    inputs: { plan: { symbol: spec.ticker, entry: x.entry, stop: x.stop, target: x.target }, ...p },
    outputs: {
      created_by: 'trader-timemachine',
      source: 'offline',
      plan: {
        symbol: spec.ticker,
        entry: x.entry,
        stop: x.stop,
        target: x.target,
        entry_time: ampm(trigIso(spec)),
      },
      mc,
      history,
      verdict: verdictText,
      verdict_notes:
        tm.openAtClosePct > 40
          ? [
              `${tm.openAtClosePct} % of the replays hit neither by 4:00 PM; the price at 4:00 PM decides those.`,
            ]
          : [],
      warnings: [],
      note: `A simulation built from ${spec.ticker}'s own last 59 full sessions. It is not a prediction: earnings, news and halts can do things those sessions never did. Same seed, same numbers.`,
    },
    checks,
    summary: {
      code: 'timemachine.result',
      values: {
        ...tm,
        verdict,
        greenPct,
        seed: mc.seed,
        replays: mc.replays,
        historySessions: 59,
        historyNeither: neither,
        medianClose: mc.median_close,
        p5Close: mc.p5_close,
        p95Close: mc.p95_close,
        avgR: mc.avg_R,
        until,
      },
      inLine: `${mc.replays.toLocaleString('en-US')} replays from the ${ampm(trigIso(spec))} entry, seed ${mc.seed}`,
      outLine: verdictText,
    },
  });
}

interface Sizing {
  qty: number;
  boundBy: string;
  cost: number;
  maxLoss: number;
  risk: number;
  limits: { name: string; usd: number; per: number; shares: number; how: string; binds: boolean }[];
  refusal: string | null;
}

export function sizing(spec: MockRunSpec): Sizing {
  const x = exitLevels(spec, paramsOf(spec, 'exit'));
  const lim = fx.settings.limits;
  const acct = fx.settings.account;
  const p = paramsOf(spec, 'budget');
  const budget = typeof p.budget === 'number' ? p.budget : acct.accountSizeUsd;
  const entry = typeof p.limit === 'number' ? p.limit : x.entry;
  const maxLoss = lim.maxLossPerTradeUsd ?? 50;
  const posCap = (budget * (lim.maxPositionPct ?? 100)) / 100;
  const buffer = (budget * (acct.cashBufferPct ?? 0)) / 100;
  const risk = r2(entry - x.stop);
  const limits = [
    {
      name: 'max loss',
      usd: maxLoss,
      per: risk,
      shares: Math.floor(maxLoss / risk),
      how: `$${maxLoss} max loss / ${fmt(risk)} risk a share`,
    },
    {
      name: 'position cap',
      usd: posCap,
      per: entry,
      shares: Math.floor(posCap / entry),
      how: `${lim.maxPositionPct}% of ${money(budget)} = ${money(posCap)} / ${fmt(entry)}`,
    },
    {
      name: 'max order',
      usd: lim.maxOrderUsd ?? budget,
      per: entry,
      shares: Math.floor((lim.maxOrderUsd ?? budget) / entry),
      how: `${money(lim.maxOrderUsd ?? budget)} / ${fmt(entry)}`,
    },
    {
      name: 'cash',
      usd: budget - buffer,
      per: entry,
      shares: Math.floor((budget - buffer) / entry),
      how: `budget ${money(budget)} minus the ${money(buffer)} cash buffer = ${money(budget - buffer)} / ${fmt(entry)}`,
    },
  ];
  const qty = Math.min(...limits.map((l) => l.shares));
  const bound = limits.find((l) => l.shares === qty)!;
  return {
    qty: Math.max(qty, 0),
    boundBy: bound.name,
    cost: r2(Math.max(qty, 0) * entry),
    maxLoss: r2(Math.max(qty, 0) * risk),
    risk,
    limits: limits.map((l) => ({ ...l, binds: l === bound })),
    refusal:
      qty < 1
        ? `the stop is too far for your max loss: 1 share risks ${money(risk)}, over your ${money(maxLoss)} max loss per trade`
        : null,
  };
}

function bracket(spec: MockRunSpec, s: Sizing) {
  const x = exitLevels(spec, paramsOf(spec, 'exit'));
  return {
    symbol: spec.ticker,
    side: 'buy',
    qty: String(s.qty),
    type: 'market',
    time_in_force: 'day',
    order_class: 'bracket',
    take_profit_limit_price: fmt(x.target),
    stop_loss_stop_price: fmt(x.stop),
    why: `opening-range breakout on ${spec.ticker}: ${s.qty} shares, bound by your ${s.boundBy} (${s.qty} x ${fmt(s.risk)} = ${money(s.maxLoss)} at the stop)`,
  };
}

function budgetStep(spec: MockRunSpec): Step {
  const s = sizing(spec);
  const x = exitLevels(spec, paramsOf(spec, 'exit'));
  const lim = fx.settings.limits;
  const budget = fx.settings.account.accountSizeUsd;
  const values = {
    qty: s.qty,
    cost: s.cost,
    maxLoss: s.maxLoss,
    boundBy: s.boundBy,
    riskPerShare: s.risk,
    budget,
    entry: x.entry,
    maxLossPerTrade: lim.maxLossPerTradeUsd,
  };
  const inLine = `Budget ${money(budget)}, max loss ${money(lim.maxLossPerTradeUsd ?? 0)} a trade, risk ${fmt(s.risk)} a share`;
  const inputs = {
    plan: { entry: x.entry, stop: x.stop, target: x.target, risk_per_share: x.risk },
    config: {
      budget,
      cash_buffer_pct: fx.settings.account.cashBufferPct,
      max_loss_per_trade_usd: lim.maxLossPerTradeUsd,
      max_position_pct: lim.maxPositionPct,
      max_order_usd: lim.maxOrderUsd,
      min_order_usd: 5,
      min_reward_risk: lim.minRewardRisk,
    },
    portfolio: null,
    prices: null,
  };
  const sizingDoc = {
    symbol: spec.ticker,
    side: 'buy',
    entry: x.entry,
    stop: x.stop,
    target: x.target,
    risk_per_share: s.risk,
    budget,
    cash_buffer_pct: fx.settings.account.cashBufferPct,
    max_loss_per_trade_usd: lim.maxLossPerTradeUsd,
    limits: s.limits,
    qty: s.qty,
    bound_by: s.boundBy,
    cost: s.cost,
    max_loss: s.maxLoss,
    order_type: 'market',
    refusal: s.refusal,
  };
  if (s.refusal) {
    return finished(spec, 'budget', [14, 15], {
      status: 'blocked',
      inputs,
      outputs: { sizing: sizingDoc, orders: [], notes: [] },
      checks: ['max_loss_per_trade'],
      summary: {
        code: 'budget.refused',
        values: { ...values, message: s.refusal },
        inLine,
        outLine: s.refusal,
      },
    });
  }
  return finished(spec, 'budget', [14, 15], {
    status: 'done',
    inputs,
    outputs: { sizing: sizingDoc, orders: [bracket(spec, s)], notes: [] },
    checks: [],
    summary: {
      code: 'budget.sized',
      values,
      inLine,
      outLine: `${s.qty} shares (${money(s.cost)}), max loss ${money(s.maxLoss)} at the stop, bound by ${s.boundBy}`,
    },
  });
}

/** trader-risk on the sized order: reason lines start with the check name ("daily limit: ..."). */
export function riskResult(spec: MockRunSpec) {
  const s = sizing(spec);
  const x = exitLevels(spec, paramsOf(spec, 'exit'));
  const lim = fx.settings.limits;
  const rr = r2((x.target - x.entry) / s.risk);
  const reasons: string[] = [];
  if (s.maxLoss > (lim.maxLossPerTradeUsd ?? Infinity))
    reasons.push(
      `loss: ${s.qty} shares x ${fmt(s.risk)} = ${money(s.maxLoss)} is over your ${money(lim.maxLossPerTradeUsd ?? 0)} max loss per trade`,
    );
  if (rr + 1e-9 < (lim.minRewardRisk ?? 0))
    reasons.push(`reward:risk ${fmt(rr)} is below your minimum ${lim.minRewardRisk}`);
  const after = r2(spec.riskUsedBefore + s.maxLoss);
  if (after > (lim.maxDailyLossUsd ?? Infinity))
    reasons.push(
      `daily limit: ${money(spec.riskUsedBefore)} already at risk + ${money(s.maxLoss)} for this trade = ${money(after)} is over your ${money(lim.maxDailyLossUsd ?? 0)} daily loss limit`,
    );
  if (spec.tradesBefore >= (lim.maxTradesPerDay ?? Infinity))
    reasons.push(`trades: ${spec.tradesBefore} of ${lim.maxTradesPerDay} trades today already`);
  const verdict = reasons.length ? 'BLOCK' : 'PASS';
  const codes = reasons.map((r) =>
    r.startsWith('reward:risk')
      ? 'reward_risk'
      : r
          .split(':', 1)[0]
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_'),
  );
  return { s, x, rr, reasons, codes, verdict, after };
}

function riskStep(spec: MockRunSpec): Step {
  const { s, x, rr, reasons, codes, verdict } = riskResult(spec);
  const lim = fx.settings.limits;
  const acct = fx.settings.account;
  const cashAfter = r2(acct.accountSizeUsd - s.cost);
  const values = {
    verdict,
    maxLoss: s.maxLoss,
    maxLossLimit: lim.maxLossPerTradeUsd,
    rewardRisk: rr,
    minRewardRisk: lim.minRewardRisk,
    tradesToday: spec.tradesBefore,
    maxTradesPerDay: lim.maxTradesPerDay,
    lossAtRisk: spec.riskUsedBefore,
    dailyLossLimit: lim.maxDailyLossUsd,
    cashAfter,
  };
  const result = {
    index: 1,
    symbol: spec.ticker,
    side: 'buy',
    kind: 'entry',
    amount: `${s.qty} shares`,
    value_usd: s.cost,
    entry_ref: x.entry,
    entry_ref_from: 'plan',
    stop: x.stop,
    target: x.target,
    risk_per_share: s.risk,
    max_loss: s.maxLoss,
    reward_risk: rr,
    verdict,
    reasons,
    warnings: [],
    info: [
      `entry ${fmt(x.entry)} (the plan's entry), stop ${fmt(x.stop)}, target ${fmt(x.target)}: risk ${fmt(s.risk)} a share`,
      `max loss ${money(s.maxLoss)} (limit ${money(lim.maxLossPerTradeUsd ?? 0)}), reward:risk ${fmt(rr)} (min ${lim.minRewardRisk})`,
      `today before this: ${spec.tradesBefore} of ${lim.maxTradesPerDay} trades, ${money(spec.riskUsedBefore)} of ${money(lim.maxDailyLossUsd ?? 0)} daily loss`,
    ],
  };
  const inLine = `buy ${spec.ticker} ${s.qty} shares, entry ${fmt(x.entry)}, stop ${fmt(x.stop)}`;
  return finished(spec, 'risk', [15, 16], {
    status: verdict === 'PASS' ? 'done' : 'blocked',
    inputs: {
      orders: { orders: [bracket(spec, s)] },
      config: {
        max_loss_per_trade_usd: lim.maxLossPerTradeUsd,
        max_daily_loss_usd: lim.maxDailyLossUsd,
        max_trades_per_day: lim.maxTradesPerDay,
        min_reward_risk: lim.minRewardRisk,
        no_entries_before: lim.noEntriesBefore,
        no_entries_after: lim.noEntriesAfter,
        require_stop: lim.requireStop,
        pdt_guard: lim.pdtGuard,
        paper: true,
      },
      brokerLog: null,
      portfolio: null,
    },
    outputs: {
      date: etDate(spec.startedAt),
      paper: true,
      results: [result],
      pass: verdict === 'PASS' ? 1 : 0,
      block: verdict === 'PASS' ? 0 : 1,
      warnings: [],
      cash_after: cashAfter,
      today: {
        orders_placed: spec.tradesBefore,
        entries_placed: spec.tradesBefore,
        loss_at_risk: spec.riskUsedBefore,
      },
    },
    checks: verdict === 'PASS' ? [] : codes,
    summary: {
      code: verdict === 'PASS' ? 'risk.pass' : 'risk.block',
      values: verdict === 'PASS' ? values : { ...values, reasons },
      inLine,
      outLine:
        verdict === 'PASS'
          ? `PASS: max loss ${money(s.maxLoss)} (limit ${money(lim.maxLossPerTradeUsd ?? 0)}), reward:risk ${fmt(rr)}`
          : `BLOCK: ${reasons.join('; ')}`,
    },
  });
}

/** The Ticket the ticket step creates (shape of engine/levelset_engine/pipeline/tickets.py). */
export function ticketFor(spec: MockRunSpec, id: string, createdAt: string): Ticket {
  const { s, x, rr, reasons, codes, verdict, after } = riskResult(spec);
  const lim = fx.settings.limits;
  return {
    id,
    runId: spec.id,
    symbol: spec.ticker,
    side: 'buy',
    qty: s.qty,
    orderType: 'market',
    timeInForce: 'day',
    entry: x.entry,
    stop: x.stop,
    target: x.target,
    riskPerShare: s.risk,
    rewardPerShare: r2(x.target - x.entry),
    rMultiple: rr,
    maxLoss: s.maxLoss,
    positionUsd: s.cost,
    flatBy: lim.flatBy ?? '15:55',
    status: verdict === 'PASS' ? 'ready' : 'blocked',
    riskReasons: verdict === 'PASS' ? [] : codes,
    riskDetail:
      verdict === 'PASS'
        ? [
            `Stop present: ${fmt(x.stop)}`,
            `Loss at stop ${fmt(s.maxLoss)} <= max loss per trade ${fmt(lim.maxLossPerTradeUsd ?? 0)}`,
            `Reward:risk ${fmt(rr)} >= minimum ${fmt(lim.minRewardRisk ?? 0)}`,
            `Risk today ${fmt(after)} of daily limit ${fmt(lim.maxDailyLossUsd ?? 0)}`,
          ]
        : reasons,
    timeMachine: { ...spec.tm, verdict: tmVerdict(spec.tm, x.targetR) },
    createdAt,
  };
}

function ticketStep(spec: MockRunSpec, ticketId: string | null): Step {
  const { s, x, verdict, codes } = riskResult(spec);
  const ready = verdict === 'PASS';
  const plain = `BUY ${s.qty} ${spec.ticker}, market, good for today / stop-loss ${fmt(x.stop)} / take-profit ${fmt(x.target)} / max loss about ${money(s.maxLoss)} if the stop fills at ${fmt(x.stop)} (it can fill worse in a fast market)`;
  const status = ready ? 'ready' : 'blocked';
  return finished(spec, 'ticket', [16, 17], {
    status: ready ? 'done' : 'blocked',
    inputs: { orders: { orders: [bracket(spec, s)] }, risk: { verdict } },
    outputs: {
      tickets: [
        {
          index: 1,
          ready,
          status: ready
            ? 'READY: trader-risk PASS, waiting for your yes'
            : 'BLOCKED by trader-risk',
          plain,
          paper: true,
          broker: 'alpaca',
          tool: 'place_stock_order',
          tool_input: bracket(spec, s),
          bracket: true,
          max_loss: s.maxLoss,
          stop: x.stop,
        },
      ],
    },
    checks: ready ? [] : codes,
    summary: {
      code: `ticket.${status}`,
      values: {
        ticketId,
        status,
        symbol: spec.ticker,
        qty: s.qty,
        entry: x.entry,
        stop: x.stop,
        target: x.target,
        maxLoss: s.maxLoss,
        ready,
      },
      inLine: plain,
      outLine: `BUY ${s.qty} ${spec.ticker}: entry ${fmt(x.entry)}, stop loss ${fmt(x.stop)}, take profit ${fmt(x.target)} (${status.toUpperCase()})`,
    },
  });
}

/** One finished step for a spec, exactly as the engine would produce it. */
export function buildStep(spec: MockRunSpec, key: StepKey, ticketId: string | null = null): Step {
  switch (key) {
    case 'scanner':
      return scannerStep(spec);
    case 'news':
      return newsStep(spec);
    case 'entry':
      return entryStep(spec);
    case 'exit':
      return exitStep(spec);
    case 'timemachine':
      return tmStep(spec);
    case 'budget':
      return budgetStep(spec);
    case 'risk':
      return riskStep(spec);
    case 'ticket':
      return ticketStep(spec, ticketId);
  }
}

/** A step that ends a run-all (the engine's `halt`): entry waiting / expired / errors, budget refusal. */
export function halts(step: Step): boolean {
  if (step.status === 'error') return true;
  if (step.key === 'entry' && step.status !== 'done') return true;
  if (step.key === 'scanner' && step.checks?.includes('no_hits')) return true;
  if (step.key === 'budget' && step.status === 'blocked') return true;
  return false;
}

/** All eight steps of a run-all for a spec (pending after the step that halts). */
export function runAllSteps(spec: MockRunSpec): Step[] {
  const out: Step[] = [];
  let halted = false;
  for (const key of STEP_KEYS) {
    if (halted) {
      out.push(pendingStep(key, paramsOf(spec, key)));
      continue;
    }
    const step = buildStep(spec, key, spec.ticketId);
    out.push(step);
    halted = halts(step);
  }
  return out;
}

/** Run status, like engine/levelset_engine/pipeline/service.py aggregate(). */
export function aggregate(steps: Step[], mode: 'all' | 'step'): PipelineRunSummary['status'] {
  const sts = steps.map((s) => s.status);
  const fin = (s: string) => ['done', 'check', 'blocked', 'error'].includes(s);
  if (sts.includes('running')) return 'running';
  if (sts.includes('error')) return 'error';
  if (sts.includes('blocked')) return 'blocked';
  if (sts.every(fin)) return sts.includes('check') ? 'check' : 'done';
  if (mode === 'all' && sts.some(fin)) return 'check';
  return 'pending';
}

/** Scenario and numbers for a ticker typed in the start panel. */
export function specFor(id: string, ticker: string | undefined, startedAt: string): MockRunSpec {
  const sym = (ticker || 'TSLA').toUpperCase();
  const base = { id, ticker: sym, startedAt, riskUsedBefore: 48, tradesBefore: 1, ticketId: null };
  if (sym === 'TSLA')
    return {
      ...base,
      scenario: 'ready',
      orHigh: fx.TSLA.orHigh,
      orLow: fx.TSLA.orLow,
      entry: fx.TSLA.entry,
      tm: { ...fx.TSLA.timeMachine },
      earnings: true,
    };
  if (sym === 'AMD')
    return {
      ...base,
      scenario: 'blocked',
      orHigh: 157.9,
      orLow: 150.7,
      entry: 158.4,
      tm: { ...(fx.amdTicket.timeMachine as Tm) },
      params: { exit: { target: '2R' } },
    };
  if (sym === 'NVDA') return { ...base, ...NVDA_WAITING, id, startedAt };
  return {
    ...base,
    scenario: 'no_data',
    orHigh: 100,
    orLow: 98,
    entry: 100.5,
    tm: { ...fx.TSLA.timeMachine },
  };
}

const NVDA_WAITING: Omit<MockRunSpec, 'id' | 'startedAt' | 'ticker'> & { ticker: string } = {
  ticker: 'NVDA',
  scenario: 'waiting',
  orHigh: 186.9,
  orLow: 183.05,
  entry: 187.05,
  lastClose: 186.12,
  tm: {
    targetFirstPct: 33.8,
    stopFirstPct: 30.9,
    openAtClosePct: 35.3,
    verdict: 'coin_flip',
    historyFired: 24,
    historyWon: 10,
    historyLost: 11,
  },
  riskUsedBefore: 48,
  tradesBefore: 1,
  ticketId: null,
};

// ---------------------------------------------------------------- the stored history

export const NVDA_WAIT_RUN_ID = 'run_20261019_1001_nvda';

/** Specs of the runs the demo starts with (same ids and tickets as fixtures.ts). */
export const HISTORY_SPECS: MockRunSpec[] = [
  {
    id: fx.TSLA_RUN_ID,
    ticker: 'TSLA',
    startedAt: fx.et('10:14', '42'),
    scenario: 'ready',
    orHigh: fx.TSLA.orHigh,
    orLow: fx.TSLA.orLow,
    entry: fx.TSLA.entry,
    tm: { ...fx.TSLA.timeMachine },
    riskUsedBefore: 48,
    tradesBefore: 1,
    ticketId: fx.TSLA_TICKET_ID,
    earnings: true,
  },
  {
    id: fx.AMD_RUN_ID,
    ticker: 'AMD',
    startedAt: fx.et('10:12', '19'),
    scenario: 'blocked',
    orHigh: 157.9,
    orLow: 150.7,
    entry: 158.4,
    tm: { ...(fx.amdTicket.timeMachine as Tm) },
    riskUsedBefore: 48,
    tradesBefore: 1,
    ticketId: fx.AMD_TICKET_ID,
    params: { exit: { target: '2R' } },
  },
  {
    ...NVDA_WAITING,
    id: NVDA_WAIT_RUN_ID,
    startedAt: fx.et('10:01', '30'),
  },
  {
    id: fx.META_RUN_ID,
    ticker: 'META',
    startedAt: fx.et('09:48', '05'),
    scenario: 'ready',
    orHigh: 711.9,
    orLow: 696.4,
    entry: 712.4,
    tm: {
      targetFirstPct: 41.3,
      stopFirstPct: 27.9,
      openAtClosePct: 30.8,
      verdict: 'favorable',
      historyFired: 18,
      historyWon: 9,
      historyLost: 6,
    },
    riskUsedBefore: 0,
    tradesBefore: 0,
    ticketId: null,
    params: { exit: { stop: 'price:704.4', target: '2R' } },
  },
  {
    id: fx.NVDA_RUN_ID,
    ticker: 'NVDA',
    startedAt: '2026-10-16T10:05:10-04:00',
    scenario: 'ready',
    orHigh: 181.4,
    orLow: 178.2,
    entry: 181.9,
    tm: {
      targetFirstPct: 35.0,
      stopFirstPct: 33.1,
      openAtClosePct: 31.9,
      verdict: 'coin_flip',
      historyFired: 27,
      historyWon: 11,
      historyLost: 12,
    },
    riskUsedBefore: 0,
    tradesBefore: 0,
    ticketId: null,
    params: { exit: { stop: 'price:179.8', target: '2R' } },
  },
];

export function runFromSpec(spec: MockRunSpec): PipelineRun {
  const steps = runAllSteps(spec);
  const mode = spec.mode ?? 'all';
  const status = aggregate(steps, mode);
  const last = [...steps].reverse().find((s) => s.endedAt);
  return {
    id: spec.id,
    ticker: spec.ticker,
    setup: spec.setup ?? 'orb',
    mode,
    status,
    startedAt: spec.startedAt,
    endedAt: last?.endedAt ?? null,
    ticketId: spec.ticketId,
    steps,
  };
}

/** The runs the mock db starts with, newest first. */
export function historyRuns(): PipelineRun[] {
  return HISTORY_SPECS.map(runFromSpec);
}

// ---------------------------------------------------------------- bars (GET /bars)

/** TSLA 2026-10-19 5-minute bars from the trader-entry fixture (t = bar start, Unix seconds). */
export const TSLA_BARS: Bar[] = [
  { t: 1792416600, o: 357.48, h: 362.18, l: 354.47, c: 359.18, v: 3080684 },
  { t: 1792416900, o: 359.2, h: 360.02, l: 356.37, c: 358.27, v: 964899 },
  { t: 1792417200, o: 358.15, h: 361.22, l: 357.89, c: 360.39, v: 931253 },
  { t: 1792417500, o: 360.37, h: 361.51, l: 359.38, c: 361.45, v: 794838 },
  { t: 1792417800, o: 361.45, h: 362.92, l: 359.46, c: 361.07, v: 1207272 },
  { t: 1792418100, o: 361.01, h: 362.9, l: 360.86, c: 361.92, v: 805723 },
  { t: 1792418400, o: 361.92, h: 362.18, l: 360.02, c: 361.47, v: 617820 },
  { t: 1792418700, o: 361.49, h: 361.88, l: 360.42, c: 361.68, v: 558955 },
  { t: 1792419000, o: 361.68, h: 364.39, l: 361.37, c: 364.18, v: 1000057 },
  { t: 1792419300, o: 364.21, h: 365.18, l: 363.0, c: 365.05, v: 982318 },
  { t: 1792419600, o: 365.05, h: 365.88, l: 364.4, c: 365.75, v: 739146 },
  { t: 1792419900, o: 365.74, h: 366.74, l: 365.4, c: 365.85, v: 748942 },
  { t: 1792420200, o: 365.89, h: 366.21, l: 365.31, c: 365.75, v: 13232032 },
  { t: 1792420500, o: 365.74, h: 366.49, l: 365.11, c: 365.7, v: 512101 },
  { t: 1792420800, o: 365.72, h: 366.78, l: 365.63, c: 366.11, v: 594767 },
  { t: 1792421100, o: 366.21, h: 367.6, l: 366.2, c: 366.68, v: 618280 },
];
export const SESSION_OPEN = 1792416600; // 2026-10-19 09:30 ET

/** Deterministic 5-minute bars for the other demo symbols: a range, then a drift to `last`. */
function syntheticBars(
  orLow: number,
  orHigh: number,
  last: number,
  count: number,
  seed: number,
): Bar[] {
  const out: Bar[] = [];
  let prev = r2((orLow + orHigh) / 2);
  for (let i = 0; i < count; i += 1) {
    const wiggle = (((seed * (i + 3) * 7919) % 100) / 100 - 0.5) * (orHigh - orLow) * 0.3;
    let c: number;
    if (i === 0) c = r2(orLow + (orHigh - orLow) * 0.55);
    else if (i < 3) c = r2(Math.min(orHigh, Math.max(orLow, prev + wiggle)));
    else c = r2(prev + (last - prev) / Math.max(1, count - i) + wiggle * 0.3);
    if (i === count - 1) c = last;
    const o = prev;
    let h = r2(Math.max(o, c) + Math.abs(wiggle) * 0.4 + 0.02);
    let l = r2(Math.min(o, c) - Math.abs(wiggle) * 0.4 - 0.02);
    if (i === 0) {
      h = orHigh;
      l = orLow;
    } else if (i < 3) {
      h = Math.min(h, orHigh);
      l = Math.max(l, orLow);
    } else if (h > orHigh && c <= orHigh) h = r2(Math.min(h, orHigh + (orHigh - orLow) * 0.05));
    out.push({
      t: SESSION_OPEN + i * 300,
      o,
      h,
      l,
      c,
      v: 400000 + ((seed * 977 * (i + 1)) % 600000),
    });
    prev = c;
  }
  return out;
}

/** Bars the mock serves per symbol (unrestricted; the handler cuts them at the demo clock). */
export function mockBars(symbol: string): Bar[] | null {
  const s = symbol.toUpperCase();
  if (s === 'TSLA') return TSLA_BARS;
  if (s === 'NVDA') return syntheticBars(183.05, 186.9, 186.12, 16, 7);
  if (s === 'AMD') return syntheticBars(150.7, 157.9, 158.4, 16, 3);
  if (s === 'META') return syntheticBars(696.4, 711.9, 716.95, 16, 5);
  const h = ORB_HITS.find((x) => x.symbol === s);
  if (h) return syntheticBars(h.or_low, h.or_high, h.price, 9, s.charCodeAt(0));
  return null;
}

/** When the entry triggered: the run start rounded up to the next 5-minute bar close (10:14:42 -> 10:15). */
function trigIso(spec: MockRunSpec): string {
  const d = new Date(spec.startedAt).getTime();
  const step = 5 * 60 * 1000;
  return addSec(spec.startedAt, (Math.ceil(d / step) * step - d) / 1000);
}
