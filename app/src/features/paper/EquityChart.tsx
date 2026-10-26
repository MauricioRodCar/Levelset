import { useEffect, useRef } from 'react';
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { PaperEquityPoint } from '@/api';
import { cssVar, useThemeStore, type TokenKey } from '@/theme';

export interface EquityChartProps {
  points: PaperEquityPoint[];
  startingBalance: number;
  height?: number;
  ariaLabel: string;
  /** Locale-formatted money for the price scale and crosshair. */
  formatMoney: (v: number) => string;
}

function token(key: TokenKey): string {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar(key)).trim();
}
function tokenAlpha(key: TokenKey, alpha: number): string {
  const rgb = getComputedStyle(document.documentElement)
    .getPropertyValue(`${cssVar(key)}-rgb`)
    .trim()
    .split(/\s+/)
    .join(', ');
  return rgb ? `rgba(${rgb}, ${alpha})` : token(key);
}

const ET_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
});
const etDate = (t: Time) => ET_DATE.format(new Date(Number(t) * 1000));

/** Strictly increasing Unix seconds (lightweight-charts rejects equal times). */
function toSeries(points: PaperEquityPoint[]) {
  let last = 0;
  return points.map((p) => {
    let t = Math.floor(new Date(p.t).getTime() / 1000);
    if (t <= last) t = last + 1;
    last = t;
    return { time: t as UTCTimestamp, value: p.equityUsd };
  });
}

/**
 * Equity after each closed paper trade (TradingView lightweight-charts, as PriceChart). Line and
 * fill use the accent token; the starting balance is a dotted neutral line. Text stays neutral.
 */
export default function EquityChart({
  points,
  startingBalance,
  height = 220,
  ariaLabel,
  formatMoney,
}: EquityChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const themeKey = useThemeStore((s) => `${s.activeId}:${JSON.stringify(s.custom)}`);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cleanup: (() => void) | null = null;
    const frame = requestAnimationFrame(() => {
      const chart = createChart(el, {
        autoSize: true,
        height,
        layout: {
          background: { type: ColorType.Solid, color: token('surface') },
          textColor: token('textMuted'),
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 11,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: tokenAlpha('border', 0.5) },
          horzLines: { color: tokenAlpha('border', 0.5) },
        },
        rightPriceScale: { borderColor: token('border') },
        timeScale: { borderColor: token('border'), tickMarkFormatter: etDate },
        localization: { timeFormatter: etDate, priceFormatter: formatMoney },
        crosshair: { mode: CrosshairMode.Magnet },
        handleScroll: false,
        handleScale: false,
      });
      const series = chart.addSeries(AreaSeries, {
        lineColor: token('accent'),
        topColor: tokenAlpha('accent', 0.25),
        bottomColor: tokenAlpha('accent', 0.02),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      series.setData(toSeries(points));
      series.createPriceLine({
        price: startingBalance,
        color: token('textMuted'),
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: false,
        title: '',
      });
      chart.timeScale().fitContent();
      cleanup = () => chart.remove();
    });
    return () => {
      cancelAnimationFrame(frame);
      cleanup?.();
    };
  }, [points, startingBalance, height, themeKey, formatMoney]);

  return (
    <div className="relative" role="img" aria-label={ariaLabel} style={{ height }}>
      <div ref={host} className="absolute inset-0" />
    </div>
  );
}
