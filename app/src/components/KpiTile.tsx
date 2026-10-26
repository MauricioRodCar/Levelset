import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from './Skeleton';

export interface KpiTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Secondary line, e.g. "of $95.00 limit". */
  sub?: ReactNode;
  /** Optional icon shown next to the value (with its text it never relies on colour alone). */
  trend?: 'up' | 'down';
  /** 0..1 progress bar (e.g. risk used / limit). Turns warning at 80 %, loss at 100 %. */
  progress?: number;
  progressLabel?: string;
  loading?: boolean;
  className?: string;
}

export function KpiTile({
  label,
  value,
  sub,
  trend,
  progress,
  progressLabel,
  loading,
  className,
}: KpiTileProps) {
  const pct = progress == null ? null : Math.max(0, Math.min(1, progress));
  const barTone =
    pct == null ? '' : pct >= 1 ? 'bg-loss' : pct >= 0.8 ? 'bg-warning' : 'bg-primary';
  return (
    <div className={cn('rounded-lg border border-border bg-surface px-4 py-3', className)}>
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <div className="mt-1 flex items-center gap-2">
          {trend === 'up' && <TrendingUp className="h-4 w-4 text-profit" aria-hidden />}
          {trend === 'down' && <TrendingDown className="h-4 w-4 text-loss" aria-hidden />}
          <div className="tabular text-2xl font-semibold text-text">{value}</div>
        </div>
      )}
      {sub && <div className="tabular mt-0.5 text-xs text-text-muted">{sub}</div>}
      {pct != null && (
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct * 100)}
          aria-label={progressLabel}
        >
          <div
            className={cn('h-full rounded-full transition-all', barTone)}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
