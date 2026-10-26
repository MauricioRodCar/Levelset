import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';

const SIZES = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl font-medium',
  /** Ticket levels: 26 px, weight 500 (see ticket rule in README). */
  level: 'text-level font-medium',
  kpi: 'text-2xl font-semibold',
} as const;

export interface PriceValueProps {
  value: number | null | undefined;
  size?: keyof typeof SIZES;
  /** Show + / - sign. */
  signed?: boolean;
  /** Render as money ($46.88) instead of a bare price (358.32). */
  currency?: boolean;
  /**
   * Colour by sign (profit / loss tokens). Only for P/L numbers, NEVER for ticket levels,
   * which always stay in --ls-text.
   */
  tone?: 'neutral' | 'pnl' | 'muted';
  className?: string;
}

/** A number with tabular figures, locale formatting and a placeholder for missing values. */
export function PriceValue({
  value,
  size = 'md',
  signed,
  currency,
  tone = 'neutral',
  className,
}: PriceValueProps) {
  const f = useFormat();
  if (value == null || Number.isNaN(value)) {
    return <span className={cn('tabular text-text-muted', SIZES[size], className)}>—</span>;
  }
  const text = currency ? f.money(value, { signed }) : f.price(value, { signed });
  const color =
    tone === 'pnl'
      ? value > 0
        ? 'text-profit'
        : value < 0
          ? 'text-loss'
          : 'text-text'
      : tone === 'muted'
        ? 'text-text-muted'
        : 'text-text';
  return (
    <span className={cn('tabular whitespace-nowrap', SIZES[size], color, className)}>{text}</span>
  );
}
