import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type AutoscaleInfo,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Bar } from '@/api';
import { cssVar, useThemeStore, type TokenKey } from '@/theme';

export type ChartLineKind = 'entry' | 'stop' | 'target' | 'level';

export interface PriceChartProps {
  bars: Bar[];
  /** Opening range band (shaded). */
  band?: { high: number; low: number } | null;
  lines?: { price: number; kind: ChartLineKind; title: string }[];
  /** Bar start (Unix seconds) to mark with an arrow under the bar. */
  markerTime?: number | null;
  height?: number;
  ariaLabel: string;
}

/** Theme token value from :root (charts draw on a canvas and need real colours). */
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

const ET_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const etClock = (t: Time) => ET_TIME.format(new Date(Number(t) * 1000));

const LINE_TOKEN: Record<ChartLineKind, TokenKey> = {
  entry: 'textMuted',
  stop: 'loss',
  target: 'profit',
  level: 'accent',
};

function buildChart(
  el: HTMLDivElement,
  {
    bars,
    band,
    lines,
    markerTime,
    height,
  }: Required<Pick<PriceChartProps, 'bars' | 'lines' | 'height'>> &
    Pick<PriceChartProps, 'band' | 'markerTime'>,
  setBandBox: (b: { top: number; height: number } | null) => void,
): () => void {
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
    timeScale: {
      borderColor: token('border'),
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: etClock,
    },
    localization: { timeFormatter: etClock },
    crosshair: { mode: CrosshairMode.Magnet },
    handleScroll: false,
    handleScale: false,
  });
  const series = chart.addSeries(CandlestickSeries, {
    upColor: tokenAlpha('profit', 0.85),
    downColor: tokenAlpha('loss', 0.85),
    borderUpColor: token('profit'),
    borderDownColor: token('loss'),
    wickUpColor: token('textMuted'),
    wickDownColor: token('textMuted'),
    priceLineVisible: false,
    // keep every level line and the band on screen (a target above today's high, a stop below)
    autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
      const res = original();
      const extra = [...lines.map((l) => l.price), ...(band ? [band.high, band.low] : [])];
      if (!res?.priceRange || !extra.length) return res;
      return {
        ...res,
        priceRange: {
          minValue: Math.min(res.priceRange.minValue, ...extra),
          maxValue: Math.max(res.priceRange.maxValue, ...extra),
        },
      };
    },
    lastValueVisible: false,
  });
  series.setData(
    bars.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c })),
  );
  const neutralLabel = { axisLabelColor: token('surface2'), axisLabelTextColor: token('text') };
  if (band) {
    for (const price of [band.high, band.low])
      series.createPriceLine({
        price,
        color: tokenAlpha('accent', 0.7),
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '',
        ...neutralLabel,
      });
  }
  for (const l of lines)
    series.createPriceLine({
      price: l.price,
      color: token(LINE_TOKEN[l.kind]),
      lineWidth: 2,
      lineStyle: l.kind === 'entry' ? LineStyle.Solid : LineStyle.Dashed,
      axisLabelVisible: true,
      title: l.title,
      ...neutralLabel,
    });
  if (markerTime)
    createSeriesMarkers(series, [
      {
        time: markerTime as UTCTimestamp,
        position: 'belowBar',
        shape: 'arrowUp',
        color: token('primary'),
      },
    ]);
  chart.timeScale().fitContent();

  const placeBand = () => {
    if (!band) return setBandBox(null);
    const top = series.priceToCoordinate(band.high);
    const bottom = series.priceToCoordinate(band.low);
    if (top === null || bottom === null) return setBandBox(null);
    setBandBox({ top: Math.min(top, bottom), height: Math.abs(bottom - top) });
  };
  const raf = requestAnimationFrame(placeBand);
  const later = setTimeout(placeBand, 120);
  chart.timeScale().subscribeVisibleLogicalRangeChange(placeBand);
  const ro = new ResizeObserver(() => requestAnimationFrame(placeBand));
  ro.observe(el);
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(later);
    ro.disconnect();
    chart.remove();
  };
}

/**
 * 5-minute candlesticks (TradingView lightweight-charts) with an optional opening-range band,
 * level lines and a trigger marker. Colours come from the theme tokens; all chart text is neutral
 * (text / text-muted), lines keep their colour only on the line itself (the ticket rule).
 */
export default function PriceChart({
  bars,
  band,
  lines = [],
  markerTime,
  height = 260,
  ariaLabel,
}: PriceChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const [bandBox, setBandBox] = useState<{ top: number; height: number } | null>(null);
  const themeKey = useThemeStore((s) => `${s.activeId}:${JSON.stringify(s.custom)}`);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // Built one frame later: the ThemeProvider writes the new --ls-* variables in its own effect,
    // which runs after this one on a theme switch.
    let cleanup: (() => void) | null = null;
    const frame = requestAnimationFrame(() => {
      cleanup = buildChart(el, { bars, band, lines, markerTime, height }, setBandBox);
    });
    return () => {
      cancelAnimationFrame(frame);
      cleanup?.();
    };
  }, [bars, band, lines, markerTime, height, themeKey]);

  return (
    <div className="relative" role="img" aria-label={ariaLabel} style={{ height }}>
      <div ref={host} className="absolute inset-0" />
      {bandBox && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-14 z-10 bg-accent/15"
          style={{ top: bandBox.top, height: bandBox.height }}
        />
      )}
    </div>
  );
}
