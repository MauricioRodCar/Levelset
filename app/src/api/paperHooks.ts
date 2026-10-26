/**
 * v1.1 paper account hooks (docs/api/openapi.yaml, /paper/*). Same style as hooks.ts:
 * components import from '@/api' and never call fetch directly.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { getApi, unwrap } from './client';
import { qk } from './queryKeys';
import type {
  PaperAccount,
  PaperAccountCreate,
  PaperComparison,
  PaperGroupBy,
  PaperPosition,
  PaperSettings,
  PaperSettingsUpdate,
  PaperStats,
  PaperTrade,
  PaperTradeKindFilter,
} from './types';

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;

/** Range shared by trades / stats / compare / export. Undefined = engine default. */
export interface PaperRange {
  accountId?: string;
  /** a period id or "all"; default the account's current period */
  periodId?: string;
  from?: string;
  to?: string;
}

const clean = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;

export function usePaperAccounts(opts?: QueryOpts<PaperAccount[]>) {
  return useQuery({
    queryKey: qk.paperAccounts,
    queryFn: () => unwrap(getApi().GET('/paper/accounts')),
    ...opts,
  });
}

/** Open paper positions (default: the active account). Shown in Open trades with a PAPER badge. */
export function usePaperPositions(accountId?: string, opts?: QueryOpts<PaperPosition[]>) {
  return useQuery({
    queryKey: qk.paperPositions(accountId),
    queryFn: () =>
      unwrap(getApi().GET('/paper/positions', { params: { query: clean({ accountId }) } })),
    ...opts,
  });
}

export function usePaperTrades(
  range: PaperRange & { kind?: PaperTradeKindFilter; symbol?: string; limit?: number },
  opts?: QueryOpts<PaperTrade[]>,
) {
  const query = clean(range);
  return useQuery({
    queryKey: qk.paperTrades(query),
    queryFn: () => unwrap(getApi().GET('/paper/trades', { params: { query } })),
    ...opts,
  });
}

export function usePaperStats(
  range: PaperRange & { groupBy?: PaperGroupBy },
  opts?: QueryOpts<PaperStats>,
) {
  const query = clean(range);
  return useQuery({
    queryKey: qk.paperStats(query),
    queryFn: () => unwrap(getApi().GET('/paper/stats', { params: { query } })),
    ...opts,
  });
}

export function usePaperCompare(range: PaperRange, opts?: QueryOpts<PaperComparison>) {
  const query = clean(range);
  return useQuery({
    queryKey: qk.paperCompare(query),
    queryFn: () => unwrap(getApi().GET('/paper/compare', { params: { query } })),
    ...opts,
  });
}

export function usePaperSettings(opts?: QueryOpts<PaperSettings>) {
  return useQuery({
    queryKey: qk.paperSettings,
    queryFn: () => unwrap(getApi().GET('/paper/settings')),
    ...opts,
  });
}

/** GET /paper/trades/export as CSV text (imperative; for the Export button). */
export function fetchPaperExport(
  range: PaperRange & { kind?: PaperTradeKindFilter },
): Promise<string> {
  return unwrap(
    getApi().GET('/paper/trades/export', {
      params: { query: clean(range) },
      parseAs: 'text',
    }),
  ) as Promise<string>;
}

// ---------- writes ----------

function useInvalidatePaper() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.paperAll });
    void qc.invalidateQueries({ queryKey: qk.dashboard });
    void qc.invalidateQueries({ queryKey: qk.ticketsAll });
  };
}

export function useCreatePaperAccount() {
  const invalidate = useInvalidatePaper();
  return useMutation({
    mutationFn: (body: PaperAccountCreate) => unwrap(getApi().POST('/paper/accounts', { body })),
    onSuccess: invalidate,
  });
}

export function useResetPaperAccount() {
  const invalidate = useInvalidatePaper();
  return useMutation({
    mutationFn: ({
      accountId,
      startingBalanceUsd,
    }: {
      accountId: string;
      startingBalanceUsd?: number;
    }) =>
      unwrap(
        getApi().POST('/paper/accounts/{accountId}/reset', {
          params: { path: { accountId } },
          body: startingBalanceUsd ? { startingBalanceUsd } : {},
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useActivatePaperAccount() {
  const invalidate = useInvalidatePaper();
  return useMutation({
    mutationFn: (accountId: string) =>
      unwrap(
        getApi().POST('/paper/accounts/{accountId}/activate', { params: { path: { accountId } } }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdatePaperSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PaperSettingsUpdate) => unwrap(getApi().PATCH('/paper/settings', { body })),
    onSuccess: (data) => {
      qc.setQueryData(qk.paperSettings, data);
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}
