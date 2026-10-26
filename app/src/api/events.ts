import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { getEngineInfo } from './engine';
import { applyBridgeState, applyBridgeStatus } from './bridgeHooks';
import type { BridgeStatus, BridgeTicketState } from './types';
import { qk } from './queryKeys';
import {
  ENGINE_EVENT_NAMES,
  type Alert,
  type EngineEventMap,
  type EngineEventName,
  type PipelineRun,
  type PipelineRunSummary,
  type Ticket,
} from './types';

// ---------- in-app event bus (other features can subscribe, e.g. Alerts -> desktop notification) ----------

type Listener<K extends EngineEventName> = (data: EngineEventMap[K]) => void;
const listeners = new Map<EngineEventName, Set<Listener<EngineEventName>>>();

export const engineEvents = {
  /** Subscribe to an engine event. Returns an unsubscribe function. */
  on<K extends EngineEventName>(name: K, fn: Listener<K>): () => void {
    let set = listeners.get(name);
    if (!set) listeners.set(name, (set = new Set()));
    set.add(fn as Listener<EngineEventName>);
    return () => set!.delete(fn as Listener<EngineEventName>);
  },
  emit<K extends EngineEventName>(name: K, data: EngineEventMap[K]) {
    listeners.get(name)?.forEach((fn) => fn(data));
  },
};

/** React helper: subscribe to one engine event for the component's lifetime. */
export function useEngineEvent<K extends EngineEventName>(name: K, fn: Listener<K>) {
  useEffect(() => engineEvents.on(name, fn), [name, fn]);
}

// ---------- EventSource abstraction (mock mode swaps in an in-memory source) ----------

export interface EventSourceLike {
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void): void;
  close(): void;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
}

let factory: (url: string) => EventSourceLike = (url) =>
  new EventSource(url) as unknown as EventSourceLike;

export function setEventSourceFactory(f: (url: string) => EventSourceLike) {
  factory = f;
}

export const useEngineConnection = create<{ sseConnected: boolean }>(() => ({
  sseConnected: false,
}));

// ---------- cache updates ----------

function upsertSummary(list: PipelineRunSummary[] | undefined, s: PipelineRunSummary) {
  if (!list) return list;
  const i = list.findIndex((r) => r.id === s.id);
  if (i === -1) return [s, ...list];
  const next = list.slice();
  next[i] = { ...next[i], ...s };
  return next;
}

/** Apply one engine event to the TanStack Query cache. Exported for tests. */
export function applyEngineEvent<K extends EngineEventName>(
  qc: QueryClient,
  name: K,
  data: EngineEventMap[K],
) {
  switch (name) {
    case 'run.updated': {
      const s = data as PipelineRunSummary;
      qc.setQueriesData<PipelineRunSummary[]>({ queryKey: qk.runsAll }, (old) =>
        upsertSummary(old, s),
      );
      qc.setQueryData<PipelineRun>(qk.run(s.id), (old) => (old ? { ...old, ...s } : old));
      if (s.status !== 'running') {
        void qc.invalidateQueries({ queryKey: qk.run(s.id) });
        void qc.invalidateQueries({ queryKey: qk.dashboard });
      }
      break;
    }
    case 'step.updated': {
      const { runId, step } = data as EngineEventMap['step.updated'];
      const cached = qc.getQueryData<PipelineRun>(qk.run(runId));
      if (cached) {
        qc.setQueryData<PipelineRun>(qk.run(runId), {
          ...cached,
          steps: cached.steps.map((s) => (s.key === step.key ? step : s)),
        });
      } else {
        void qc.invalidateQueries({ queryKey: qk.run(runId) });
      }
      if (step.key === 'scanner') void qc.invalidateQueries({ queryKey: qk.watchlist });
      break;
    }
    case 'ticket.created': {
      const t = data as Ticket;
      qc.setQueryData(qk.ticket(t.id), t);
      void qc.invalidateQueries({ queryKey: [...qk.ticketsAll, 'list'] });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      break;
    }
    case 'alert.rung': {
      const a = data as Alert;
      qc.setQueryData<Alert[]>(qk.alerts, (old) =>
        old
          ? old.some((x) => x.id === a.id)
            ? old.map((x) => (x.id === a.id ? a : x))
            : [...old, a]
          : old,
      );
      break;
    }
    case 'status.changed':
      qc.setQueryData(qk.status, data);
      break;
    // v1.1 paper account: positions, trade log, stats, the dashboard tile and Ticket.paper
    case 'paper.opened':
    case 'paper.closed':
    case 'paper.skipped':
    case 'paper.backfilled':
      void qc.invalidateQueries({ queryKey: qk.paperAll });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      void qc.invalidateQueries({ queryKey: qk.ticketsAll });
      break;
    case 'congress.filing':
      void qc.invalidateQueries({ queryKey: [...qk.congressAll, 'trades'] });
      break;
    // v1.1 platform bridges: Ticket.bridge (shown / placed / dismissed ...) and heartbeat status
    case 'bridge.updated':
      applyBridgeState(qc, data as BridgeTicketState);
      break;
    case 'bridge.status':
      applyBridgeStatus(qc, data as BridgeStatus);
      break;
  }
}

/**
 * Subscribe to GET /events (SSE) and keep the query cache fresh. Mount ONCE (AppShell does).
 * Features that need side effects (notifications, toasts) use `engineEvents.on(...)`.
 */
export function useEngineEvents(enabled = true) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const { url, token } = getEngineInfo();
    let es: EventSourceLike;
    try {
      es = factory(`${url}/events?token=${encodeURIComponent(token)}`);
    } catch {
      return;
    }
    es.onopen = () => useEngineConnection.setState({ sseConnected: true });
    es.onerror = () => useEngineConnection.setState({ sseConnected: false });
    for (const name of ENGINE_EVENT_NAMES) {
      es.addEventListener(name, (e) => {
        let data: unknown;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        applyEngineEvent(qc, name, data as EngineEventMap[typeof name]);
        engineEvents.emit(name, data as EngineEventMap[typeof name]);
      });
    }
    return () => {
      es.close();
      useEngineConnection.setState({ sseConnected: false });
    };
  }, [qc, enabled]);
}
