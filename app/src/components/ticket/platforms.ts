import type { TicketExportFormat } from '@/api';

/** Platforms the Connections page and the ticket "How to enter" dialog know about. */
export type PlatformId = 'ctrader' | 'mt4' | 'mt5' | 'alpaca' | 'ibkr';

export interface PlatformInfo {
  id: PlatformId;
  /** Export format that best fits the platform (GET /tickets/{id}/export). */
  exportFormat: TicketExportFormat;
  /** What comes later for this platform: an in-platform bridge (v1.1) or a direct API (Pro). */
  later: 'bridge' | 'api';
}

export const PLATFORMS: readonly PlatformInfo[] = [
  { id: 'ctrader', exportFormat: 'ctrader', later: 'bridge' },
  { id: 'mt4', exportFormat: 'mt4', later: 'bridge' },
  { id: 'mt5', exportFormat: 'mt5', later: 'bridge' },
  { id: 'alpaca', exportFormat: 'text', later: 'api' },
  { id: 'ibkr', exportFormat: 'text', later: 'api' },
];

/** Platforms offered in the ticket's "How to enter" dialog (CFD platforms first). */
export const HOWTO_PLATFORMS: readonly PlatformId[] = ['ctrader', 'mt4', 'mt5', 'alpaca', 'ibkr'];
