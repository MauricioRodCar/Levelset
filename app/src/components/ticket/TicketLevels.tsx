import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { useCopyPrice } from './useCopyPrice';

/**
 * THE TICKET RULE (shared by every ticket card in the app):
 * - Entry, Stop loss, Take profit are the largest text on the card: 26 px, weight 500,
 *   tabular numerals, always in --ls-text (never red/green).
 * - Stop / target identity only via a 3 px top bar + a small dot in --ls-loss / --ls-profit.
 *   Entry uses a neutral marker (--ls-text-muted).
 * - Order is always Entry -> Stop loss -> Take profit, left to right.
 * - Clicking a value copies it. The clipboard gets the raw dot-decimal value ("358.32"); the toast
 *   shows it in the UI locale ("Copied 358.32" / "Copiado 358,32").
 */
export type LevelKind = 'entry' | 'stop' | 'target';

const MARKER: Record<LevelKind, { bar: string; dot: string }> = {
  entry: { bar: 'bg-text-muted/60', dot: 'bg-text-muted' },
  stop: { bar: 'bg-loss', dot: 'bg-loss' },
  target: { bar: 'bg-profit', dot: 'bg-profit' },
};

export interface LevelBlockProps {
  kind: LevelKind;
  value: number;
  /** Distance from entry (e.g. -5.86 / +5.86), shown small under the value. */
  delta?: number;
  className?: string;
}

export function LevelBlock({ kind, value, delta, className }: LevelBlockProps) {
  const { t } = useTranslation('tickets');
  const { t: tc } = useTranslation('common');
  const f = useFormat();
  const copyPrice = useCopyPrice();
  const label = t(`levels.${kind}`);
  const copy = () => void copyPrice(value);
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-surface2 px-3 pb-2.5 pt-3.5',
        className,
      )}
      data-level={kind}
    >
      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-[3px]', MARKER[kind].bar)} />
      <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
        <span aria-hidden className={cn('h-2 w-2 rounded-full', MARKER[kind].dot)} />
        {label}
      </div>
      <button
        type="button"
        onClick={copy}
        className="group mt-1 flex w-full items-baseline gap-2 rounded text-left focus-ring"
        aria-label={tc('copy.copyLabeled', { label, value: f.price(value) })}
      >
        <span className="tabular text-level font-medium text-text">{f.price(value)}</span>
        <Copy
          className="h-3.5 w-3.5 shrink-0 self-center text-text-muted opacity-60 group-hover:opacity-100"
          aria-hidden
        />
      </button>
      <div className="tabular mt-0.5 h-4 text-xs text-text-muted">
        {delta !== undefined ? f.price(delta, { signed: true }) : ''}
      </div>
    </div>
  );
}

export interface TicketLevelsProps {
  entry: number;
  stop: number;
  target: number;
  className?: string;
}

/** The three level blocks in the mandatory order. */
export function TicketLevels({ entry, stop, target, className }: TicketLevelsProps) {
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      <LevelBlock kind="entry" value={entry} />
      <LevelBlock kind="stop" value={stop} delta={Math.round((stop - entry) * 100) / 100} />
      <LevelBlock kind="target" value={target} delta={Math.round((target - entry) * 100) / 100} />
    </div>
  );
}
