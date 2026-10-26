import { useTranslation } from 'react-i18next';
import { useTickets, type PipelineRun } from '@/api';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { TicketCard } from '@/components/ticket/TicketCard';
import { RunProgress } from './RunProgress';
import { ScannerEmptyState } from './ScannerEmptyState';
import { sortTickets } from './scan';

export interface ActiveRun {
  id: string;
  ticker: string;
}

/** The main dashboard column (~60 %): ticket cards, or the scanner empty state. */
export function ReadyTickets({
  activeRun,
  onRunStarted,
  onDismissRun,
}: {
  activeRun: ActiveRun | null;
  onRunStarted: (run: PipelineRun) => void;
  onDismissRun: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const q = useTickets('all');
  const list = q.data ? sortTickets(q.data) : [];
  const counts = {
    ready: list.filter((x) => x.status === 'ready').length,
    stale: list.filter((x) => x.status === 'stale').length,
    blocked: list.filter((x) => x.status === 'blocked').length,
  };

  return (
    <section aria-labelledby="ready-tickets-title" className="min-w-0 space-y-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="ready-tickets-title" className="text-sm font-semibold text-text">
          {t('tickets.title')}
        </h2>
        {q.data && list.length > 0 && (
          <span className="tabular text-xs text-text-muted" data-testid="ticket-counts">
            {[
              t('tickets.summary', { count: counts.ready }),
              counts.stale ? t('tickets.stale', { count: counts.stale }) : null,
              counts.blocked ? t('tickets.blocked', { count: counts.blocked }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        {list.length > 0 && (
          <span className="ml-auto text-xs text-text-muted">{t('tickets.hint')}</span>
        )}
      </header>

      {activeRun && (
        <RunProgress runId={activeRun.id} ticker={activeRun.ticker} onDismiss={onDismissRun} />
      )}

      {q.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-4">
              <Skeleton className="mb-3 h-5 w-40" />
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-[88px]" />
                <Skeleton className="h-[88px]" />
                <Skeleton className="h-[88px]" />
              </div>
              <Skeleton className="mt-3 h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : list.length === 0 ? (
        activeRun ? null : (
          <ScannerEmptyState onRunStarted={onRunStarted} />
        )
      ) : (
        <div className="space-y-3">
          {list.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} onRunStarted={onRunStarted} />
          ))}
        </div>
      )}
    </section>
  );
}
