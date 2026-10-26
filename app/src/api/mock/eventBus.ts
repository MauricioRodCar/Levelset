import type { EventSourceLike } from '../events';
import type { EngineEventMap, EngineEventName } from '../types';

/**
 * In-memory replacement for EventSource used in mock mode (browser demo and tests).
 * The mock handlers call `mockEmit()`; every open MockEventSource receives a MessageEvent,
 * exactly like the engine's GET /events stream.
 */
const sources = new Set<MockEventSource>();

export class MockEventSource implements EventSourceLike {
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private handlers = new Map<string, Set<(e: MessageEvent<string>) => void>>();
  closed = false;

  constructor(public url: string) {
    sources.add(this);
    queueMicrotask(() => !this.closed && this.onopen?.(new Event('open')));
  }

  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
  }

  dispatch(type: string, data: string) {
    this.handlers.get(type)?.forEach((fn) => fn(new MessageEvent(type, { data })));
  }

  close() {
    this.closed = true;
    sources.delete(this);
  }
}

export function mockEmit<K extends EngineEventName>(name: K, data: EngineEventMap[K]) {
  const payload = JSON.stringify(data);
  sources.forEach((s) => s.dispatch(name, payload));
}

export function openMockSources(): number {
  return sources.size;
}
