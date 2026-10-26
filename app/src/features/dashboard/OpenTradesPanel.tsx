import { useTranslation } from 'react-i18next';
import { usePaperPositions, useTrades, type OpenTrade } from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { PaperBadge } from '@/components/PaperBadge';
import { PriceValue } from '@/components/PriceValue';
import { Skeleton } from '@/components/Skeleton';
import { useFormat } from '@/i18n/useFormat';

/**
 * Open positions from recorded fills: qty @ price, unrealized P/L, stop -> target bar, flat-by.
 * v1.1: open paper positions (GET /paper/positions, a separate list) follow with a PAPER badge.
 */
export function OpenTradesPanel() {
  const { t } = useTranslation('dashboard');
  const q = useTrades({ refetchInterval: 15_000 });
  const paper = usePaperPositions(undefined, { refetchInterval: 15_000 });
  const paperRows = paper.data ?? [];
  return (
    <Card title={t('trades.title')} flush aria-label={t('trades.title')}>
      {q.isLoading ? (
        <div className="px-4 pb-4">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : q.isError ? (
        <div className="px-4 pb-4">
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !q.data?.length && !paperRows.length ? (
        <p className="px-4 pb-4 text-sm text-text-muted">{t('trades.empty')}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {(q.data ?? []).map((tr, i) => (
            <TradeRow key={`${tr.symbol}-${i}`} trade={tr} />
          ))}
          {paperRows.map((tr) => (
            <TradeRow key={tr.id} trade={tr} paper />
          ))}
        </ul>
      )}
    </Card>
  );
}

function TradeRow({ trade, paper }: { trade: OpenTrade; paper?: boolean }) {
  const { t } = useTranslation('dashboard');
  const { t: tt } = useTranslation('tickets');
  const f = useFormat();
  const price = trade.lastPrice ?? trade.avgPrice;
  const hasRange = trade.stop != null && trade.target != null && trade.target !== trade.stop;
  const pct = hasRange
    ? Math.max(0, Math.min(1, (price - trade.stop!) / (trade.target! - trade.stop!)))
    : null;
  return (
    <li
      className="space-y-2 px-4 py-3"
      data-testid={paper ? `paper-trade-${trade.symbol}` : `trade-${trade.symbol}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-text">{trade.symbol}</span>
        {paper && <PaperBadge className="self-center" />}
        <span className="tabular text-xs text-text-muted">
          {t('trades.qtyAt', { qty: f.number(trade.qty, 0), price: f.price(trade.avgPrice) })}
        </span>
        <span className="ml-auto" aria-label={t('trades.pnl')}>
          <PriceValue
            value={trade.unrealizedPnl}
            currency
            signed
            tone="pnl"
            size="sm"
            className="font-medium"
          />
        </span>
      </div>
      {pct != null && (
        <div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct * 100)}
            aria-valuetext={t('trades.progress', {
              price: f.price(price),
              stop: f.price(trade.stop!),
              target: f.price(trade.target!),
            })}
            className="relative h-1.5 rounded-full bg-surface2"
          >
            <span
              aria-hidden
              className="absolute -left-0.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-loss"
            />
            <span
              aria-hidden
              className="absolute -right-0.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-profit"
            />
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-full bg-text-muted/50"
              style={{ width: `${pct * 100}%` }}
            />
            <span
              aria-hidden
              className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-text"
              style={{ left: `${pct * 100}%` }}
            />
          </div>
          <div className="tabular mt-1 flex justify-between text-xs text-text-muted">
            <span>
              {tt('levels.stop')} {f.price(trade.stop!)}
            </span>
            <span>
              {tt('levels.target')} {f.price(trade.target!)}
            </span>
          </div>
        </div>
      )}
      <div className="tabular flex justify-between text-xs text-text-muted">
        <span>
          {trade.lastPrice != null ? t('trades.last', { price: f.price(trade.lastPrice) }) : ''}
        </span>
        {trade.flatBy && <span>{t('trades.flatBy', { time: f.etClock(trade.flatBy) })}</span>}
      </div>
    </li>
  );
}
