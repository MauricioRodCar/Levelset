import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api';
import { useErrorMessage } from '@/components/useErrorMessage';
import type { BridgePlatform, SymbolMapRow } from '@/api';

/** Problem codes the bridge endpoints return; translated in connections:bridges.errors. */
const BRIDGE_CODES = new Set([
  'ticket_not_ready',
  'ticket_not_found',
  'bridge_disabled',
  'bridge_symbol_unmapped',
  'bridge_volume_too_small',
  'bridge_folder_unwritable',
  'bridge_not_sent',
  'validation_error',
]);

/** Error message for a bridge call: our own translations first, then the shared errors namespace. */
export function useBridgeErrorMessage() {
  const { t } = useTranslation('connections');
  const generic = useErrorMessage();
  return (err: unknown): string =>
    err instanceof ApiError && err.code && BRIDGE_CODES.has(err.code)
      ? t(`bridges.errors.${err.code}`)
      : generic(err);
}

/** Source file of each bridge in the repository. */
export const BRIDGE_FILES = {
  ctrader: 'bridges/ctrader/LevelsetBridge.cs',
  mt4: 'bridges/mt4/LevelsetBridge.mq4',
  mt5: 'bridges/mt5/LevelsetBridge.mq5',
} as const;

/** Absolute Windows path (C:\..., \\server\share) or POSIX path. */
export function isAbsolutePath(p: string): boolean {
  const s = p.trim();
  return /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.startsWith('/');
}

/** Same conversion as the engine: shares x volumePerShare, rounded DOWN to the step. */
export function previewVolume(qty: number, row: SymbolMapRow): number {
  const steps = Math.floor((qty * row.volumePerShare) / row.volumeStep + 1e-9);
  return Number((steps * row.volumeStep).toFixed(8));
}

/** One editable row: numbers stay text while typing (validated on save). */
export interface DraftRow {
  key: number;
  platform: BridgePlatform;
  usSymbol: string;
  brokerSymbol: string;
  volumePerShare: string;
  minVolume: string;
  volumeStep: string;
}

export type Field = Exclude<keyof DraftRow, 'key' | 'platform'>;
export const NUMBER_FIELDS = ['volumePerShare', 'minVolume', 'volumeStep'] as const;
type RowErrors = Partial<Record<Field, 'required' | 'positive' | 'duplicate'>>;

/** Pure validation, exported for tests. */
export function validateRows(rows: DraftRow[]): RowErrors[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const e: RowErrors = {};
    if (!r.usSymbol.trim()) e.usSymbol = 'required';
    if (!r.brokerSymbol.trim()) e.brokerSymbol = 'required';
    for (const k of NUMBER_FIELDS) {
      const v = r[k].trim().replace(',', '.');
      if (!v) e[k] = 'required';
      else if (!(Number(v) > 0)) e[k] = 'positive';
    }
    const id = `${r.platform}:${r.usSymbol.trim().toUpperCase()}`;
    if (r.usSymbol.trim()) {
      if (seen.has(id)) e.usSymbol = 'duplicate';
      seen.set(id, 1);
    }
    return e;
  });
}
