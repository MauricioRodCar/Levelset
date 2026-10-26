import type { TFunction } from 'i18next';
import type { Alert, AlertCreate, AlertType } from '@/api';
import { formatEtClock, formatPercent, formatPrice } from '@/lib/format';

export const ALERT_TYPES: readonly AlertType[] = [
  'stop',
  'target',
  'above',
  'below',
  'pct_move',
  'time',
  'flat_by',
  'open_bell',
];

const PRICE_TYPES: readonly AlertType[] = ['above', 'below', 'stop', 'target'];

export interface AlertFields {
  symbol: 'required' | 'optional' | 'none';
  level: boolean;
  pct: boolean;
  /** 'required' for time alerts; 'optional' for flat-by (defaults to the flat-by setting). */
  time: 'required' | 'optional' | 'none';
}

/** Which inputs each alert type uses (same rules as the engine's AlertService.validate). */
export function alertFields(type: AlertType): AlertFields {
  if (PRICE_TYPES.includes(type))
    return { symbol: 'required', level: true, pct: false, time: 'none' };
  if (type === 'pct_move') return { symbol: 'required', level: false, pct: true, time: 'none' };
  if (type === 'time') return { symbol: 'optional', level: false, pct: false, time: 'required' };
  if (type === 'flat_by') return { symbol: 'optional', level: false, pct: false, time: 'optional' };
  return { symbol: 'none', level: false, pct: false, time: 'none' };
}

/** Form state: strings so inputs can be empty while typing. */
export interface AlertDraft {
  type: AlertType;
  symbol: string;
  level: string;
  pct: string;
  time: string;
  note: string;
}

export const EMPTY_DRAFT: AlertDraft = {
  type: 'above',
  symbol: '',
  level: '',
  pct: '',
  time: '',
  note: '',
};

export function draftFromAlert(a: Alert): AlertDraft {
  return {
    type: a.type,
    symbol: a.symbol ?? '',
    level: a.level != null ? String(a.level) : '',
    pct: a.pct != null ? String(a.pct) : '',
    time: a.time ?? '',
    note: a.note ?? '',
  };
}

export type AlertErrorCode = 'required' | 'symbol' | 'positive' | 'time' | 'noteLength';
export type AlertErrors = Partial<
  Record<'symbol' | 'level' | 'pct' | 'time' | 'note', AlertErrorCode>
>;

const SYMBOL = /^[A-Za-z]{1,5}([.-][A-Za-z]{1,2})?$/;
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Client-side validation; the engine checks again and answers 422 invalid_alert. */
export function validateAlertDraft(d: AlertDraft): AlertErrors {
  const e: AlertErrors = {};
  const f = alertFields(d.type);
  const sym = d.symbol.trim();
  if (f.symbol === 'required' && !sym) e.symbol = 'required';
  else if (f.symbol !== 'none' && sym && !SYMBOL.test(sym)) e.symbol = 'symbol';
  const positive = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
  if (f.level) {
    if (!d.level.trim()) e.level = 'required';
    else if (!positive(d.level)) e.level = 'positive';
  }
  if (f.pct) {
    if (!d.pct.trim()) e.pct = 'required';
    else if (!positive(d.pct)) e.pct = 'positive';
  }
  if (f.time === 'required' && !d.time.trim()) e.time = 'required';
  else if (f.time !== 'none' && d.time.trim() && !HHMM.test(d.time.trim())) e.time = 'time';
  if (d.note.length > 120) e.note = 'noteLength';
  return e;
}

/** Body for POST /alerts (only the fields the type uses). */
export function draftToCreate(d: AlertDraft): AlertCreate {
  const f = alertFields(d.type);
  const body: AlertCreate = { type: d.type };
  const sym = d.symbol.trim().toUpperCase();
  if (f.symbol !== 'none' && sym) body.symbol = sym;
  if (f.level) body.level = Number(d.level);
  if (f.pct) body.pct = Number(d.pct);
  if (f.time !== 'none' && d.time.trim()) body.time = d.time.trim();
  if (d.note.trim()) body.note = d.note.trim();
  return body;
}

/**
 * Body for PATCH /alerts/{id}: every field, with null for the ones the (possibly new) type
 * does not use, so a type change leaves no stale level / pct behind.
 */
export function draftToPatch(d: AlertDraft): Record<string, unknown> {
  const c = draftToCreate(d);
  return {
    type: c.type,
    symbol: c.symbol ?? null,
    level: c.level ?? null,
    pct: c.pct ?? null,
    time: c.time ?? null,
    note: c.note ?? null,
  };
}

/** The "Level / time" cell: 366.00 · ±3.0 % · 15:55 ET · 09:30 ET. */
export function alertTrigger(a: Pick<Alert, 'type' | 'level' | 'pct' | 'time'>, lang: string) {
  if (a.level != null) return formatPrice(a.level, lang);
  if (a.pct != null) return `±${formatPercent(a.pct, lang)}`;
  if (a.time) return formatEtClock(a.time);
  if (a.type === 'open_bell') return formatEtClock('09:30');
  return '—';
}

/** One plain sentence for toasts and desktop notifications ("TSLA hit your stop at 358.32"). */
export function alertSentence(a: Alert, t: TFunction, lang: string): string {
  const symbol = a.symbol ?? '';
  const value = alertTrigger(a, lang);
  const key = a.type === 'time' && symbol ? 'time_symbol' : a.type;
  return t(`alerts:sentence.${key}`, { symbol, value });
}
