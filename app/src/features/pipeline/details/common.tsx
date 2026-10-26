import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LineChart } from 'lucide-react';
import { useBars } from '@/api';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { cn } from '@/lib/utils';
import { etDay } from '../model';
import type { PriceChartProps } from '../PriceChart';

const PriceChart = lazy(() => import('../PriceChart'));

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 rounded-md border border-border bg-surface2 px-3 py-2', className)}>
      <div className="truncate text-xs text-text-muted">{label}</div>
      <div className="tabular truncate text-base font-semibold text-text">{value}</div>
      {hint && <div className="truncate text-xs text-text-muted">{hint}</div>}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="mb-2 mt-4 text-xs font-semibold uppercase text-text-muted">{children}</h4>;
}

/** Free text from a skill (stays in its original language). */
export function SkillNote({ children }: { children: ReactNode }) {
  const { t } = useTranslation('pipeline');
  if (!children) return null;
  return (
    <p className="mt-3 text-xs text-text-muted">
      <span className="font-medium">{t('detail.skillSays')}</span> <span lang="en">{children}</span>
    </p>
  );
}

/** Legend item: icon/swatch + label (never colour alone). */
export function LegendItem({ swatch, label }: { swatch: ReactNode; label: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 text-xs text-text-muted">
      {swatch}
      <span>{label}</span>
    </li>
  );
}

/**
 * Today's bars for `symbol` as a chart. Hidden with a note when the run is from another day
 * (the price source only serves today's bars) or when there are no bars.
 */
export function BarsChart({
  symbol,
  runStartedAt,
  build,
  ariaLabel,
  legend,
}: {
  symbol: string | null | undefined;
  runStartedAt: string;
  build: (
    bars: NonNullable<ReturnType<typeof useBars>['data']>,
  ) => Omit<PriceChartProps, 'ariaLabel'>;
  ariaLabel: string;
  legend?: ReactNode;
}) {
  const { t } = useTranslation('pipeline');
  const q = useBars(symbol);
  const chartProps = useMemo(() => (q.data?.bars.length ? build(q.data) : null), [q.data, build]);
  if (q.isLoading) return <Skeleton className="h-[260px] w-full" />;
  const data = q.data;
  if (!data || !data.bars.length || q.isError)
    return <EmptyState icon={LineChart} title={t('chart.noBars')} className="py-6" />;
  if (etDay(data.bars[0].t) !== etDay(runStartedAt))
    return (
      <EmptyState
        icon={LineChart}
        title={t('chart.otherDay')}
        description={t('chart.otherDayHint')}
        className="py-6"
      />
    );
  return (
    <figure>
      <Suspense fallback={<Skeleton className="h-[260px] w-full" />}>
        <PriceChart {...chartProps!} ariaLabel={ariaLabel} />
      </Suspense>
      {legend && <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{legend}</ul>}
      <figcaption className="mt-1 text-[11px] text-text-muted">
        {t('chart.caption', { symbol: data.symbol, count: data.bars.length })}
      </figcaption>
    </figure>
  );
}

/** Generic key/value view for a step's inputs or params. */
export function KeyValues({ data, empty }: { data: Record<string, unknown>; empty: string }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!entries.length) return <p className="text-sm text-text-muted">{empty}</p>;
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-xs text-text-muted">{k}</dt>
          <dd className="min-w-0 break-words">
            {v !== null && typeof v === 'object' ? (
              <code className="block max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-text">
                {JSON.stringify(v, null, 1)}
              </code>
            ) : (
              <span className="tabular text-text">{v === null ? '—' : String(v)}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
