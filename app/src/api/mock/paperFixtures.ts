/**
 * Paper account demo data for the mock engine (v1.1, docs/V1.1-PRD.md §3).
 *
 * "Paper 1" follows every signal: an old period (reset on Sep 25) and the current period from
 * Sep 28 with a few weeks of closed trades, skipped entries and one backfilled day. Today
 * (2026-10-19) matches the TSLA demo: the 10:15 ticket (364.18 / 358.32 / 370.04, 8 shares) is
 * filled at the next bar's open (364.21) plus slippage (0.02 % + $0.01) = 364.29, and the AMD
 * ticket is skipped because risk blocked it. The ticket's own levels never change.
 * Everything here is deterministic (no Math.random), so tests and screenshots are stable.
 */
import type {
  PaperAccount,
  PaperPeriod,
  PaperPosition,
  PaperSettings,
  PaperTrade,
  Ticket,
  TicketPaper,
} from '../types';
import * as fx from './fixtures';

export const PAPER_ACCOUNT_ID = 'pacc_1';
export const PAPER_ACCOUNT_2_ID = 'pacc_2';
export const PAPER_PERIOD_OLD_ID = 'pper_1_1';
export const PAPER_PERIOD_ID = 'pper_1_2';
export const PAPER_PERIOD_2_ID = 'pper_2_1';
export const TSLA_PAPER_ID = 'ppos_20261019_tsla';
/** Next 5-minute bar open after the TSLA ticket (10:15 bar, mock TSLA_BARS) and its paper fill. */
export const TSLA_PAPER_BAR_OPEN = 364.21;
export const TSLA_PAPER_FILL = 364.29;
/** Demo quote at 10:15 ET (watchlist price). */
const TSLA_LAST = 364.18;

/** A recorded manual round trip (buy then sell), used for "Signals vs. you". */
export interface ManualRoundTrip {
  date: string;
  symbol: string;
  pnl: number;
  r: number | null;
}

export interface PaperMockState {
  settings: PaperSettings;
  /** Stored accounts; derived numbers (cash, equity, P/L, periods' totals) are filled on read. */
  accounts: PaperAccount[];
  positions: PaperPosition[];
  trades: PaperTrade[];
  manual: ManualRoundTrip[];
  seq: number;
}

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const etAt = (date: string, hhmm: string) => `${date}T${hhmm}:00-04:00`;

export const DEFAULT_PAPER_SETTINGS: PaperSettings = {
  autoFollow: true,
  slippagePct: 0.02,
  slippagePerShare: 0.01,
};

/** Buy fill: never better than the bar allows (open + % + $/share). */
export function buyFill(open: number, s: PaperSettings): number {
  return r2(open * (1 + s.slippagePct / 100) + s.slippagePerShare);
}
export function sellFill(price: number, s: PaperSettings): number {
  return r2(price * (1 - s.slippagePct / 100) - s.slippagePerShare);
}

// ---------------------------------------------------------------- history generator

const HOLIDAYS = new Set(['2026-09-07']);

function tradingDays(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`).getTime();
  while (d.getTime() <= end) {
    const iso = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const SYMBOLS: { symbol: string; price: number }[] = [
  { symbol: 'TSLA', price: 352 },
  { symbol: 'NVDA', price: 178 },
  { symbol: 'AMD', price: 152 },
  { symbol: 'META', price: 701 },
  { symbol: 'AAPL', price: 247 },
];
/** Gross R per trade, cycled: stops, 1R/2R targets and flat-by exits in between. */
const OUTCOMES = [1.0, -1.03, 2.0, -1.0, 0.42, 1.0, -1.06, -0.35, 2.0, -1.0, 1.0, 0.18, -1.02];
const TRADES_PER_DAY = [1, 2, 1, 0, 1, 2, 1, 1, 2, 0, 1];
const ENTRY_TIMES = ['09:50', '10:05', '10:20', '10:45', '11:30', '13:10', '14:25'];

function addMinutes(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(h * 60 + m + min, 15 * 60 + 55);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

interface GenCtx {
  n: number;
  accountId: string;
  periodId: string;
  backfilledDays: Set<string>;
}

function closedTrade(
  ctx: GenCtx,
  date: string,
  k: number,
  sym: { symbol: string; price: number },
): PaperTrade {
  const s = DEFAULT_PAPER_SETTINGS;
  const i = ctx.n++;
  const grossR = OUTCOMES[i % OUTCOMES.length];
  const drift = 1 + (((i * 37) % 11) - 5) / 100;
  const open = r2(sym.price * drift);
  const risk = r2(open * 0.012);
  const qty = Math.max(1, Math.min(Math.floor(50 / risk), Math.floor(5000 / open)));
  const entryPrice = buyFill(open, s);
  const exitReason = grossR <= -0.9 ? 'stop' : grossR >= 0.95 ? 'target' : 'flat_by';
  const rawExit = r2(open + grossR * risk);
  const exitPrice = sellFill(rawExit, s);
  const pnl = r2((exitPrice - entryPrice) * qty);
  const slippageUsd = r2((entryPrice - open + (rawExit - exitPrice)) * qty);
  const entryHhmm = ENTRY_TIMES[(i + k * 3) % ENTRY_TIMES.length];
  const exitHhmm =
    exitReason === 'flat_by' ? '15:55' : addMinutes(entryHhmm, 20 + ((i * 29) % 130));
  const runId = `run_${date.replace(/-/g, '')}_${entryHhmm.replace(':', '')}_${sym.symbol.toLowerCase()}`;
  return {
    id: `ptr_${date.replace(/-/g, '')}_${k}_${sym.symbol.toLowerCase()}`,
    accountId: ctx.accountId,
    periodId: ctx.periodId,
    kind: 'closed',
    symbol: sym.symbol,
    setup: i % 5 === 3 ? 'level' : 'orb',
    qty,
    ticketId: runId.replace('run_', 'tkt_'),
    runId,
    entryAt: etAt(date, entryHhmm),
    entryPrice,
    exitAt: etAt(date, exitHhmm),
    exitPrice,
    exitReason,
    rMultiple: r2(pnl / (risk * qty)),
    pnl,
    slippageUsd,
    skipReason: null,
    backfilled: ctx.backfilledDays.has(date),
    createdAt: etAt(date, addMinutes(entryHhmm, -1)),
  };
}

function skippedTrade(
  ctx: GenCtx,
  date: string,
  hhmm: string,
  symbol: string,
  reason: 'blocked' | 'stale' | 'duplicate',
  qty: number,
): PaperTrade {
  const runId = `run_${date.replace(/-/g, '')}_${hhmm.replace(':', '')}_${symbol.toLowerCase()}`;
  return {
    id: `pskp_${date.replace(/-/g, '')}_${hhmm.replace(':', '')}_${symbol.toLowerCase()}`,
    accountId: ctx.accountId,
    periodId: ctx.periodId,
    kind: 'skipped',
    symbol,
    setup: 'orb',
    qty,
    ticketId: runId.replace('run_', 'tkt_'),
    runId,
    entryAt: null,
    entryPrice: null,
    exitAt: null,
    exitPrice: null,
    exitReason: null,
    rMultiple: null,
    pnl: null,
    slippageUsd: null,
    skipReason: reason,
    backfilled: ctx.backfilledDays.has(date),
    createdAt: etAt(date, hhmm),
  };
}

function generate(ctx: GenCtx, days: string[]): PaperTrade[] {
  const out: PaperTrade[] = [];
  days.forEach((date, d) => {
    const count = TRADES_PER_DAY[d % TRADES_PER_DAY.length];
    for (let k = 0; k < count; k += 1) {
      const sym = SYMBOLS[(d * 2 + k * 3) % SYMBOLS.length];
      out.push(closedTrade(ctx, date, k, sym));
    }
    if (d % 6 === 4) out.push(skippedTrade(ctx, date, '11:05', 'AMD', 'blocked', 12));
    if (d % 9 === 7) out.push(skippedTrade(ctx, date, '10:35', 'META', 'duplicate', 6));
  });
  return out;
}

// ---------------------------------------------------------------- fresh state

function nvdaPaperTrade(): PaperTrade {
  // 2026-10-16: the NVDA ticket was ready then (stale only today); filled at the next bar's open.
  const s = DEFAULT_PAPER_SETTINGS;
  const t = fx.nvdaStaleTicket;
  const open = 181.95;
  const entryPrice = buyFill(open, s); // 182.00
  const exitPrice = sellFill(t.target, s); // 186.05
  const pnl = r2((exitPrice - entryPrice) * t.qty);
  return {
    id: 'ptr_20261016_nvda',
    accountId: PAPER_ACCOUNT_ID,
    periodId: PAPER_PERIOD_ID,
    kind: 'closed',
    symbol: 'NVDA',
    setup: 'orb',
    qty: t.qty,
    ticketId: t.id,
    runId: t.runId,
    entryAt: '2026-10-16T10:10:00-04:00',
    entryPrice,
    exitAt: '2026-10-16T13:40:00-04:00',
    exitPrice,
    exitReason: 'target',
    rMultiple: r2(pnl / (t.riskPerShare * t.qty)),
    pnl,
    slippageUsd: r2((entryPrice - open + (t.target - exitPrice)) * t.qty),
    skipReason: null,
    backfilled: false,
    createdAt: t.createdAt,
  };
}

function tslaPosition(): PaperPosition {
  const t = fx.tslaTicket;
  const unrealized = r2((TSLA_LAST - TSLA_PAPER_FILL) * t.qty);
  return {
    id: TSLA_PAPER_ID,
    accountId: PAPER_ACCOUNT_ID,
    periodId: PAPER_PERIOD_ID,
    runId: t.runId,
    setup: 'orb',
    symbol: t.symbol,
    qty: t.qty,
    avgPrice: TSLA_PAPER_FILL,
    lastPrice: TSLA_LAST,
    unrealizedPnl: unrealized,
    unrealizedR: r2(unrealized / t.maxLoss),
    stop: t.stop,
    target: t.target,
    flatBy: t.flatBy ?? '15:55',
    ticketId: t.id,
    entryAt: fx.et('10:15'),
    slippageUsd: r2((TSLA_PAPER_FILL - TSLA_PAPER_BAR_OPEN) * t.qty),
    backfilled: false,
  };
}

function amdSkipped(): PaperTrade {
  const t = fx.amdTicket;
  return {
    id: 'pskp_20261019_amd',
    accountId: PAPER_ACCOUNT_ID,
    periodId: PAPER_PERIOD_ID,
    kind: 'skipped',
    symbol: t.symbol,
    setup: 'orb',
    qty: t.qty,
    ticketId: t.id,
    runId: t.runId,
    entryAt: null,
    entryPrice: null,
    exitAt: null,
    exitPrice: null,
    exitReason: null,
    rMultiple: null,
    pnl: null,
    slippageUsd: null,
    skipReason: 'blocked',
    backfilled: false,
    createdAt: t.createdAt,
  };
}

function period(
  id: string,
  number: number,
  startedAt: string,
  endedAt: string | null,
  startingBalanceUsd: number,
): PaperPeriod {
  return { id, number, startingBalanceUsd, startedAt, endedAt, realizedPnl: 0, trades: 0 };
}

/** Manual round trips the user "recorded": fewer trades than the signals, earlier exits. */
function manualFrom(trades: PaperTrade[]): ManualRoundTrip[] {
  const out: ManualRoundTrip[] = [];
  trades
    .filter((t) => t.kind === 'closed' && t.periodId === PAPER_PERIOD_ID)
    .forEach((t, i) => {
      if (i % 3 === 2) return; // skipped that signal
      const pnl = t.pnl! > 0 ? r2(t.pnl! * 0.55) : r2(t.pnl! * (i % 2 ? 1.15 : 0.9));
      out.push({
        date: t.createdAt.slice(0, 10),
        symbol: t.symbol,
        pnl,
        r: i % 4 === 1 ? null : r2((t.rMultiple ?? 0) * (pnl / t.pnl!)),
      });
    });
  out.push({ date: '2026-10-14', symbol: 'PLTR', pnl: -31.2, r: null });
  out.push({ date: '2026-10-02', symbol: 'COIN', pnl: 18.4, r: null });
  return out;
}

export function freshPaper(): PaperMockState {
  const balance = fx.settings.account.accountSizeUsd;
  const oldCtx: GenCtx = {
    n: 0,
    accountId: PAPER_ACCOUNT_ID,
    periodId: PAPER_PERIOD_OLD_ID,
    backfilledDays: new Set(),
  };
  const curCtx: GenCtx = {
    n: 5,
    accountId: PAPER_ACCOUNT_ID,
    periodId: PAPER_PERIOD_ID,
    backfilledDays: new Set(['2026-10-08']),
  };
  const old = generate(oldCtx, tradingDays('2026-08-31', '2026-09-25'));
  const cur = generate(curCtx, tradingDays('2026-09-28', '2026-10-15'));
  const trades = [...old, ...cur, nvdaPaperTrade(), amdSkipped()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const accounts: PaperAccount[] = [
    {
      id: PAPER_ACCOUNT_ID,
      name: 'Paper 1',
      active: true,
      startingBalanceUsd: balance,
      cashUsd: balance,
      equityUsd: balance,
      realizedPnl: 0,
      unrealizedPnl: 0,
      openPositions: 0,
      currentPeriodId: PAPER_PERIOD_ID,
      periods: [
        period(
          PAPER_PERIOD_OLD_ID,
          1,
          '2026-08-31T09:00:00-04:00',
          '2026-09-25T16:05:00-04:00',
          balance,
        ),
        period(PAPER_PERIOD_ID, 2, '2026-09-25T16:05:00-04:00', null, balance),
      ],
      createdAt: '2026-08-31T09:00:00-04:00',
    },
    {
      id: PAPER_ACCOUNT_2_ID,
      name: 'Paper 2',
      active: false,
      startingBalanceUsd: 5000,
      cashUsd: 5000,
      equityUsd: 5000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      openPositions: 0,
      currentPeriodId: PAPER_PERIOD_2_ID,
      periods: [period(PAPER_PERIOD_2_ID, 1, '2026-10-12T08:30:00-04:00', null, 5000)],
      createdAt: '2026-10-12T08:30:00-04:00',
    },
  ];
  return {
    settings: { ...DEFAULT_PAPER_SETTINGS },
    accounts,
    positions: [tslaPosition()],
    trades,
    manual: manualFrom(trades),
    seq: 100,
  };
}

// ---------------------------------------------------------------- Ticket.paper

/** The auto-follow outcome for a ticket in the active account, or undefined (left out). */
export function ticketPaperOf(state: PaperMockState, ticketId: string): TicketPaper | undefined {
  const pos = state.positions.find((p) => p.ticketId === ticketId);
  if (pos)
    return {
      status: 'opened',
      accountId: pos.accountId,
      positionId: pos.id,
      entryPrice: pos.avgPrice,
      exitPrice: null,
      exitReason: null,
      pnl: null,
      rMultiple: null,
      skipReason: null,
      backfilled: pos.backfilled,
    };
  const tr = state.trades.find((x) => x.ticketId === ticketId);
  if (!tr) return undefined;
  return {
    status: tr.kind,
    accountId: tr.accountId,
    positionId: tr.kind === 'closed' ? tr.id : null,
    entryPrice: tr.entryPrice,
    exitPrice: tr.exitPrice,
    exitReason: tr.exitReason,
    pnl: tr.pnl,
    rMultiple: tr.rMultiple,
    skipReason: tr.skipReason,
    backfilled: tr.backfilled,
  };
}

/** Fill in `paper` on each ticket (left out when the account never handled it). */
export function withTicketPaper(tickets: Ticket[], state: PaperMockState): Ticket[] {
  return tickets.map((t) => {
    const { paper: _old, ...rest } = t;
    const paper = ticketPaperOf(state, t.id);
    return paper ? { ...rest, paper } : rest;
  });
}
