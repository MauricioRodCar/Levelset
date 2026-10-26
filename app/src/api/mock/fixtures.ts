/**
 * Demo fixtures for the mock engine: the TSLA opening-range breakout from the day-trader-skill
 * examples (2026-10-19, pinned clock 10:15 ET) plus surrounding context.
 *
 * Every object is typed with the generated OpenAPI types so shapes always match docs/api/openapi.yaml.
 * This data also powers the GitHub Pages demo; keep it complete and internally consistent:
 *   - Morning trade META (open): max loss 48.00 already at risk.
 *   - Limits: max loss per trade 50.00, daily loss limit 95.00.
 *   - 10:12 AMD BUY 12: 48.00 + 49.20 = 97.20 > 95.00 daily limit -> BLOCKED (daily_limit).
 *   - 10:15 TSLA BUY 8:  48.00 + 46.88 = 94.88 <= 95.00             -> PASS, ticket ready.
 */
import type {
  Alert,
  DashboardSummary,
  Fill,
  NewsItem,
  OpenTrade,
  PipelineRun,
  PipelineRunSummary,
  ScanHit,
  Settings,
  Status,
  Step,
  Ticket,
  WatchItem,
} from '../types';

export const DEMO_DATE = '2026-10-19';
/** Pinned demo clock: Monday 2026-10-19 10:15 ET (EDT, UTC-4). */
export const DEMO_NOW = '2026-10-19T10:15:00-04:00';
export const et = (hhmm: string, sec = '00') => `${DEMO_DATE}T${hhmm}:${sec}-04:00`;

export const ENGINE_VERSION = '0.1.0-demo';

export const status: Status = {
  marketOpen: true,
  nowEt: DEMO_NOW,
  nextOpen: '2026-10-20T09:30:00-04:00',
  nextClose: '2026-10-19T16:00:00-04:00',
  earlyClose: false,
  dataDelaySeconds: 900,
  mode: 'demo',
  paper: true,
  tier: 'free',
  engineVersion: ENGINE_VERSION,
};

export const settings: Settings = {
  account: { accountSizeUsd: 10000, cashBufferPct: 10, paper: true },
  limits: {
    maxLossPerTradeUsd: 50,
    maxDailyLossUsd: 95,
    maxTradesPerDay: 3,
    minRewardRisk: 1,
    maxPositionPct: 50,
    maxOrderUsd: 5000,
    noEntriesBefore: '09:45',
    noEntriesAfter: '15:30',
    flatBy: '15:55',
    requireStop: true,
    pdtGuard: true,
  },
  data: { secUserAgent: 'Levelset demo demo@example.com', demoMode: true },
};

// ---------------------------------------------------------------- TSLA, the reference example

export const TSLA = {
  symbol: 'TSLA',
  orHigh: 362.18,
  orLow: 354.47,
  orMid: 358.325,
  entry: 364.18,
  stop: 358.32,
  target: 370.04,
  qty: 8,
  riskPerShare: 5.86,
  rewardPerShare: 5.86,
  rMultiple: 1,
  maxLoss: 46.88,
  positionUsd: 2913.44,
  changePct: 2.31,
  timeMachine: {
    targetFirstPct: 29.4,
    stopFirstPct: 25.5,
    openAtClosePct: 45.1,
    verdict: 'coin_flip',
    historyFired: 33,
    historyWon: 13,
    historyLost: 15,
  },
} as const;

export const TSLA_RUN_ID = 'run_20261019_1015_tsla';
export const TSLA_TICKET_ID = 'tkt_20261019_1015_tsla';
export const AMD_RUN_ID = 'run_20261019_1012_amd';
export const AMD_TICKET_ID = 'tkt_20261019_1012_amd';
export const META_RUN_ID = 'run_20261019_0948_meta';
export const NVDA_RUN_ID = 'run_20261016_1005_nvda';

export const scanHits: ScanHit[] = [
  {
    symbol: 'TSLA',
    setup: 'orb',
    price: 364.18,
    rangeHigh: 362.18,
    rangeLow: 354.47,
    pctOverTrigger: 0.55,
    changePct: 2.31,
  },
  {
    symbol: 'NVDA',
    setup: 'orb',
    price: 186.12,
    rangeHigh: 186.9,
    rangeLow: 183.05,
    pctOverTrigger: -0.42,
    changePct: 0.84,
  },
  {
    symbol: 'AAPL',
    setup: 'orb',
    price: 251.3,
    rangeHigh: 254.1,
    rangeLow: 250.62,
    pctOverTrigger: -1.1,
    changePct: -0.63,
  },
];

export const watchlist: WatchItem[] = [
  {
    symbol: 'TSLA',
    setup: 'orb',
    entryState: 'triggered',
    distancePct: null,
    price: 364.18,
    changePct: 2.31,
  },
  {
    symbol: 'NVDA',
    setup: 'orb',
    entryState: 'waiting',
    distancePct: 0.42,
    price: 186.12,
    changePct: 0.84,
  },
  {
    symbol: 'AAPL',
    setup: 'orb',
    entryState: 'expired',
    distancePct: null,
    price: 251.3,
    changePct: -0.63,
  },
];

const yahooNews = (s: string) => `https://finance.yahoo.com/quote/${s}/news`;
const TSLA_8K =
  'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001318605&type=8-K';

export const news: NewsItem[] = [
  {
    id: 'news_tsla_1',
    symbol: 'TSLA',
    title: 'Tesla to report third-quarter results on Wednesday after the bell',
    url: yahooNews('TSLA'),
    source: 'yahoo',
    publishedAt: et('09:58'),
    tags: ['earnings'],
  },
  {
    id: 'news_tsla_2',
    symbol: 'TSLA',
    title: 'Analyst lifts Tesla price target ahead of earnings, keeps neutral rating',
    url: yahooNews('TSLA'),
    source: 'yahoo',
    publishedAt: et('08:41'),
    tags: ['analyst'],
  },
  {
    id: 'news_tsla_3',
    symbol: 'TSLA',
    title: 'Form 8-K: Regulation FD disclosure (Item 7.01)',
    url: TSLA_8K,
    source: 'sec',
    publishedAt: et('07:05'),
    tags: ['regulatory'],
  },
  {
    id: 'news_nvda_1',
    symbol: 'NVDA',
    title: 'Nvidia expands data-centre supply agreement with a cloud provider',
    url: yahooNews('NVDA'),
    source: 'yahoo',
    publishedAt: et('09:12'),
    tags: ['deal'],
  },
  {
    id: 'news_aapl_1',
    symbol: 'AAPL',
    title: 'Apple faces new EU review of App Store terms',
    url: yahooNews('AAPL'),
    source: 'yahoo',
    publishedAt: et('06:30'),
    tags: ['regulatory', 'legal'],
  },
  {
    id: 'news_amd_1',
    symbol: 'AMD',
    title: 'AMD shares climb in early trade as chip stocks rally',
    url: yahooNews('AMD'),
    source: 'yahoo',
    publishedAt: et('09:47'),
    tags: ['other'],
  },
];

// ---------------------------------------------------------------- tickets

export const tslaTicket: Ticket = {
  id: TSLA_TICKET_ID,
  runId: TSLA_RUN_ID,
  symbol: 'TSLA',
  side: 'buy',
  qty: TSLA.qty,
  orderType: 'market',
  timeInForce: 'day',
  entry: TSLA.entry,
  stop: TSLA.stop,
  target: TSLA.target,
  riskPerShare: TSLA.riskPerShare,
  rewardPerShare: TSLA.rewardPerShare,
  rMultiple: TSLA.rMultiple,
  maxLoss: TSLA.maxLoss,
  positionUsd: TSLA.positionUsd,
  flatBy: '15:55',
  status: 'ready',
  riskReasons: [],
  riskDetail: [
    'Stop present: 358.32',
    'Loss at stop 46.88 <= max loss per trade 50.00',
    'Reward:risk 1.00 >= minimum 1.00',
    'Risk today 94.88 of daily limit 95.00',
    'Trades today 1 of 3',
    'Inside entry window 09:45-15:30 ET',
  ],
  timeMachine: { ...TSLA.timeMachine },
  createdAt: et('10:15', '04'),
};

export const amdTicket: Ticket = {
  id: AMD_TICKET_ID,
  runId: AMD_RUN_ID,
  symbol: 'AMD',
  side: 'buy',
  qty: 12,
  orderType: 'market',
  timeInForce: 'day',
  entry: 158.4,
  stop: 154.3,
  target: 166.6,
  riskPerShare: 4.1,
  rewardPerShare: 8.2,
  rMultiple: 2,
  maxLoss: 49.2,
  positionUsd: 1900.8,
  flatBy: '15:55',
  status: 'blocked',
  riskReasons: ['daily_limit'],
  riskDetail: ['Daily loss limit: 48.00 already at risk + 49.20 for this trade = 97.20 > 95.00'],
  timeMachine: {
    targetFirstPct: 38.2,
    stopFirstPct: 31.6,
    openAtClosePct: 30.2,
    verdict: 'favorable',
    historyFired: 21,
    historyWon: 10,
    historyLost: 8,
  },
  createdAt: et('10:12', '41'),
};

export const tickets: Ticket[] = [tslaTicket, amdTicket];

// ---------------------------------------------------------------- trades, fills, dashboard

export const fills: Fill[] = [
  {
    id: 'fill_meta_1',
    symbol: 'META',
    side: 'buy',
    qty: 6,
    price: 712.4,
    at: et('09:50', '12'),
    realizedPnl: null,
  },
];

export const trades: OpenTrade[] = [
  {
    symbol: 'META',
    qty: 6,
    avgPrice: 712.4,
    lastPrice: 716.95,
    unrealizedPnl: 27.3,
    stop: 704.4,
    target: 728.4,
    flatBy: '15:55',
    ticketId: null,
  },
];

export const dashboard: DashboardSummary = {
  dayPnl: 27.3,
  riskUsed: 48,
  dailyLossLimit: 95,
  tradesToday: 1,
  maxTradesPerDay: 3,
  setupsFound: 3,
  lastScanAt: et('10:15', '00'),
};

// ---------------------------------------------------------------- alerts

export const alerts: Alert[] = [
  {
    id: 'alr_open_bell',
    type: 'open_bell',
    note: 'NYSE opening bell',
    status: 'rung',
    createdAt: '2026-10-18T20:10:00-04:00',
    rungAt: et('09:30'),
  },
  {
    id: 'alr_meta_stop',
    type: 'stop',
    symbol: 'META',
    level: 704.4,
    status: 'armed',
    createdAt: et('09:50', '20'),
    rungAt: null,
  },
  {
    id: 'alr_meta_target',
    type: 'target',
    symbol: 'META',
    level: 728.4,
    status: 'armed',
    createdAt: et('09:50', '20'),
    rungAt: null,
  },
  {
    id: 'alr_meta_flat',
    type: 'flat_by',
    symbol: 'META',
    time: '15:55',
    status: 'armed',
    createdAt: et('09:50', '20'),
    rungAt: null,
  },
  {
    id: 'alr_nvda_above',
    type: 'above',
    symbol: 'NVDA',
    level: 186.9,
    note: 'Opening range high',
    status: 'armed',
    createdAt: et('09:46'),
    rungAt: null,
  },
  {
    id: 'alr_tsla_pct',
    type: 'pct_move',
    symbol: 'TSLA',
    pct: 2,
    status: 'rung',
    createdAt: et('09:31'),
    rungAt: et('10:09', '30'),
  },
];

// ---------------------------------------------------------------- pipeline runs

interface RunSpec {
  id: string;
  ticker: string;
  startedAt: string;
  orHigh: number;
  orLow: number;
  entry: number;
  stop: number;
  target: number;
  qty: number;
  changePct: number;
  tm: Ticket['timeMachine'];
  riskUsedBefore: number;
  tradesBefore: number;
  ticketId: string | null;
  /** Override for the risk step result. */
  blockedBy?: string[];
  newsCheck?: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const addSec = (iso: string, s: number) => {
  const d = new Date(new Date(iso).getTime() + s * 1000);
  // keep ET offset in output
  const et4 = new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 19);
  return `${et4}-04:00`;
};

function buildSteps(r: RunSpec): Step[] {
  const risk = round2(r.entry - r.stop);
  const reward = round2(r.target - r.entry);
  const maxLoss = round2(risk * r.qty);
  const rr = round2(reward / risk);
  const orMid = round2((r.orHigh + r.orLow) / 2);
  const positionUsd = round2(r.entry * r.qty);
  const lim = settings.limits;
  const acct = settings.account;
  const riskAfter = round2(r.riskUsedBefore + maxLoss);
  const blocked = !!r.blockedBy?.length;
  const t = (s: number) => addSec(r.startedAt, s);
  const verdict = r.tm?.verdict ?? 'favorable';

  const order = {
    symbol: r.ticker,
    qty: String(r.qty),
    side: 'buy',
    type: 'market',
    time_in_force: 'day',
    order_class: 'bracket',
    take_profit: { limit_price: r.target.toFixed(2) },
    stop_loss: { stop_price: r.stop.toFixed(2) },
  };

  const riskRules = [
    { rule: 'stop_required', pass: true, detail: `Stop present: ${r.stop.toFixed(2)}` },
    {
      rule: 'max_loss_per_trade',
      pass: maxLoss <= lim.maxLossPerTradeUsd!,
      detail: `Loss at stop ${maxLoss.toFixed(2)} <= ${lim.maxLossPerTradeUsd!.toFixed(2)}`,
    },
    {
      rule: 'min_reward_risk',
      pass: rr >= lim.minRewardRisk!,
      detail: `Reward:risk ${rr.toFixed(2)} >= ${lim.minRewardRisk!.toFixed(2)}`,
    },
    {
      rule: 'daily_loss_limit',
      pass: riskAfter <= lim.maxDailyLossUsd!,
      detail: `Risk today ${riskAfter.toFixed(2)} of ${lim.maxDailyLossUsd!.toFixed(2)}`,
    },
    {
      rule: 'trades_per_day',
      pass: r.tradesBefore < lim.maxTradesPerDay!,
      detail: `Trades today ${r.tradesBefore} of ${lim.maxTradesPerDay}`,
    },
    {
      rule: 'entry_window',
      pass: true,
      detail: `Inside ${lim.noEntriesBefore}-${lim.noEntriesAfter} ET`,
    },
    { rule: 'market_open', pass: true, detail: 'NYSE open' },
    { rule: 'blocked_tickers', pass: true, detail: 'Not on the blocked list' },
    {
      rule: 'position_cap',
      pass: positionUsd <= (acct.accountSizeUsd * lim.maxPositionPct!) / 100,
      detail: `Position ${positionUsd.toFixed(2)} <= ${lim.maxPositionPct}% of account`,
    },
    { rule: 'cash_buffer', pass: true, detail: `Keeps ${acct.cashBufferPct}% cash` },
  ];

  const byMaxLoss = Math.floor(lim.maxLossPerTradeUsd! / risk);
  const byPosition = Math.floor((acct.accountSizeUsd * lim.maxPositionPct!) / 100 / r.entry);
  const byOrder = Math.floor(lim.maxOrderUsd! / r.entry);
  const byCash = Math.floor((acct.accountSizeUsd * (1 - acct.cashBufferPct! / 100)) / r.entry);

  return [
    {
      key: 'scanner',
      status: 'done',
      params: { kind: 'orb', at: '10:15', openingRangeMinutes: 15 },
      inputs: { universe: 'nasdaq-trader', universeSize: 5873, interval: '5m', source: 'yahoo' },
      outputs: { kind: 'orb', scanned: 5873, hits: scanHits, at: t(0) },
      summary: {
        inLine: '5,873 US stocks · 5-min bars',
        outLine: `${scanHits.length} setups · best ${r.ticker}`,
        code: 'scanner.found',
        values: { count: scanHits.length, best: r.ticker, scanned: 5873 },
      },
      checks: [],
      error: null,
      startedAt: t(0),
      endedAt: t(6),
    },
    {
      key: 'news',
      status: r.newsCheck?.length ? 'check' : 'done',
      params: { hours: 12 },
      inputs: { tickers: [r.ticker], hours: 12 },
      outputs: {
        items: news.filter((n) => n.symbol === r.ticker),
        earnings: r.newsCheck?.includes('earnings_this_week')
          ? { date: '2026-10-21', when: 'after_close' }
          : null,
      },
      summary: {
        inLine: `${r.ticker} · last 12 h`,
        outLine: r.newsCheck?.length
          ? 'Earnings this week (Wed, after close)'
          : 'No market-moving news',
        code: r.newsCheck?.length ? 'news.earnings_this_week' : 'news.clear',
        values: {
          count: news.filter((n) => n.symbol === r.ticker).length,
          earningsDate: '2026-10-21',
        },
      },
      checks: r.newsCheck ?? [],
      error: null,
      startedAt: t(6),
      endedAt: t(9),
    },
    {
      key: 'entry',
      status: 'done',
      params: { interval: '5m', openingRangeMinutes: 15, trigger: 'or_high', volumeCheck: false },
      inputs: {
        symbol: r.ticker,
        openingRange: { high: r.orHigh, low: r.orLow, start: '09:30', end: '09:45' },
      },
      outputs: {
        state: 'triggered',
        trigger: r.orHigh,
        entry: r.entry,
        triggeredAt: r.startedAt,
        bar: {
          time: '10:10',
          open: round2(r.orHigh - 0.3),
          high: round2(r.entry + 0.42),
          low: round2(r.orHigh - 0.68),
          close: r.entry,
          volume: 1843200,
        },
      },
      summary: {
        inLine: `Opening range ${r.orLow.toFixed(2)}-${r.orHigh.toFixed(2)}`,
        outLine: `Triggered at ${r.entry.toFixed(2)}`,
        code: 'entry.triggered',
        values: {
          price: r.entry,
          time: r.startedAt.slice(11, 16),
          rangeHigh: r.orHigh,
          rangeLow: r.orLow,
        },
      },
      checks: [],
      error: null,
      startedAt: t(9),
      endedAt: t(11),
    },
    {
      key: 'exit',
      status: 'done',
      params: { stopMethod: 'or_mid', targetR: rr },
      inputs: { entry: r.entry, openingRange: { high: r.orHigh, low: r.orLow } },
      outputs: {
        entry: r.entry,
        stop: r.stop,
        target: r.target,
        riskPerShare: risk,
        rewardPerShare: reward,
        rMultiple: rr,
        stopMethod: 'or_mid',
        orMid,
      },
      summary: {
        inLine: `Entry ${r.entry.toFixed(2)} · stop at range midpoint`,
        outLine: `Stop ${r.stop.toFixed(2)} · target ${r.target.toFixed(2)} (${rr}R)`,
        code: 'exit.planned',
        values: { stop: r.stop, target: r.target, r: rr },
      },
      checks: [],
      error: null,
      startedAt: t(11),
      endedAt: t(12),
    },
    {
      key: 'timemachine',
      status: verdict === 'favorable' ? 'done' : 'check',
      params: { simulations: 10000, lookbackDays: 60, interval: '5m' },
      inputs: {
        entry: r.entry,
        stop: r.stop,
        target: r.target,
        from: r.startedAt.slice(11, 16),
        flatBy: lim.flatBy,
      },
      outputs: {
        simulations: 10000,
        targetFirstPct: r.tm?.targetFirstPct,
        stopFirstPct: r.tm?.stopFirstPct,
        openAtClosePct: r.tm?.openAtClosePct,
        avgR: 0.04,
        closeDistribution: [
          { bucket: 'below_stop', pct: r.tm?.stopFirstPct },
          { bucket: 'stop_to_entry', pct: 21.7 },
          { bucket: 'entry_to_target', pct: 23.4 },
          { bucket: 'above_target', pct: r.tm?.targetFirstPct },
        ],
        history: {
          fired: r.tm?.historyFired,
          won: r.tm?.historyWon,
          lost: r.tm?.historyLost,
          open: (r.tm?.historyFired ?? 0) - (r.tm?.historyWon ?? 0) - (r.tm?.historyLost ?? 0),
        },
        verdict,
      },
      summary: {
        inLine: '10,000 sessions · 60 days of 5-min bars',
        outLine: `Target first ${r.tm?.targetFirstPct}% · stop first ${r.tm?.stopFirstPct}%`,
        code: `timemachine.${verdict}`,
        values: {
          verdict,
          targetFirstPct: r.tm?.targetFirstPct,
          stopFirstPct: r.tm?.stopFirstPct,
          openAtClosePct: r.tm?.openAtClosePct,
        },
      },
      // Same codes as the real engine: verdict plus many_open_at_close when > 40 % are still open at the close.
      checks: [
        ...(verdict === 'favorable' ? [] : [verdict]),
        ...((r.tm?.openAtClosePct ?? 0) > 40 ? ['many_open_at_close'] : []),
      ],
      error: null,
      startedAt: t(12),
      endedAt: t(19),
    },
    {
      key: 'budget',
      status: 'done',
      params: {},
      inputs: {
        entry: r.entry,
        stop: r.stop,
        target: r.target,
        accountSizeUsd: acct.accountSizeUsd,
        maxLossPerTradeUsd: lim.maxLossPerTradeUsd,
        maxPositionPct: lim.maxPositionPct,
        maxOrderUsd: lim.maxOrderUsd,
        cashBufferPct: acct.cashBufferPct,
      },
      outputs: {
        qty: r.qty,
        decidedBy: 'max_loss',
        limits: { max_loss: byMaxLoss, position_cap: byPosition, max_order: byOrder, cash: byCash },
        maxLoss,
        positionUsd,
        order,
      },
      summary: {
        inLine: `Max loss ${lim.maxLossPerTradeUsd} · risk ${risk.toFixed(2)}/share`,
        outLine: `${r.qty} shares · max loss ${maxLoss.toFixed(2)}`,
        code: 'budget.sized',
        values: { qty: r.qty, maxLoss, decidedBy: 'max_loss' },
      },
      checks: [],
      error: null,
      startedAt: t(19),
      endedAt: t(20),
    },
    {
      key: 'risk',
      status: blocked ? 'blocked' : 'done',
      params: {},
      inputs: { order, riskUsedToday: r.riskUsedBefore, tradesToday: r.tradesBefore, limits: lim },
      outputs: {
        verdict: blocked ? 'BLOCK' : 'PASS',
        rules: riskRules,
        reasons: r.blockedBy ?? [],
      },
      summary: {
        inLine: `${r.qty} × ${r.ticker} · loss at stop ${maxLoss.toFixed(2)}`,
        outLine: blocked ? `BLOCK: ${r.blockedBy!.join(', ')}` : 'PASS: all rules',
        code: blocked ? 'risk.block' : 'risk.pass',
        values: { reasons: r.blockedBy ?? [], riskAfter, limit: lim.maxDailyLossUsd },
      },
      checks: r.blockedBy ?? [],
      error: null,
      startedAt: t(20),
      endedAt: t(21),
    },
    {
      key: 'ticket',
      status: blocked ? 'blocked' : 'done',
      params: {},
      inputs: { order, riskVerdict: blocked ? 'BLOCK' : 'PASS' },
      outputs: { ticketId: r.ticketId, status: blocked ? 'blocked' : 'ready' },
      summary: {
        inLine: blocked ? 'Risk BLOCK' : 'Risk PASS',
        outLine: `BUY ${r.qty} ${r.ticker} · ${r.entry.toFixed(2)} / ${r.stop.toFixed(2)} / ${r.target.toFixed(2)}`,
        code: blocked ? 'ticket.blocked' : 'ticket.ready',
        values: { ticketId: r.ticketId, symbol: r.ticker, qty: r.qty },
      },
      checks: r.blockedBy ?? [],
      error: null,
      startedAt: t(21),
      endedAt: t(22),
    },
  ];
}

function runStatus(steps: Step[]): PipelineRunSummary['status'] {
  if (steps.some((s) => s.status === 'error')) return 'error';
  if (steps.some((s) => s.status === 'blocked')) return 'blocked';
  if (steps.some((s) => s.status === 'running')) return 'running';
  if (steps.some((s) => s.status === 'pending')) return 'pending';
  if (steps.some((s) => s.status === 'check')) return 'check';
  return 'done';
}

export function makeRun(spec: RunSpec): PipelineRun {
  const steps = buildSteps(spec);
  return {
    id: spec.id,
    ticker: spec.ticker,
    setup: 'orb',
    mode: 'all',
    status: runStatus(steps),
    startedAt: spec.startedAt,
    endedAt: steps[7].endedAt ?? null,
    ticketId: spec.ticketId,
    steps,
  };
}

export const TSLA_SPEC: RunSpec = {
  id: TSLA_RUN_ID,
  ticker: 'TSLA',
  startedAt: et('10:14', '42'),
  orHigh: TSLA.orHigh,
  orLow: TSLA.orLow,
  entry: TSLA.entry,
  stop: TSLA.stop,
  target: TSLA.target,
  qty: TSLA.qty,
  changePct: TSLA.changePct,
  tm: { ...TSLA.timeMachine },
  riskUsedBefore: 48,
  tradesBefore: 1,
  ticketId: TSLA_TICKET_ID,
  newsCheck: ['earnings_this_week'],
};

export const tslaRun = makeRun(TSLA_SPEC);

export const amdRun = makeRun({
  id: AMD_RUN_ID,
  ticker: 'AMD',
  startedAt: et('10:12', '19'),
  orHigh: 157.9,
  orLow: 150.7,
  entry: 158.4,
  stop: 154.3,
  target: 166.6,
  qty: 12,
  changePct: 1.92,
  tm: amdTicket.timeMachine,
  riskUsedBefore: 48,
  tradesBefore: 1,
  ticketId: AMD_TICKET_ID,
  blockedBy: ['daily_limit'],
});

export const metaRun = makeRun({
  id: META_RUN_ID,
  ticker: 'META',
  startedAt: et('09:48', '05'),
  orHigh: 711.9,
  orLow: 696.4,
  entry: 712.4,
  stop: 704.4,
  target: 728.4,
  qty: 6,
  changePct: 1.1,
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
});

export const nvdaRun: PipelineRun = {
  ...makeRun({
    id: NVDA_RUN_ID,
    ticker: 'NVDA',
    startedAt: '2026-10-16T10:05:10-04:00',
    orHigh: 181.4,
    orLow: 178.2,
    entry: 181.9,
    stop: 179.8,
    target: 186.1,
    qty: 23,
    changePct: 1.4,
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
  }),
};

export const runs: PipelineRun[] = [tslaRun, amdRun, metaRun, nvdaRun];

export function summarize(run: PipelineRun): PipelineRunSummary {
  const { steps: _steps, ...summary } = run;
  return summary;
}

export { runStatus };
