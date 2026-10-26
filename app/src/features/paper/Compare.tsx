import { useTranslation } from 'react-i18next';
import { usePaperCompare, type PaperCompareSide, type PaperRange } from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { PriceValue } from '@/components/PriceValue';
import { Skeleton } from '@/components/Skeleton';
import { useFormat } from '@/i18n/useFormat';

/** "Signals vs. you": paper (every signal) next to the user's recorded fills, same days + tickers. */
export function Compare({ range }: { range: PaperRange }) {
  const { t } = useTranslation('paper');
  const f = useFormat();
  const q = usePaperCompare(range);
  const d = q.data;

  return (
    <Card title={t('compare.title')} subtitle={t('compare.subtitle')}>
      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
      ) : !d || !d.rows.length ? (
        <p className="py-4 text-sm text-text-muted">{t('compare.empty')}</p>
      ) : (
        <div className="space-y-4" data-testid="paper-compare">
          <div className="grid gap-3 sm:grid-cols-2">
            <SideTotal label={t('compare.paper')} side={d.totals.paper} />
            <SideTotal label={t('compare.manual')} side={d.totals.manual} />
          </div>
          <p className="tabular text-xs text-text-muted">
            {t('compare.diff', {
              value: f.money(d.totals.manual.pnl - d.totals.paper.pnl, { signed: true }),
            })}{' '}
            · {t('compare.matched', { count: d.totals.matched })} ·{' '}
            {t('compare.paperOnly', { count: d.totals.paperOnly })} ·{' '}
            {t('compare.manualOnly', { count: d.totals.manualOnly })}
          </p>
          <p className="text-xs text-text-muted">{t('compare.note')}</p>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    {t('compare.cols.date')}
                  </th>
                  <th scope="col" className="py-1.5 font-medium">
                    {t('compare.cols.symbol')}
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    {t('compare.cols.paper')}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    {t('compare.cols.manual')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr
                    key={`${r.date}-${r.symbol}`}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="tabular px-3 py-1.5 text-text">
                      {f.marketDate(`${r.date}T12:00:00-04:00`)}
                    </td>
                    <th scope="row" className="py-1.5 text-left font-medium text-text">
                      {r.symbol}
                    </th>
                    <td className="py-1.5 text-right">
                      {r.paper ? (
                        <PriceValue value={r.paper.pnl} currency signed tone="pnl" size="sm" />
                      ) : (
                        <span className="text-xs text-text-muted">{t('compare.none')}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {r.manual ? (
                        <PriceValue value={r.manual.pnl} currency signed tone="pnl" size="sm" />
                      ) : (
                        <span className="text-xs text-text-muted">{t('compare.none')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function SideTotal({ label, side }: { label: string; side: PaperCompareSide }) {
  const { t } = useTranslation('paper');
  const f = useFormat();
  return (
    <div className="rounded-md border border-border bg-surface2 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <PriceValue value={side.pnl} currency signed tone="pnl" size="lg" />
      <p className="tabular text-xs text-text-muted">
        {t('compare.trades', { count: side.trades })}
        {side.winRatePct != null &&
          ` · ${t('compare.winRate', { value: f.percent(side.winRatePct, { fractionDigits: 0 }) })}`}
        {side.rTotal != null && ` · ${t('compare.rTotal', { value: f.number(side.rTotal) })}`}
      </p>
    </div>
  );
}
