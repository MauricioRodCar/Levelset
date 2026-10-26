import { useEffect, useRef } from 'react';
import {
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type Time,
} from 'lightweight-charts';
import type { AnalystQuarter } from '@/api';
import { cssVar, useThemeStore, type TokenKey } from '@/theme';

export interface QuartersChartProps {
  /** newest first, as the API returns them */
  quarters: AnalystQuarter[];
  height?: number;
  ariaLabel: string;
  formatRevenue: (v: number) => string;
  formatEps: (v: number) => string;
  formatDay: (day: string) => string;
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

/** "2026-06-30" business day -> the same string, for lightweight-charts. */
const dayOf = (t: Time) =>
  typeof t === 'string'
    ? t
    : typeof t === 'number'
      ? new Date(t * 1000).toISOString().slice(0, 10)
      : `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

/**
 * Revenue bars (right scale) and diluted EPS line (left scale) by quarter end, oldest to newest
 * (TradingView lightweight-charts, like the other charts). Accent / primary tokens only.
 */
export default function QuartersChart({
  quarters,
  height = 240,
  ariaLabel,
  formatRevenue,
  formatEps,
  formatDay,
}: QuartersChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const themeKey = useThemeStore((s) => `${s.activeId}:${JSON.stringify(s.custom)}`);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const rows = [...quarters].sort((a, b) => a.end.localeCompare(b.end));
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
          vertLines: { visible: false },
          horzLines: { color: tokenAlpha('border', 0.5) },
        },
        leftPriceScale: { visible: true, borderColor: token('border') },
        rightPriceScale: { borderColor: token('border') },
        timeScale: {
          borderColor: token('border'),
          tickMarkFormatter: (t: Time) => formatDay(dayOf(t)),
        },
        localization: { timeFormatter: (t: Time) => formatDay(dayOf(t)) },
        crosshair: { mode: CrosshairMode.Magnet },
        handleScroll: false,
        handleScale: false,
      });
      const revenue = chart.addSeries(HistogramSeries, {
        color: tokenAlpha('accent', 0.55),
        priceScaleId: 'right',
        priceFormat: { type: 'custom', formatter: formatRevenue, minMove: 1 },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      revenue.setData(
        rows
          .filter((q) => q.revenue != null)
          .map((q) => ({ time: q.end as Time, value: q.revenue as number })),
      );
      const eps = chart.addSeries(LineSeries, {
        color: token('primary'),
        lineWidth: 2,
        priceScaleId: 'left',
        priceFormat: { type: 'custom', formatter: formatEps, minMove: 0.01 },
        priceLineVisible: false,
        lastValueVisible: false,
        pointMarkersVisible: true,
      });
      eps.setData(
        rows
          .filter((q) => q.epsDiluted != null)
          .map((q) => ({ time: q.end as Time, value: q.epsDiluted as number })),
      );
      chart.timeScale().fitContent();
      cleanup = () => chart.remove();
    });
    return () => {
      cancelAnimationFrame(frame);
      cleanup?.();
    };
  }, [quarters, height, themeKey, formatRevenue, formatEps, formatDay]);

  return (
    <div className="relative" role="img" aria-label={ariaLabel} style={{ height }}>
      <div ref={host} className="absolute inset-0" />
    </div>
  );
}
