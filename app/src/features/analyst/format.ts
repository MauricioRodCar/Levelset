/**
 * Formatting for SEC numbers and plain calendar dates (Analyst and Congress pages).
 * API dates are "YYYY-MM-DD" calendar days: format them in UTC so they never shift a day.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '@/i18n/useFormat';

const locale = (lang: string) => (lang.startsWith('es') ? 'es-419' : 'en-US');

export function formatDay(day: string, lang: string): string {
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/** $24.87B / $910.0M style money for company totals. */
export function formatBigMoney(v: number, lang: string): string {
  return new Intl.NumberFormat(locale(lang), {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(v);
}

/** Helpers bound to the UI language; null-safe ("n/a"). */
export function useResearchFormat() {
  const { t, i18n } = useTranslation('analyst');
  const f = useFormat();
  const lang = i18n.language;
  return useMemo(() => {
    const na = t('na');
    return {
      na,
      day: (d: string | null | undefined) => (d ? formatDay(d, lang) : na),
      big: (v: number | null | undefined) => (v == null ? na : formatBigMoney(v, lang)),
      eps: (v: number | null | undefined) => (v == null ? na : f.money(v)),
      pct: (v: number | null | undefined) => (v == null ? na : f.percent(v, { fractionDigits: 1 })),
      signedPct: (v: number | null | undefined) =>
        v == null ? na : f.percent(v, { signed: true, fractionDigits: 1 }),
      pts: (v: number | null | undefined) =>
        v == null
          ? na
          : new Intl.NumberFormat(locale(lang), {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
              signDisplay: 'exceptZero',
            }).format(v),
    };
  }, [t, f, lang]);
}
