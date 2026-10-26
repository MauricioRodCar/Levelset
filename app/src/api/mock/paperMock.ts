/**
 * Paper account endpoints of the mock engine (docs/api/openapi.yaml, /paper/*), auto-follow for
 * tickets made by the pipeline simulation, and the dashboard's paperPnlToday.
 * Mirrors the engine rules: fills at the next bar's open plus slippage, one open position per
 * symbol, blocked / stale tickets are logged as skipped, reset closes open positions ("reset").
 */
import { http, HttpResponse, type JsonBodyType } from 'msw';
import type {
  PaperAccount,
  PaperAccountCreate,
  PaperAccountReset,
  PaperBreakdownRow,
  PaperCompareRow,
  PaperCompareSide,
  PaperComparison,
  PaperEquityPoint,
  PaperGroupBy,
  PaperPosition,
  PaperSettingsUpdate,
  PaperStats,
  PaperTrade,
  Ticket,
} from '../types';
import { db, demoNow, toEtIso } from './db';
import { mockEmit } from './eventBus';
import {
  buyFill,
  r2,
  sellFill,
  ticketPaperOf,
  withTicketPaper,
  type ManualRoundTrip,
  type PaperMockState,
} from './paperFixtures';

const json = <T extends JsonBodyType>(data: T, status = 200) => HttpResponse.json(data, { status });
const problem = (status: number, code: string, title: string, detail?: string) =>
  HttpResponse.json(
    { title, detail, code },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

const st = (): PaperMockState => db.paper;
const dayOf = (iso: string) => iso.slice(0, 10);
const today = () => dayOf(toEtIso(demoNow()));

function pid(prefix: string) {
  st().seq += 1;
  return `${prefix}_demo_${st().seq}`;
}

// ---------------------------------------------------------------- accounts

/** Account with the derived numbers (cash, equity, P/L, per-period totals). */
export function accountView(a: PaperAccount): PaperAccount {
  const closed = st().trades.filter((t) => t.accountId === a.id && t.kind === 'closed');
  const periods = a.periods.map((p) => {
    const mine = closed.filter((t) => t.periodId === p.id);
    return {
      ...p,
      trades: mine.length,
      realizedPnl: r2(mine.reduce((s, t) => s + (t.pnl ?? 0), 0)),
    };
  });
  const cur = periods[periods.length - 1];
  const open = st().positions.filter((p) => p.accountId === a.id);
  const unrealized = r2(open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0));
  const cash = r2(cur.startingBalanceUsd + cur.realizedPnl);
  return {
    ...a,
    periods,
    currentPeriodId: cur.id,
    startingBalanceUsd: cur.startingBalanceUsd,
    realizedPnl: cur.realizedPnl,
    unrealizedPnl: unrealized,
    cashUsd: cash,
    equityUsd: r2(cash + unrealized),
    openPositions: open.length,
  };
}

const activeAccount = () => st().accounts.find((a) => a.active) ?? st().accounts[0];

function resolveAccount(id: string | null): PaperAccount | null {
  if (!id) return activeAccount();
  return st().accounts.find((a) => a.id === id) ?? null;
}

function refreshTickets() {
  db.tickets = withTicketPaper(db.tickets, st());
}

function closePosition(p: PaperPosition, reason: 'reset'): PaperTrade {
  const s = st().settings;
  const price = p.lastPrice ?? p.avgPrice;
  const exitPrice = sellFill(price, s);
  const pnl = r2((exitPrice - p.avgPrice) * p.qty);
  const ticket = db.tickets.find((t) => t.id === p.ticketId);
  const riskUsd = ticket ? ticket.riskPerShare * ticket.qty : null;
  const now = toEtIso(demoNow());
  return {
    id: p.id,
    accountId: p.accountId,
    periodId: p.periodId,
    kind: 'closed',
    symbol: p.symbol,
    setup: p.setup,
    qty: p.qty,
    ticketId: p.ticketId ?? '',
    runId: p.runId,
    entryAt: p.entryAt,
    entryPrice: p.avgPrice,
    exitAt: now,
    exitPrice,
    exitReason: reason,
    rMultiple: riskUsd ? r2(pnl / riskUsd) : null,
    pnl,
    slippageUsd: r2(p.slippageUsd + (price - exitPrice) * p.qty),
    skipReason: null,
    backfilled: false,
    createdAt: p.entryAt,
  };
}

// ---------------------------------------------------------------- filters + stats

interface Range {
  account: PaperAccount;
  periodId: string;
  from: string | null;
  to: string | null;
}

function parseRange(url: URL): Range | Response {
  const account = resolveAccount(url.searchParams.get('accountId'));
  if (!account) return problem(404, 'paper_account_not_found', 'Paper account not found');
  const periodId = url.searchParams.get('periodId') ?? account.currentPeriodId;
  if (periodId !== 'all' && !account.periods.some((p) => p.id === periodId))
    return problem(422, 'validation_error', 'Unknown period', periodId);
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if ((from && !date.test(from)) || (to && !date.test(to)))
    return problem(422, 'validation_error', 'from / to must be YYYY-MM-DD');
  return { account, periodId, from, to };
}

function inRange(t: PaperTrade, r: Range): boolean {
  if (t.accountId !== r.account.id) return false;
  if (r.periodId !== 'all' && t.periodId !== r.periodId) return false;
  const d = dayOf(t.createdAt);
  return (!r.from || d >= r.from) && (!r.to || d <= r.to);
}

function tradesIn(r: Range, kind: string | null, symbol?: string | null): PaperTrade[] {
  return st()
    .trades.filter((t) => inRange(t, r))
    .filter((t) => !kind || kind === 'all' || t.kind === kind)
    .filter((t) => !symbol || t.symbol === symbol.toUpperCase())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function groupKey(t: PaperTrade, by: PaperGroupBy): string {
  const at = t.entryAt ?? t.createdAt;
  if (by === 'ticker') return t.symbol;
  if (by === 'setup') return t.setup ?? 'orb';
  if (by === 'hour') return at.slice(11, 13);
  return WEEKDAYS[new Date(`${dayOf(at)}T12:00:00Z`).getUTCDay()];
}

function summarize(list: PaperTrade[]) {
  const wins = list.filter((t) => (t.pnl ?? 0) > 0);
  const losses = list.filter((t) => (t.pnl ?? 0) < 0);
  const rs = list.map((t) => t.rMultiple).filter((x): x is number => x != null);
  const mean = (xs: number[]) => (xs.length ? r2(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  return {
    trades: list.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: list.length ? r2((wins.length / list.length) * 100) : null,
    totalPnl: r2(list.reduce((s, t) => s + (t.pnl ?? 0), 0)),
    expectancyR: mean(rs),
    avgWinR: mean(wins.map((t) => t.rMultiple ?? 0)),
    avgLossR: mean(losses.map((t) => t.rMultiple ?? 0)),
    grossWin: wins.reduce((s, t) => s + (t.pnl ?? 0), 0),
    grossLoss: Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0)),
  };
}

export function paperStats(r: Range, groupBy: PaperGroupBy | null): PaperStats {
  const all = tradesIn(r, null);
  const closed = all
    .filter((t) => t.kind === 'closed')
    .sort((a, b) => (a.exitAt ?? '').localeCompare(b.exitAt ?? ''));
  const periods = r.account.periods;
  const first = r.periodId === 'all' ? periods[0] : periods.find((p) => p.id === r.periodId)!;
  const start = first.startingBalanceUsd;
  const sum = summarize(closed);
  const curve: PaperEquityPoint[] = [
    { t: r.from ? `${r.from}T09:30:00-04:00` : first.startedAt, equityUsd: start, tradeId: null },
  ];
  let eq = start;
  let peak = start;
  let ddUsd = 0;
  let ddPct = 0;
  let streak = 0;
  let longest = 0;
  for (const t of closed) {
    eq = r2(eq + (t.pnl ?? 0));
    curve.push({ t: t.exitAt!, equityUsd: eq, tradeId: t.id });
    peak = Math.max(peak, eq);
    if (peak - eq > ddUsd) {
      ddUsd = r2(peak - eq);
      ddPct = r2(((peak - eq) / peak) * 100);
    }
    streak = (t.pnl ?? 0) < 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const breakdown: PaperBreakdownRow[] = [];
  if (groupBy) {
    const groups = new Map<string, PaperTrade[]>();
    for (const t of closed) {
      const k = groupKey(t, groupBy);
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    const order = (k: string) => (groupBy === 'weekday' ? String(WEEKDAYS.indexOf(k)) : k);
    for (const k of [...groups.keys()].sort((a, b) => order(a).localeCompare(order(b)))) {
      const s = summarize(groups.get(k)!);
      breakdown.push({
        key: k,
        trades: s.trades,
        wins: s.wins,
        losses: s.losses,
        winRatePct: s.winRatePct,
        totalPnl: s.totalPnl,
        expectancyR: s.expectancyR,
      });
    }
  }
  return {
    accountId: r.account.id,
    periodId: r.periodId,
    from: r.from,
    to: r.to,
    startingBalanceUsd: start,
    endingEquityUsd: eq,
    totalPnl: sum.totalPnl,
    trades: sum.trades,
    wins: sum.wins,
    losses: sum.losses,
    skipped: all.filter((t) => t.kind === 'skipped').length,
    winRatePct: sum.winRatePct,
    expectancyR: sum.expectancyR,
    avgWinR: sum.avgWinR,
    avgLossR: sum.avgLossR,
    profitFactor: sum.grossLoss > 0 ? r2(sum.grossWin / sum.grossLoss) : null,
    maxDrawdownUsd: ddUsd,
    maxDrawdownPct: ddPct,
    longestLosingStreak: longest,
    equityCurve: curve,
    groupBy,
    breakdown,
  };
}

function side(list: { pnl: number; r: number | null }[]): PaperCompareSide {
  const wins = list.filter((x) => x.pnl > 0).length;
  const rs = list.map((x) => x.r);
  return {
    trades: list.length,
    pnl: r2(list.reduce((s, x) => s + x.pnl, 0)),
    rTotal:
      rs.length && rs.every((x) => x != null)
        ? r2((rs as number[]).reduce((s, x) => s + x, 0))
        : null,
    winRatePct: list.length ? r2((wins / list.length) * 100) : null,
  };
}

function compare(r: Range): PaperComparison {
  const paper = tradesIn(r, 'closed');
  // manual fills belong to the user, not to a paper account: same dates as the selected range
  const per = r.periodId === 'all' ? null : r.account.periods.find((p) => p.id === r.periodId)!;
  const manual: ManualRoundTrip[] = st().manual.filter(
    (m) =>
      (!r.from || m.date >= r.from) &&
      (!r.to || m.date <= r.to) &&
      (!per || (m.date >= dayOf(per.startedAt) && (!per.endedAt || m.date <= dayOf(per.endedAt)))),
  );
  const keys = new Set<string>();
  paper.forEach((t) => keys.add(`${dayOf(t.createdAt)}|${t.symbol}`));
  manual.forEach((m) => keys.add(`${m.date}|${m.symbol}`));
  const rows: PaperCompareRow[] = [...keys]
    .sort((a, b) => b.localeCompare(a))
    .map((k) => {
      const [date, symbol] = k.split('|');
      const p = paper
        .filter((t) => dayOf(t.createdAt) === date && t.symbol === symbol)
        .map((t) => ({ pnl: t.pnl ?? 0, r: t.rMultiple }));
      const m = manual.filter((x) => x.date === date && x.symbol === symbol);
      return { date, symbol, paper: p.length ? side(p) : null, manual: m.length ? side(m) : null };
    });
  const matched = new Set(
    rows.filter((x) => x.paper && x.manual).map((x) => `${x.date}|${x.symbol}`),
  );
  const isMatched = (date: string, symbol: string) => matched.has(`${date}|${symbol}`);
  return {
    accountId: r.account.id,
    from: r.from,
    to: r.to,
    rows,
    totals: {
      matched: matched.size,
      paperOnly: rows.filter((x) => x.paper && !x.manual).length,
      manualOnly: rows.filter((x) => !x.paper && x.manual).length,
      paper: side(
        paper
          .filter((t) => isMatched(dayOf(t.createdAt), t.symbol))
          .map((t) => ({ pnl: t.pnl ?? 0, r: t.rMultiple })),
      ),
      manual: side(manual.filter((m) => isMatched(m.date, m.symbol))),
    },
  };
}

const CSV_COLUMNS = [
  'id',
  'accountId',
  'periodId',
  'kind',
  'symbol',
  'setup',
  'qty',
  'entryAt',
  'entryPrice',
  'exitAt',
  'exitPrice',
  'exitReason',
  'rMultiple',
  'pnl',
  'slippageUsd',
  'skipReason',
  'backfilled',
  'ticketId',
  'runId',
  'createdAt',
] as const;

export function paperCsv(rows: PaperTrade[]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    CSV_COLUMNS.join(','),
    ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(',')),
  ].join('\n');
}

/** Dashboard tile: today's realized + unrealized P/L of the active account (null when idle). */
export function paperPnlToday(): number | null {
  const a = activeAccount();
  const day = today();
  const closed = st().trades.filter(
    (t) => t.accountId === a.id && t.kind === 'closed' && t.exitAt && dayOf(t.exitAt) === day,
  );
  const open = st().positions.filter((p) => p.accountId === a.id);
  if (!st().settings.autoFollow && !closed.length && !open.length) return null;
  return r2(
    closed.reduce((s, t) => s + (t.pnl ?? 0), 0) +
      open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0),
  );
}

// ---------------------------------------------------------------- auto-follow (pipeline sim)

/**
 * Called by the pipeline simulation when a ticket is made. Ready tickets open a paper position at
 * the next bar's open + slippage; blocked / stale / duplicate ones are logged as skipped.
 * Returns the ticket with `paper` filled in (unchanged while auto-follow is off).
 */
export function paperFollow(ticket: Ticket): Ticket {
  const s = st().settings;
  if (!s.autoFollow) return ticket;
  const a = accountView(activeAccount());
  const now = toEtIso(demoNow());
  const duplicate = st().positions.some((p) => p.accountId === a.id && p.symbol === ticket.symbol);
  const skip = ticket.status !== 'ready' ? ticket.status : duplicate ? 'duplicate' : null;
  if (skip) {
    const tr: PaperTrade = {
      id: pid('pskp'),
      accountId: a.id,
      periodId: a.currentPeriodId,
      kind: 'skipped',
      symbol: ticket.symbol,
      setup: 'orb',
      qty: ticket.qty,
      ticketId: ticket.id,
      runId: ticket.runId,
      entryAt: null,
      entryPrice: null,
      exitAt: null,
      exitPrice: null,
      exitReason: null,
      rMultiple: null,
      pnl: null,
      slippageUsd: null,
      skipReason: skip as 'blocked' | 'stale' | 'duplicate',
      backfilled: false,
      createdAt: now,
    };
    st().trades.unshift(tr);
    mockEmit('paper.skipped', tr);
  } else {
    // the next bar opens a few cents away from the trigger close
    const open = r2(ticket.entry + 0.03);
    const fill = buyFill(open, s);
    const pos: PaperPosition = {
      id: pid('ppos'),
      accountId: a.id,
      periodId: a.currentPeriodId,
      runId: ticket.runId,
      setup: 'orb',
      symbol: ticket.symbol,
      qty: ticket.qty,
      avgPrice: fill,
      lastPrice: ticket.entry,
      unrealizedPnl: r2((ticket.entry - fill) * ticket.qty),
      unrealizedR: r2(((ticket.entry - fill) * ticket.qty) / ticket.maxLoss),
      stop: ticket.stop,
      target: ticket.target,
      flatBy: ticket.flatBy ?? '15:55',
      ticketId: ticket.id,
      entryAt: now,
      slippageUsd: r2((fill - open) * ticket.qty),
      backfilled: false,
    };
    st().positions.push(pos);
    mockEmit('paper.opened', pos);
  }
  const paper = ticketPaperOf(st(), ticket.id);
  return paper ? { ...ticket, paper } : ticket;
}

// ---------------------------------------------------------------- handlers

export function makePaperHandlers(P: string, latency: () => Promise<void>) {
  return [
    http.get(`${P}/paper/accounts`, async () => {
      await latency();
      return json(st().accounts.map(accountView));
    }),

    http.post(`${P}/paper/accounts`, async ({ request }) => {
      await latency();
      let body: PaperAccountCreate = {};
      try {
        body = ((await request.json()) as PaperAccountCreate) ?? {};
      } catch {
        /* empty body allowed */
      }
      const name = (body.name ?? `Paper ${st().accounts.length + 1}`).trim();
      if (!name || name.length > 60) return problem(422, 'validation_error', 'Invalid name');
      const balance = body.startingBalanceUsd ?? db.settings.account.accountSizeUsd;
      if (!(balance > 0)) return problem(422, 'validation_error', 'startingBalanceUsd must be > 0');
      const now = toEtIso(demoNow());
      const id = pid('pacc');
      const account: PaperAccount = {
        id,
        name,
        active: false,
        startingBalanceUsd: balance,
        cashUsd: balance,
        equityUsd: balance,
        realizedPnl: 0,
        unrealizedPnl: 0,
        openPositions: 0,
        currentPeriodId: `${id}_p1`,
        periods: [
          {
            id: `${id}_p1`,
            number: 1,
            startingBalanceUsd: balance,
            startedAt: now,
            endedAt: null,
            realizedPnl: 0,
            trades: 0,
          },
        ],
        createdAt: now,
      };
      if (body.activate !== false) {
        st().accounts.forEach((a) => (a.active = false));
        account.active = true;
      }
      st().accounts.push(account);
      return json(accountView(account), 201);
    }),

    http.post(`${P}/paper/accounts/:accountId/reset`, async ({ params, request }) => {
      await latency();
      const a = st().accounts.find((x) => x.id === params.accountId);
      if (!a) return problem(404, 'paper_account_not_found', 'Paper account not found');
      let body: PaperAccountReset = {};
      try {
        body = ((await request.json()) as PaperAccountReset) ?? {};
      } catch {
        /* empty body allowed */
      }
      const balance = body.startingBalanceUsd ?? db.settings.account.accountSizeUsd;
      if (!(balance > 0)) return problem(422, 'validation_error', 'startingBalanceUsd must be > 0');
      const now = toEtIso(demoNow());
      const open = st().positions.filter((p) => p.accountId === a.id);
      for (const p of open) {
        const tr = closePosition(p, 'reset');
        st().trades.unshift(tr);
        mockEmit('paper.closed', tr);
      }
      st().positions = st().positions.filter((p) => p.accountId !== a.id);
      const cur = a.periods[a.periods.length - 1];
      cur.endedAt = now;
      const number = cur.number + 1;
      const id = `${a.id}_p${number}_${st().seq++}`;
      a.periods.push({
        id,
        number,
        startingBalanceUsd: balance,
        startedAt: now,
        endedAt: null,
        realizedPnl: 0,
        trades: 0,
      });
      a.currentPeriodId = id;
      refreshTickets();
      return json(accountView(a));
    }),

    http.post(`${P}/paper/accounts/:accountId/activate`, async ({ params }) => {
      await latency();
      const a = st().accounts.find((x) => x.id === params.accountId);
      if (!a) return problem(404, 'paper_account_not_found', 'Paper account not found');
      st().accounts.forEach((x) => (x.active = x.id === a.id));
      return json(accountView(a));
    }),

    http.get(`${P}/paper/positions`, async ({ request }) => {
      await latency();
      const a = resolveAccount(new URL(request.url).searchParams.get('accountId'));
      if (!a) return problem(404, 'paper_account_not_found', 'Paper account not found');
      return json(st().positions.filter((p) => p.accountId === a.id));
    }),

    http.get(`${P}/paper/trades/export`, async ({ request }) => {
      await latency();
      const url = new URL(request.url);
      const r = parseRange(url);
      if (r instanceof Response) return r;
      const csv = paperCsv(tradesIn(r, url.searchParams.get('kind')));
      return new HttpResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="levelset-paper-${r.account.id}.csv"`,
        },
      });
    }),

    http.get(`${P}/paper/trades`, async ({ request }) => {
      await latency();
      const url = new URL(request.url);
      const r = parseRange(url);
      if (r instanceof Response) return r;
      const limit = Number(url.searchParams.get('limit') ?? 500);
      if (!(limit >= 1 && limit <= 5000)) return problem(422, 'validation_error', 'Invalid limit');
      return json(
        tradesIn(r, url.searchParams.get('kind'), url.searchParams.get('symbol')).slice(0, limit),
      );
    }),

    http.get(`${P}/paper/stats`, async ({ request }) => {
      await latency();
      const url = new URL(request.url);
      const r = parseRange(url);
      if (r instanceof Response) return r;
      const g = url.searchParams.get('groupBy');
      if (g && !['ticker', 'setup', 'hour', 'weekday'].includes(g))
        return problem(422, 'validation_error', 'Invalid groupBy');
      return json(paperStats(r, (g as PaperGroupBy) || null));
    }),

    http.get(`${P}/paper/compare`, async ({ request }) => {
      await latency();
      const r = parseRange(new URL(request.url));
      if (r instanceof Response) return r;
      return json(compare(r));
    }),

    http.get(`${P}/paper/settings`, async () => {
      await latency();
      return json(st().settings);
    }),

    http.patch(`${P}/paper/settings`, async ({ request }) => {
      await latency();
      const body = ((await request.json()) as PaperSettingsUpdate) ?? {};
      const { slippagePct: pct, slippagePerShare: per, autoFollow } = body;
      if (pct != null && !(pct >= 0 && pct <= 5))
        return problem(422, 'validation_error', 'slippagePct must be 0-5');
      if (per != null && !(per >= 0 && per <= 1))
        return problem(422, 'validation_error', 'slippagePerShare must be 0-1');
      st().settings = {
        autoFollow: autoFollow ?? st().settings.autoFollow,
        slippagePct: pct ?? st().settings.slippagePct,
        slippagePerShare: per ?? st().settings.slippagePerShare,
      };
      return json(st().settings);
    }),
  ];
}
