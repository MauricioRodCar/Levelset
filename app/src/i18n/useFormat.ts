import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatEtClock,
  formatLocalDateTime,
  formatMarketDate,
  formatMarketDateTime,
  formatMarketTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPrice,
} from '@/lib/format';

/** Formatting helpers bound to the current UI language. */
export function useFormat() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return useMemo(
    () => ({
      lang,
      money: (v: number, o?: { signed?: boolean }) => formatMoney(v, lang, o),
      price: (v: number, o?: { signed?: boolean }) => formatPrice(v, lang, o),
      number: (v: number, digits?: number) => formatNumber(v, lang, digits),
      percent: (v: number, o?: { signed?: boolean; fractionDigits?: number }) =>
        formatPercent(v, lang, o),
      marketTime: (v: string | Date | number, o?: { seconds?: boolean; suffix?: boolean }) =>
        formatMarketTime(v, lang, o),
      marketDate: (v: string | Date | number) => formatMarketDate(v, lang),
      marketDateTime: (v: string | Date | number) => formatMarketDateTime(v, lang),
      etClock: formatEtClock,
      localDateTime: (v: string | Date | number) => formatLocalDateTime(v, lang),
    }),
    [lang],
  );
}
