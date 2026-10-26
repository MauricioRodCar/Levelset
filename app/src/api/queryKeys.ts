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
  bars: (symbol: string, interval = '5m') => ['bars', symbol, interval] as const,
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
  // v1.1 paper account (all under 'paper' so one invalidation refreshes the page)
  paperAll: ['paper'] as const,
  paperAccounts: ['paper', 'accounts'] as const,
  paperPositions: (accountId?: string) => ['paper', 'positions', accountId ?? 'active'] as const,
  paperTrades: (q: object) => ['paper', 'trades', q] as const,
  paperStats: (q: object) => ['paper', 'stats', q] as const,
  paperCompare: (q: object) => ['paper', 'compare', q] as const,
  paperSettings: ['paper', 'settings'] as const,
  // v1.1 analyst + congress trades
  analyst: (symbol: string, quarters = 6) => ['analyst', symbol, quarters] as const,
  congressAll: ['congress'] as const,
  congressTrades: (q: Record<string, string | number | boolean | undefined>) =>
    ['congress', 'trades', q] as const,
  congressSettings: ['congress', 'settings'] as const,
};
