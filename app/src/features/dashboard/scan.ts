import type { ScanHit, Ticket } from '@/api';

/** Best hit: furthest over its trigger (hits without a value last), else the scanner's first. */
export function bestHit(hits: ScanHit[]): ScanHit | undefined {
  return [...hits].sort(
    (a, b) => (b.pctOverTrigger ?? -Infinity) - (a.pctOverTrigger ?? -Infinity),
  )[0];
}

const ORDER: Record<Ticket['status'], number> = { ready: 0, stale: 1, blocked: 2 };

/** Ready tickets first (newest first), then stale ones, then blocked rows. */
export function sortTickets(list: Ticket[]): Ticket[] {
  return [...list].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || b.createdAt.localeCompare(a.createdAt),
  );
}
