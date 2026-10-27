/**
 * TanStack Query hooks, one per engine endpoint (docs/api/openapi.yaml).
 * Components import from '@/api' and never call fetch directly.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { getApi, isNetworkError, unwrap } from './client';
import { qk } from './queryKeys';
import type {
  Alert,
  AlertCreate,
  AlertUpdate,
  FillCreate,
  PipelineRun,
  PipelineRunRequest,
  PipelineRunSummary,
  ScanRequest,
  Settings,
  Step,
  StepKey,
  TicketExportFormat,
  TicketListFilter,
} from './types';

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;

// ---------- reads ----------

export function useHealth(opts?: QueryOpts<{ ok?: boolean; version?: string }>) {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => unwrap(getApi().GET('/health')),
    ...opts,
  });
}

/** Market clock / mode. Polled every 30 s and pushed by SSE `status.changed`. */
export function useStatus(opts?: QueryOpts<import('./types').Status>) {
  return useQuery({
    queryKey: qk.status,
    queryFn: () => unwrap(getApi().GET('/status')),
    refetchInterval: 30_000,
    // Offline engine: fail fast so the status bar shows "Engine offline" immediately.
    retry: (count, err) => !isNetworkError(err) && count < 1,
    ...opts,
  });
}

export function useDashboard(opts?: QueryOpts<import('./types').DashboardSummary>) {
  return useQuery({
    queryKey: qk.dashboard,
    queryFn: () => unwrap(getApi().GET('/dashboard')),
    ...opts,
  });
}

export function useSettings(opts?: QueryOpts<Settings>) {
  return useQuery({
    queryKey: qk.settings,
    queryFn: () => unwrap(getApi().GET('/settings')),
    ...opts,
  });
}

export function useWatchlist(opts?: QueryOpts<import('./types').WatchItem[]>) {
  return useQuery({
    queryKey: qk.watchlist,
    queryFn: () => unwrap(getApi().GET('/watchlist')),
    ...opts,
  });
}

/** Headlines and 8-Ks. `tickers` is an array; disabled while empty. */
export function useNews(
  tickers: string[],
  hours = 12,
  opts?: QueryOpts<import('./types').NewsItem[]>,
) {
  const joined = tickers.join(',');
  return useQuery({
    queryKey: qk.news(joined, hours),
    queryFn: () => unwrap(getApi().GET('/news', { params: { query: { tickers: joined, hours } } })),
    enabled: joined.length > 0,
    ...opts,
  });
}

/** Today's intraday bars for a symbol (Pipeline charts). Disabled while `symbol` is empty. */
export function useBars(
  symbol: string | null | undefined,
  interval: '1m' | '5m' = '5m',
  opts?: QueryOpts<import('./types').Bars>,
) {
  return useQuery({
    queryKey: qk.bars(symbol ?? '', interval),
    queryFn: () =>
      unwrap(
        getApi().GET('/bars', { params: { query: { symbol: symbol!, interval, range: '1d' } } }),
      ),
    enabled: !!symbol,
    staleTime: 60_000,
    ...opts,
  });
}

export function usePipelineRuns(limit = 50, opts?: QueryOpts<PipelineRunSummary[]>) {
  return useQuery({
    queryKey: qk.runs(limit),
    queryFn: () => unwrap(getApi().GET('/pipeline/runs', { params: { query: { limit } } })),
    ...opts,
  });
}

export function usePipelineRun(runId: string | undefined, opts?: QueryOpts<PipelineRun>) {
  return useQuery({
    queryKey: qk.run(runId ?? ''),
    queryFn: () =>
      unwrap(getApi().GET('/pipeline/runs/{runId}', { params: { path: { runId: runId! } } })),
    enabled: !!runId,
    ...opts,
  });
}

export function useTickets(
  status: TicketListFilter = 'all',
  opts?: QueryOpts<import('./types').Ticket[]>,
) {
  return useQuery({
    queryKey: qk.tickets(status),
    queryFn: () => unwrap(getApi().GET('/tickets', { params: { query: { status } } })),
    ...opts,
  });
}

export function useTicket(
  ticketId: string | undefined,
  opts?: QueryOpts<import('./types').Ticket>,
) {
  return useQuery({
    queryKey: qk.ticket(ticketId ?? ''),
    queryFn: () =>
      unwrap(getApi().GET('/tickets/{ticketId}', { params: { path: { ticketId: ticketId! } } })),
    enabled: !!ticketId,
    ...opts,
  });
}

/** Fetch a ticket export as text (imperative; use for copy / download buttons). */
export function fetchTicketExport(ticketId: string, format: TicketExportFormat): Promise<string> {
  return unwrap(
    getApi().GET('/tickets/{ticketId}/export', {
      params: { path: { ticketId }, query: { format } },
      parseAs: 'text',
    }),
  ) as Promise<string>;
}

export function useTicketExport(
  ticketId: string | undefined,
  format: TicketExportFormat,
  opts?: QueryOpts<string>,
) {
  return useQuery({
    queryKey: qk.ticketExport(ticketId ?? '', format),
    queryFn: () => fetchTicketExport(ticketId!, format),
    enabled: !!ticketId,
    ...opts,
  });
}

export function useTrades(opts?: QueryOpts<import('./types').OpenTrade[]>) {
  return useQuery({
    queryKey: qk.trades,
    queryFn: () => unwrap(getApi().GET('/trades')),
    ...opts,
  });
}

export function useFills(opts?: QueryOpts<import('./types').Fill[]>) {
  return useQuery({
    queryKey: qk.fills,
    queryFn: () => unwrap(getApi().GET('/fills')),
    ...opts,
  });
}

export function useAlerts(opts?: QueryOpts<Alert[]>) {
  return useQuery({
    queryKey: qk.alerts,
    queryFn: () => unwrap(getApi().GET('/alerts')),
    ...opts,
  });
}

// ---------- writes ----------

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Settings) => unwrap(getApi().PUT('/settings', { body })),
    onSuccess: (data) => {
      qc.setQueryData(qk.settings, data);
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: qk.status });
    },
  });
}

export function useRunScanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ScanRequest = {}) => unwrap(getApi().POST('/scanner/run', { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.watchlist });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

/**
 * Tells the engine that first-run setup is finished, so it may start the paper catch-up runs (it holds
 * them back on a fresh install). Sent once per app start, after the engine has answered; idempotent.
 */
export function useReportOnboarding(done: boolean, engineUp: boolean) {
  const sent = useRef(false);
  useEffect(() => {
    if (!done || !engineUp || sent.current) return;
    sent.current = true;
    getApi()
      .POST('/system/onboarding')
      .catch(() => {
        sent.current = false; // try again when the engine is back
      });
  }, [done, engineUp]);
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PipelineRunRequest) => unwrap(getApi().POST('/pipeline/runs', { body })),
    onSuccess: (run) => {
      qc.setQueryData(qk.run(run.id), run);
      void qc.invalidateQueries({ queryKey: qk.runsAll });
    },
  });
}

export function useRunStep(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stepKey, params }: { stepKey: StepKey; params?: Record<string, unknown> }) =>
      unwrap(
        getApi().POST('/pipeline/runs/{runId}/steps/{stepKey}/run', {
          params: { path: { runId, stepKey } },
          body: { params },
        }),
      ),
    onSuccess: (step: Step) => {
      qc.setQueryData<PipelineRun>(qk.run(runId), (old) =>
        old ? { ...old, steps: old.steps.map((s) => (s.key === step.key ? step : s)) } : old,
      );
      void qc.invalidateQueries({ queryKey: qk.run(runId) });
      void qc.invalidateQueries({ queryKey: qk.runsAll });
      if (step.key === 'ticket') void qc.invalidateQueries({ queryKey: qk.ticketsAll });
    },
  });
}

export function useCreateFill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FillCreate) => unwrap(getApi().POST('/fills', { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.fills });
      void qc.invalidateQueries({ queryKey: qk.trades });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AlertCreate) => unwrap(getApi().POST('/alerts', { body })),
    onSuccess: (a) => qc.setQueryData<Alert[]>(qk.alerts, (old) => (old ? [...old, a] : [a])),
  });
}

export function useAlertsFromPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => unwrap(getApi().POST('/alerts/from-plan', { body: { runId } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.alerts }),
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const { response } = await getApi().DELETE('/alerts/{alertId}', {
        params: { path: { alertId } },
        parseAs: 'stream',
      });
      if (!response.ok) await unwrap(Promise.resolve({ response }));
      return alertId;
    },
    onSuccess: (id) =>
      qc.setQueryData<Alert[]>(qk.alerts, (old) => old?.filter((a) => a.id !== id)),
  });
}

/** PATCH /alerts/{id}: edit any field and/or re-arm with `{ status: 'armed' }`. */
export function useUpdateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ alertId, patch }: { alertId: string; patch: AlertUpdate }) =>
      unwrap(getApi().PATCH('/alerts/{alertId}', { params: { path: { alertId } }, body: patch })),
    onSuccess: (a) =>
      qc.setQueryData<Alert[]>(qk.alerts, (old) => old?.map((x) => (x.id === a.id ? a : x))),
  });
}

/** DELETE /fills/{id}: remove a wrongly recorded fill (the engine fixes portfolio and risk state). */
export function useDeleteFill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fillId: string) => {
      // default parsing keeps the Problem body (e.g. fill_in_use); 204 resolves with no data
      await unwrap(getApi().DELETE('/fills/{fillId}', { params: { path: { fillId } } }));
      return fillId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.fills });
      void qc.invalidateQueries({ queryKey: qk.trades });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}
