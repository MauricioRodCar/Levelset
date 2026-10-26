/**
 * Locale-aware formatting helpers. Always pass the UI locale (i18n.language) so numbers and dates
 * follow the chosen language. Market times are always shown in America/New_York with an "ET" suffix.
 *
 * In React, prefer the `useFormat()` hook (src/i18n/useFormat.ts) which binds the current locale.
 */
export const MARKET_TZ = 'America/New_York';

export type UiLocale = 'en' | 'es';

/** Map UI language to a BCP-47 locale for Intl. Spanish uses neutral Latin American formatting. */
export function intlLocale(lang: string): string {
  return lang.startsWith('es') ? 'es-419' : 'en-US';
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${locale}|${JSON.stringify(opts)}`;
  let f = cache.get(key) as Intl.NumberFormat | undefined;
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    cache.set(key, f);
  }
  return f;
}
function df(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${locale}|${JSON.stringify(opts)}`;
  let f = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    cache.set(key, f);
  }
  return f;
}

/** USD money, e.g. "$46.88" / "US$46.88" (es-419). */
export function formatMoney(value: number, lang: string, opts: { signed?: boolean } = {}): string {
  return nf(intlLocale(lang), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: opts.signed ? 'exceptZero' : 'auto',
  }).format(value);
}

/** Price without currency symbol, fixed 2 decimals (ticket levels, quotes). */
export function formatPrice(value: number, lang: string, opts: { signed?: boolean } = {}): string {
  return nf(intlLocale(lang), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: opts.signed ? 'exceptZero' : 'auto',
    useGrouping: true,
  }).format(value);
}

/**
 * Price in a copy-friendly, locale-independent format ("358.32"): trading platforms expect a dot.
 * Use this for clipboard text, never for display.
 */
export function priceForCopy(value: number): string {
  return value.toFixed(2);
}

export function formatNumber(value: number, lang: string, maxFractionDigits = 2): string {
  return nf(intlLocale(lang), { maximumFractionDigits: maxFractionDigits }).format(value);
}

/** Percent from a plain number (29.4 -> "29.4 %" / "29,4 %"). */
export function formatPercent(
  value: number,
  lang: string,
  opts: { signed?: boolean; fractionDigits?: number } = {},
): string {
  const digits = opts.fractionDigits ?? 1;
  return nf(intlLocale(lang), {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: opts.signed ? 'exceptZero' : 'auto',
  }).format(value / 100);
}

/** Market time "10:15 ET" (America/New_York, 24 h) for an ISO timestamp or Date. */
export function formatMarketTime(
  value: string | Date | number,
  lang: string,
  opts: { seconds?: boolean; suffix?: boolean } = {},
): string {
  const d = value instanceof Date ? value : new Date(value);
  const s = df(intlLocale(lang), {
    timeZone: MARKET_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: opts.seconds ? '2-digit' : undefined,
    hourCycle: 'h23',
  }).format(d);
  return opts.suffix === false ? s : `${s} ET`;
}

/** Market date, e.g. "Mon, Oct 19" / "lun, 19 oct", in New York. */
export function formatMarketDate(value: string | Date | number, lang: string): string {
  const d = value instanceof Date ? value : new Date(value);
  return df(intlLocale(lang), {
    timeZone: MARKET_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/** Market date + time, "Oct 19, 10:15 ET". */
export function formatMarketDateTime(value: string | Date | number, lang: string): string {
  const d = value instanceof Date ? value : new Date(value);
  const date = df(intlLocale(lang), { timeZone: MARKET_TZ, month: 'short', day: 'numeric' }).format(
    d,
  );
  return `${date}, ${formatMarketTime(d, lang)}`;
}

/** A "HH:MM" clock string from the API (already ET), e.g. flatBy "15:55" -> "15:55 ET". */
export function formatEtClock(hhmm: string): string {
  return `${hhmm} ET`;
}

/** Local (user time zone) date/time for non-market timestamps, e.g. "created". */
export function formatLocalDateTime(value: string | Date | number, lang: string): string {
  const d = value instanceof Date ? value : new Date(value);
  return df(intlLocale(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
