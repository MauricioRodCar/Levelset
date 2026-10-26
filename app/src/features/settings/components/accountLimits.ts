import type { Settings } from '@/api';

/** Sensible first-run defaults (used until GET /settings answers, or if the engine is offline). */
export const DEFAULT_SETTINGS: Settings = {
  account: { accountSizeUsd: 10000, cashBufferPct: 10, paper: true },
  limits: {
    maxLossPerTradeUsd: 50,
    maxDailyLossUsd: 150,
    maxTradesPerDay: 3,
    minRewardRisk: 1.5,
    maxPositionPct: 50,
    maxOrderUsd: 5000,
    noEntriesBefore: '09:45',
    noEntriesAfter: '15:30',
    flatBy: '15:55',
    requireStop: true,
    pdtGuard: true,
  },
  data: { secUserAgent: '', demoMode: false },
};

export type LimitsErrorCode =
  'required' | 'positive' | 'aboveDaily' | 'aboveAccount' | 'percent' | 'integer' | 'window';
export type LimitsErrors = Partial<
  Record<
    | 'accountSizeUsd'
    | 'maxLossPerTradeUsd'
    | 'maxDailyLossUsd'
    | 'maxTradesPerDay'
    | 'minRewardRisk'
    | 'cashBufferPct'
    | 'noEntriesBefore'
    | 'noEntriesAfter'
    | 'flatBy',
    LimitsErrorCode
  >
>;

const bad = (v: number | undefined) => v === undefined || v === null || Number.isNaN(v);

/** Client-side validation; the engine validates again and may answer 422 with a Problem code. */
export function validateLimits(s: Settings): LimitsErrors {
  const e: LimitsErrors = {};
  const a = s.account;
  const l = s.limits;
  if (bad(a.accountSizeUsd)) e.accountSizeUsd = 'required';
  else if (a.accountSizeUsd <= 0) e.accountSizeUsd = 'positive';

  if (bad(l.maxLossPerTradeUsd)) e.maxLossPerTradeUsd = 'required';
  else if (l.maxLossPerTradeUsd! <= 0) e.maxLossPerTradeUsd = 'positive';
  else if (!bad(a.accountSizeUsd) && l.maxLossPerTradeUsd! > a.accountSizeUsd)
    e.maxLossPerTradeUsd = 'aboveAccount';

  if (bad(l.maxDailyLossUsd)) e.maxDailyLossUsd = 'required';
  else if (l.maxDailyLossUsd! <= 0) e.maxDailyLossUsd = 'positive';
  if (!e.maxLossPerTradeUsd && !e.maxDailyLossUsd && l.maxLossPerTradeUsd! > l.maxDailyLossUsd!) {
    e.maxLossPerTradeUsd = 'aboveDaily';
  }

  if (bad(l.maxTradesPerDay)) e.maxTradesPerDay = 'required';
  else if (!Number.isInteger(l.maxTradesPerDay) || l.maxTradesPerDay! < 1)
    e.maxTradesPerDay = 'integer';

  if (bad(l.minRewardRisk)) e.minRewardRisk = 'required';
  else if (l.minRewardRisk! <= 0) e.minRewardRisk = 'positive';

  if (
    a.cashBufferPct !== undefined &&
    (Number.isNaN(a.cashBufferPct) || a.cashBufferPct < 0 || a.cashBufferPct > 100)
  ) {
    e.cashBufferPct = 'percent';
  }

  const hhmm = /^\d{2}:\d{2}$/;
  for (const k of ['noEntriesBefore', 'noEntriesAfter', 'flatBy'] as const) {
    if (!l[k] || !hhmm.test(l[k]!)) e[k] = 'required';
  }
  if (!e.noEntriesBefore && !e.noEntriesAfter && l.noEntriesBefore! >= l.noEntriesAfter!)
    e.noEntriesAfter = 'window';
  if (!e.noEntriesAfter && !e.flatBy && l.flatBy! <= l.noEntriesAfter!) e.flatBy = 'window';
  return e;
}
