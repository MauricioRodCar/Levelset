import type { PaperAccount, PaperRange } from '@/api';

export const RANGE_PRESETS = ['all', 'month', 'week', 'today'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** New York trading date (YYYY-MM-DD) shifted by `days`. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** from / to for a preset, relative to the engine's New York date. */
export function presetRange(
  preset: RangePreset,
  todayEt: string | undefined,
): { from?: string; to?: string } {
  if (preset === 'all' || !todayEt) return {};
  if (preset === 'today') return { from: todayEt, to: todayEt };
  return { from: shiftDate(todayEt, preset === 'week' ? -6 : -29), to: todayEt };
}

export interface PaperSelection {
  accountId?: string;
  periodId?: string;
  preset: RangePreset;
}

export function toRange(sel: PaperSelection, todayEt: string | undefined): PaperRange {
  return { accountId: sel.accountId, periodId: sel.periodId, ...presetRange(sel.preset, todayEt) };
}

export function activeOf(accounts: PaperAccount[] | undefined): PaperAccount | undefined {
  return accounts?.find((a) => a.active) ?? accounts?.[0];
}

/** Breakdown keys in a stable, readable order (weekday Mon..Fri, hour 09..15). */
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
