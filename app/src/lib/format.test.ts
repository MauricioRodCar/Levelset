import { describe, expect, it } from 'vitest';
import {
  formatMarketTime,
  formatMoney,
  formatPercent,
  formatPrice,
  intlLocale,
  priceForCopy,
} from './format';

// Intl may use narrow no-break spaces; normalise for assertions.
const NBSP = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g');
const norm = (s: string) => s.replace(NBSP, ' ');

describe('format helpers', () => {
  it('maps UI languages to Intl locales', () => {
    expect(intlLocale('en')).toBe('en-US');
    expect(intlLocale('es')).toBe('es-419');
  });

  it('formats money and prices per locale', () => {
    expect(formatMoney(46.88, 'en')).toBe('$46.88');
    expect(norm(formatMoney(1234.5, 'es'))).toMatch(/1,234\.50/);
    expect(formatPrice(358.32, 'en')).toBe('358.32');
    expect(formatPrice(5.86, 'en', { signed: true })).toBe('+5.86');
    expect(formatPrice(-5.86, 'en', { signed: true })).toBe('-5.86');
  });

  it('keeps copy values locale independent', () => {
    expect(priceForCopy(358.32)).toBe('358.32');
    expect(priceForCopy(370.0399999)).toBe('370.04');
  });

  it('formats percent from plain numbers', () => {
    expect(formatPercent(29.4, 'en')).toBe('29.4%');
    expect(norm(formatPercent(29.4, 'es'))).toMatch(/29[.,]4\s?%/);
  });

  it('renders market times in New York with ET', () => {
    // 14:15 UTC on 2026-10-19 is 10:15 EDT.
    expect(formatMarketTime('2026-10-19T14:15:00Z', 'en')).toBe('10:15 ET');
    expect(formatMarketTime('2026-10-19T10:15:00-04:00', 'es')).toBe('10:15 ET');
    expect(formatMarketTime('2026-10-19T14:15:07Z', 'en', { seconds: true, suffix: false })).toBe(
      '10:15:07',
    );
  });
});
