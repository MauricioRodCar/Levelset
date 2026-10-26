import type { Ticket, TicketExportFormat } from '@/api';

export const EXPORT_FORMATS: readonly TicketExportFormat[] = [
  'text',
  'csv',
  'json',
  'ctrader',
  'mt4',
  'mt5',
];

export const EXT: Record<TicketExportFormat, string> = {
  text: 'txt',
  csv: 'csv',
  json: 'json',
  ctrader: 'txt',
  mt4: 'txt',
  mt5: 'txt',
};
/** Saving goes through the native save dialog on desktop (see `useSaveFile`, `@/lib/shell`). */
export { saveTextFile } from '@/lib/shell';

export function exportFileName(ticket: Ticket, format: TicketExportFormat): string {
  return `${ticket.symbol}-${ticket.createdAt.slice(0, 10)}-${format}.${EXT[format]}`;
}
