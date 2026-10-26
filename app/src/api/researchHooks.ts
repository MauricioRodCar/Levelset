/**
 * v1.1 Analyst (/analyst/{symbol}) and Congress trades (/congress/*) hooks. Same style as
 * hooks.ts: components import from '@/api' and never call fetch directly.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { ApiError, getApi, unwrap } from './client';
import { qk } from './queryKeys';
import type {
  AnalystReport,
  CongressFeed,
  CongressSettings,
  CongressSettingsUpdate,
  CongressTradeType,
} from './types';

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;

/** SEC numbers change once a quarter; the engine caches them too. */
const ANALYST_STALE_MS = 30 * 60_000;

/** Reported quarters for one company. Disabled while `symbol` is empty. */
export function useAnalyst(symbol: string, quarters = 6, opts?: QueryOpts<AnalystReport>) {
  const sym = symbol.trim().toUpperCase();
  return useQuery({
    queryKey: qk.analyst(sym, quarters),
    queryFn: () =>
      unwrap(
        getApi().GET('/analyst/{symbol}', {
          params: { path: { symbol: sym }, query: { quarters } },
        }),
      ),
    enabled: !!sym,
    staleTime: ANALYST_STALE_MS,
    // 404 (no SEC filer) and 422 (no SEC identity) will not change on a retry
    retry: (count, err) =>
      !(err instanceof ApiError && (err.status === 404 || err.status === 422)) && count < 1,
    ...opts,
  });
}

/**
 * "Reports this week" for a ticket / watchlist symbol (AnalystReport.reportsThisWeek). Quiet: any
 * error (no SEC identity, ETF, offline) just means no badge.
 */
export function useReportsThisWeek(symbol: string | null | undefined): boolean {
  const q = useAnalyst(symbol ?? '', 6, { retry: false });
  return q.data?.reportsThisWeek === true;
}

export interface CongressQuery {
  member?: string;
  ticker?: string;
  type?: CongressTradeType;
  from?: string;
  to?: string;
  watchlistOnly?: boolean;
  limit?: number;
}

const clean = <T extends object>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== false),
  ) as T;

export function useCongressTrades(query: CongressQuery, opts?: QueryOpts<CongressFeed>) {
  const q = clean(query);
  return useQuery({
    queryKey: qk.congressTrades(q as Record<string, string | number | boolean | undefined>),
    queryFn: () => unwrap(getApi().GET('/congress/trades', { params: { query: q } })),
    ...opts,
  });
}

export function useCongressSettings(opts?: QueryOpts<CongressSettings>) {
  return useQuery({
    queryKey: qk.congressSettings,
    queryFn: () => unwrap(getApi().GET('/congress/settings')),
    ...opts,
  });
}

export function useRefreshCongress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(getApi().POST('/congress/refresh')),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...qk.congressAll, 'trades'] }),
  });
}

export function useUpdateCongressSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CongressSettingsUpdate) =>
      unwrap(getApi().PATCH('/congress/settings', { body })),
    onSuccess: (data) => {
      qc.setQueryData(qk.congressSettings, data);
      void qc.invalidateQueries({ queryKey: [...qk.congressAll, 'trades'] });
    },
  });
}
