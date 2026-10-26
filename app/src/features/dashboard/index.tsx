import { useCallback, useMemo, useState } from 'react';
import { Moon, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  isNetworkError,
  useDashboard,
  useEngineEvent,
  useStatus,
  useTickets,
  useWatchlist,
  type PipelineRun,
  type Ticket,
} from '@/api';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { toast } from '@/components/ui/toaster';
import { useFormat } from '@/i18n/useFormat';
import { KpiRow } from './KpiRow';
import { NewsStrip } from './NewsStrip';
import { OpenTradesPanel } from './OpenTradesPanel';
import { ReadyTickets, type ActiveRun } from './ReadyTickets';
import { WatchlistPanel } from './WatchlistPanel';

/**
 * Dashboard (home), docs/SCREENS.md S1: KPI row, Ready tickets (~60 %), and a right column with
 * Watchlist, Open trades and News. Live updates arrive through the shell's single SSE connection
 * (useEngineEvents -> query cache); this page only adds a toast for new tickets.
 */
export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { t: tt } = useTranslation('tickets');
  const status = useStatus();
  const dash = useDashboard();
  const watch = useWatchlist();
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);

  const onRunStarted = useCallback(
    (run: PipelineRun) => setActiveRun({ id: run.id, ticker: run.ticker ?? '' }),
    [],
  );

  const onTicket = useCallback(
    (tk: Ticket) => {
      if (tk.status !== 'ready') return;
      toast(
        t('tickets.newTicket', {
          title: `${tt(`side.${tk.side}`)} ${tk.qty} ${tk.symbol}`,
        }),
      );
    },
    [t, tt],
  );
  useEngineEvent('ticket.created', onTicket);

  const tickers = useMemo(() => (watch.data ?? []).map((w) => w.symbol), [watch.data]);

  const offline = (status.isError && !status.data) || (dash.isError && isNetworkError(dash.error));

  if (offline) {
    return (
      <div>
        <PageHeader title={t('title')} description={t('description')} />
        <div className="rounded-lg border border-border bg-surface px-6 py-10 text-center">
          <Unplug className="mx-auto h-8 w-8 text-loss" aria-hidden />
          <p className="mt-2 text-sm font-medium text-text">{t('offline.title')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">{t('offline.body')}</p>
          <ErrorState
            compact
            className="mx-auto mt-4 max-w-md border-border bg-transparent"
            error={status.error ?? dash.error}
            onRetry={() => {
              void status.refetch();
              void dash.refetch();
            }}
            retrying={status.isFetching || dash.isFetching}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      {dash.isError ? (
        <ErrorState compact error={dash.error} onRetry={() => void dash.refetch()} />
      ) : (
        <KpiRow data={dash.data} loading={dash.isLoading} />
      )}
      {status.data && !status.data.marketOpen && (
        <MarketClosedNotice
          nextOpen={status.data.nextOpen ?? null}
          lastSession={dash.data?.lastScanAt ?? null}
        />
      )}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ReadyTickets
          activeRun={activeRun}
          onRunStarted={onRunStarted}
          onDismissRun={() => setActiveRun(null)}
        />
        <div className="min-w-0 space-y-5">
          <WatchlistPanel />
          <OpenTradesPanel />
          <NewsStrip tickers={tickers} />
        </div>
      </div>
    </div>
  );
}

function MarketClosedNotice({
  nextOpen,
  lastSession,
}: {
  nextOpen: string | null;
  lastSession: string | null;
}) {
  const { t } = useTranslation('dashboard');
  const f = useFormat();
  const tickets = useTickets('all');
  const last =
    lastSession ??
    [...(tickets.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      ?.createdAt ??
    null;
  return (
    <div
      role="status"
      data-testid="market-closed"
      className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
    >
      <Moon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
      <p className="text-text">
        <span className="font-medium">{t('marketClosed.title')}.</span>{' '}
        {last && (
          <span className="text-text-muted">
            {t('marketClosed.body', { date: f.marketDate(last) })}{' '}
          </span>
        )}
        {nextOpen && (
          <span className="text-text-muted">
            {t('marketClosed.next', { date: f.marketDate(nextOpen), time: f.marketTime(nextOpen) })}
          </span>
        )}
      </p>
    </div>
  );
}
