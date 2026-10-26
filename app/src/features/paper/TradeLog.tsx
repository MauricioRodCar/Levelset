import { useState } from 'react';
import { History, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { usePaperTrades, type PaperRange, type PaperTrade, type PaperTradeKindFilter } from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { PriceValue } from '@/components/PriceValue';
import { Skeleton } from '@/components/Skeleton';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';

const KINDS: readonly PaperTradeKindFilter[] = ['all', 'closed', 'skipped'];
const PAGE = 25;

/** The paper trade log: closed trades and skipped entries, newest first. */
export function TradeLog({ range }: { range: PaperRange }) {
  const { t } = useTranslation('paper');
  const [kind, setKind] = useState<PaperTradeKindFilter>('all');
  const [shown, setShown] = useState(PAGE);
  const q = usePaperTrades({ ...range, kind });
  const rows = q.data ?? [];

  return (
    <Card
      title={t('log.title')}
      subtitle={t('log.subtitle')}
      flush
      actions={
        <div role="radiogroup" aria-label={t('log.title')} className="flex gap-1">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                setShown(PAGE);
              }}
              className={cn(
                'h-7 rounded-md border px-2.5 text-xs focus-ring',
                kind === k
                  ? 'border-accent bg-accent/10 font-medium text-text'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              {t(`log.filter.${k}`)}
            </button>
          ))}
        </div>
      }
    >
      {q.isLoading ? (
        <div className="px-4 pb-4">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : q.isError ? (
        <div className="px-4 pb-4">
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !rows.length ? (
        <p className="px-4 pb-4 text-sm text-text-muted">{t('log.empty')}</p>
      ) : (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[760px] text-sm" data-testid="paper-trade-log">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('log.cols.symbol')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('log.cols.entry')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('log.cols.exit')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('log.cols.reason')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('log.cols.r')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('log.cols.pnl')}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">{t('log.cols.flow')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((tr) => (
                <TradeRow key={tr.id} trade={tr} />
              ))}
            </tbody>
          </table>
          {rows.length > shown && (
            <div className="border-t border-border px-4 py-2 text-center">
              <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
                {t('log.more', { count: Math.min(PAGE, rows.length - shown) })}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function When({ at, price }: { at: string | null; price: number | null }) {
  const f = useFormat();
  if (!at || price == null) return <span className="text-text-muted">—</span>;
  return (
    <span className="tabular block leading-tight">
      <span className="text-text">{f.price(price)}</span>
      <span className="block text-xs text-text-muted">
        {f.marketDate(at)} {f.marketTime(at)}
      </span>
    </span>
  );
}

function TradeRow({ trade }: { trade: PaperTrade }) {
  const { t } = useTranslation('paper');
  const f = useFormat();
  const skipped = trade.kind === 'skipped';
  return (
    <tr
      className={cn('border-b border-border/60 last:border-0', skipped && 'bg-surface2/40')}
      data-kind={trade.kind}
      data-testid={`paper-trade-${trade.id}`}
    >
      <th scope="row" className="px-4 py-2 text-left align-top">
        <span className="font-semibold text-text">{trade.symbol}</span>
        <span className="tabular block text-xs font-normal text-text-muted">
          {t('log.qty', { qty: trade.qty })}
        </span>
      </th>
      {skipped ? (
        <td colSpan={5} className="py-2 align-top text-text-muted">
          <span className="block text-text">
            {t('log.skippedRow', {
              reason: t(`skipReason.${trade.skipReason ?? 'blocked'}`),
            })}
          </span>
          <span className="tabular text-xs">
            {f.marketDate(trade.createdAt)} {f.marketTime(trade.createdAt)}
          </span>
          {trade.backfilled && <BackfilledMark />}
        </td>
      ) : (
        <>
          <td className="py-2 align-top">
            <When at={trade.entryAt} price={trade.entryPrice} />
          </td>
          <td className="py-2 align-top">
            <When at={trade.exitAt} price={trade.exitPrice} />
          </td>
          <td className="py-2 align-top text-text">
            {trade.exitReason ? t(`exitReason.${trade.exitReason}`) : '—'}
            {trade.backfilled && <BackfilledMark />}
          </td>
          <td className="tabular py-2 text-right align-top text-text">
            {trade.rMultiple != null ? f.number(trade.rMultiple) : '—'}
          </td>
          <td className="py-2 text-right align-top">
            <PriceValue value={trade.pnl} currency signed tone="pnl" size="sm" />
            {trade.slippageUsd != null && (
              <span className="tabular block text-xs text-text-muted">
                {t('log.slippage', { value: f.money(trade.slippageUsd) })}
              </span>
            )}
          </td>
        </>
      )}
      <td className="px-4 py-2 text-right align-top">
        <Link
          to={`/pipeline/${trade.runId}`}
          className="inline-flex items-center gap-1 rounded text-xs text-accent hover:underline focus-ring"
          aria-label={t('log.viewFlowFor', { symbol: trade.symbol })}
        >
          <Workflow className="h-3.5 w-3.5" aria-hidden />
          {t('log.viewFlow')}
        </Link>
      </td>
    </tr>
  );
}

function BackfilledMark() {
  const { t } = useTranslation('paper');
  return (
    <SimpleTooltip label={t('log.backfilledHint')}>
      <span
        tabIndex={0}
        className="ml-2 inline-flex items-center gap-1 rounded border border-border px-1.5 text-[11px] text-text-muted focus-ring"
        data-testid="backfilled"
      >
        <History className="h-3 w-3" aria-hidden />
        {t('log.backfilled')}
      </span>
    </SimpleTooltip>
  );
}
