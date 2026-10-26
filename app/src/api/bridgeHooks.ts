/**
 * Platform bridges (v1.1): hooks for /bridges/* and /tickets/{id}/send-to-bridge | cancel-bridge.
 * Levelset only writes a signal file; the cBot / EA shows it and the user clicks Place in the platform.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getApi, unwrap } from './client';
import { qk } from './queryKeys';
import type {
  BridgePlatform,
  BridgeSettings,
  BridgeSettingsUpdate,
  BridgeStatus,
  BridgeTicketState,
  SymbolMap,
  Ticket,
} from './types';

export const bridgeKeys = {
  all: ['bridges'] as const,
  settings: ['bridges', 'settings'] as const,
  status: ['bridges', 'status'] as const,
  symbolMap: ['bridges', 'symbol-map'] as const,
};

export function useBridgeSettings() {
  return useQuery({
    queryKey: bridgeKeys.settings,
    queryFn: () => unwrap(getApi().GET('/bridges/settings')),
  });
}

/** One row per platform from the bridge heartbeat files. Polled; also pushed by SSE `bridge.status`. */
export function useBridgeStatus() {
  return useQuery({
    queryKey: bridgeKeys.status,
    queryFn: () => unwrap(getApi().GET('/bridges/status')),
    refetchInterval: 10_000,
  });
}

export function useSymbolMap() {
  return useQuery({
    queryKey: bridgeKeys.symbolMap,
    queryFn: () => unwrap(getApi().GET('/bridges/symbol-map')),
  });
}

export function useUpdateBridgeSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BridgeSettingsUpdate) =>
      unwrap(getApi().PATCH('/bridges/settings', { body })),
    onSuccess: (data: BridgeSettings) => {
      qc.setQueryData(bridgeKeys.settings, data);
      void qc.invalidateQueries({ queryKey: bridgeKeys.status });
    },
  });
}

export function useSaveSymbolMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SymbolMap) => unwrap(getApi().PUT('/bridges/symbol-map', { body })),
    onSuccess: (data: SymbolMap) => qc.setQueryData(bridgeKeys.symbolMap, data),
  });
}

/** Put a BridgeTicketState on the cached ticket (detail + every list). */
export function applyBridgeState(qc: QueryClient, state: BridgeTicketState) {
  const patch = (t: Ticket): Ticket => (t.id === state.ticketId ? { ...t, bridge: state } : t);
  qc.setQueryData<Ticket>(qk.ticket(state.ticketId), (old) => (old ? patch(old) : old));
  qc.setQueriesData<Ticket[]>({ queryKey: [...qk.ticketsAll, 'list'] }, (old) =>
    Array.isArray(old) ? old.map(patch) : old,
  );
}

/** Upsert one BridgeStatus row (SSE bridge.status). */
export function applyBridgeStatus(qc: QueryClient, row: BridgeStatus) {
  qc.setQueryData<BridgeStatus[]>(bridgeKeys.status, (old) =>
    old ? old.map((r) => (r.platform === row.platform ? row : r)) : old,
  );
}

export function useSendToBridge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, platforms }: { ticketId: string; platforms?: BridgePlatform[] }) =>
      unwrap(
        getApi().POST('/tickets/{ticketId}/send-to-bridge', {
          params: { path: { ticketId } },
          body: platforms?.length ? { platforms } : {},
        }),
      ),
    onSuccess: (state: BridgeTicketState) => applyBridgeState(qc, state),
  });
}

export function useCancelBridge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) =>
      unwrap(
        getApi().POST('/tickets/{ticketId}/cancel-bridge', { params: { path: { ticketId } } }),
      ),
    onSuccess: (state: BridgeTicketState) => applyBridgeState(qc, state),
  });
}
