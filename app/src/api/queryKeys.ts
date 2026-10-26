import type { TicketExportFormat, TicketListFilter } from './types';

/** Central TanStack Query keys. Always build keys through this object. */
export const qk = {
  health: ['health'] as const,
  status: ['status'] as const,
  dashboard: ['dashboard'] as const,
  settings: ['settings'] as const,
  watchlist: ['watchlist'] as const,
  news: (tickers: string, hours?: number) => ['news', tickers, hours ?? 12] as const,
  newsAll: ['news'] as const,
  runs: (limit?: number) => ['pipeline', 'runs', limit ?? 50] as const,
  runsAll: ['pipeline', 'runs'] as const,
  run: (runId: string) => ['pipeline', 'run', runId] as const,
  tickets: (status: TicketListFilter = 'all') => ['tickets', 'list', status] as const,
  ticketsAll: ['tickets'] as const,
  ticket: (id: string) => ['tickets', 'detail', id] as const,
  ticketExport: (id: string, format: TicketExportFormat) =>
    ['tickets', 'export', id, format] as const,
  trades: ['trades'] as const,
  fills: ['fills'] as const,
  alerts: ['alerts'] as const,
};
