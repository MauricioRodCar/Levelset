import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { usePaperPositions } from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { PaperBadge } from '@/components/PaperBadge';
import { PriceValue } from '@/components/PriceValue';
import { Skeleton } from '@/components/Skeleton';
import { useFormat } from '@/i18n/useFormat';

/** Open paper positions of the selected account (fill, last, unrealized P/L, slippage paid). */
export function Positions({ accountId }: { accountId: string }) {
  const { t } = useTranslation('paper');
  const { t: tt } = useTranslation('tickets');
  const f = useFormat();
  const q = usePaperPositions(accountId, { refetchInterval: 15_000 });
  return (
    <Card title={t('positions.title')} flush>
      {q.isLoading ? (
        <div className="px-4 pb-4">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : q.isError ? (
        <div className="px-4 pb-4">
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !q.data?.length ? (
        <p className="px-4 pb-4 text-sm text-text-muted">{t('positions.empty')}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border" data-testid="paper-positions">
          {q.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="text-sm font-semibold text-text">{p.symbol}</span>
              <PaperBadge />
              <span className="tabular text-xs text-text-muted">
                {t('positions.entered', {
                  qty: p.qty,
                  price: f.price(p.avgPrice),
                  time: f.marketTime(p.entryAt),
                })}
              </span>
              <span className="tabular text-xs text-text-muted">
                {tt('levels.stop')} {p.stop != null ? f.price(p.stop) : '—'} · {tt('levels.target')}{' '}
                {p.target != null ? f.price(p.target) : '—'}
              </span>
              <span className="tabular text-xs text-text-muted">
                {t('log.slippage', { value: f.money(p.slippageUsd) })}
              </span>
              <span className="ml-auto">
                <PriceValue value={p.unrealizedPnl} currency signed tone="pnl" size="sm" />
              </span>
              <Link
                to={`/pipeline/${p.runId}`}
                className="text-xs text-accent hover:underline focus-ring"
                aria-label={t('log.viewFlowFor', { symbol: p.symbol })}
              >
                {t('log.viewFlow')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
