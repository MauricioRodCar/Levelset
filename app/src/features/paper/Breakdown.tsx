import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePaperStats, type PaperBreakdownRow, type PaperGroupBy, type PaperRange } from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { PriceValue } from '@/components/PriceValue';
import { Skeleton } from '@/components/Skeleton';
import { cn } from '@/lib/utils';
import { useFormat } from '@/i18n/useFormat';

const GROUPS: readonly PaperGroupBy[] = ['ticker', 'setup', 'hour', 'weekday'];

/** Results grouped by ticker / setup / hour of entry / weekday (GET /paper/stats?groupBy). */
export function Breakdown({ range }: { range: PaperRange }) {
  const { t } = useTranslation('paper');
  const [groupBy, setGroupBy] = useState<PaperGroupBy>('ticker');
  const q = usePaperStats({ ...range, groupBy });

  return (
    <Card
      title={t('breakdown.title')}
      actions={
        <div role="radiogroup" aria-label={t('breakdown.title')} className="flex gap-1">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={groupBy === g}
              onClick={() => setGroupBy(g)}
              className={cn(
                'h-7 rounded-md border px-2.5 text-xs focus-ring',
                groupBy === g
                  ? 'border-accent bg-accent/10 font-medium text-text'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              {t(`breakdown.by.${g}`)}
            </button>
          ))}
        </div>
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data?.breakdown.length ? (
        <p className="py-4 text-sm text-text-muted">{t('breakdown.empty')}</p>
      ) : (
        <BreakdownTable rows={q.data.breakdown} groupBy={groupBy} />
      )}
    </Card>
  );
}

function BreakdownTable({ rows, groupBy }: { rows: PaperBreakdownRow[]; groupBy: PaperGroupBy }) {
  const { t } = useTranslation('paper');
  const { t: td } = useTranslation('dashboard');
  const f = useFormat();
  const label = (key: string) => {
    if (groupBy === 'hour') return t('breakdown.hourKey', { hour: key });
    if (groupBy === 'weekday') return t(`breakdown.weekdays.${key}`, { defaultValue: key });
    if (groupBy === 'setup') return td(`setups.${key}`, { defaultValue: key });
    return key;
  };
  return (
    <table className="w-full text-sm" data-testid="paper-breakdown">
      <thead>
        <tr className="border-b border-border text-left text-xs text-text-muted">
          <th scope="col" className="py-1.5 font-medium">
            {t(`breakdown.by.${groupBy}`)}
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            {t('breakdown.cols.trades')}
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            {t('breakdown.cols.winRate')}
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            {t('breakdown.cols.expectancy')}
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            {t('breakdown.cols.pnl')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-border/60 last:border-0">
            <th scope="row" className="py-1.5 text-left font-medium text-text">
              {label(r.key)}
            </th>
            <td className="tabular py-1.5 text-right text-text">{f.number(r.trades, 0)}</td>
            <td className="tabular py-1.5 text-right text-text">
              {r.winRatePct != null ? f.percent(r.winRatePct, { fractionDigits: 0 }) : '—'}
            </td>
            <td className="tabular py-1.5 text-right text-text">
              {r.expectancyR != null ? t('stats.r', { value: f.number(r.expectancyR) }) : '—'}
            </td>
            <td className="py-1.5 text-right">
              <PriceValue value={r.totalPnl} currency signed tone="pnl" size="sm" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
