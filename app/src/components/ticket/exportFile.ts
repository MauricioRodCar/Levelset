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
const MIME: Record<string, string> = {
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
};

/** Save text as a local file (browser download / WebView download). */
export function saveTextFile(name: string, text: string) {
  const ext = name.split('.').pop() ?? 'txt';
  const blob = new Blob([text], { type: `${MIME[ext] ?? 'text/plain'};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFileName(ticket: Ticket, format: TicketExportFormat): string {
  return `${ticket.symbol}-${ticket.createdAt.slice(0, 10)}-${format}.${EXT[format]}`;
}
