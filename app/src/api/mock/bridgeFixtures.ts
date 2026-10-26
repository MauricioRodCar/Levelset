/**
 * Platform bridges in the mock engine (web demo + tests): settings, symbol map and heartbeat
 * status. The demo pretends a cTrader cBot runs on a Pepperstone demo account; MT5 last answered
 * long ago (offline) and MT4 was never installed. Nothing is ever placed: only the user can do that,
 * by clicking Place inside the real platform.
 */
import type { BridgePlatform, BridgeSettings, BridgeStatus, SymbolMapRow } from '../types';

export interface BridgeMockState {
  settings: BridgeSettings;
  rows: SymbolMapRow[];
  /** Seconds since the last heartbeat per platform (null = never installed). */
  heartbeatAgeS: Record<BridgePlatform, number | null>;
}

export const DEMO_SIGNALS_FOLDER =
  'C:\\Users\\demo\\AppData\\Roaming\\MetaQuotes\\Terminal\\Common\\Files\\Levelset';

export const bridgeSymbolRows: SymbolMapRow[] = [
  {
    platform: 'ctrader',
    usSymbol: 'TSLA',
    brokerSymbol: 'TSLA.US',
    volumePerShare: 1,
    minVolume: 1,
    volumeStep: 1,
  },
  {
    platform: 'ctrader',
    usSymbol: 'NVDA',
    brokerSymbol: 'NVDA.US',
    volumePerShare: 1,
    minVolume: 1,
    volumeStep: 1,
  },
  {
    platform: 'mt5',
    usSymbol: 'TSLA',
    brokerSymbol: 'TSLA.US',
    volumePerShare: 0.01,
    minVolume: 0.01,
    volumeStep: 0.01,
  },
];

export function freshBridges(): BridgeMockState {
  return {
    settings: {
      signalsFolder: DEMO_SIGNALS_FOLDER,
      platforms: { ctrader: { enabled: true }, mt4: { enabled: false }, mt5: { enabled: false } },
    },
    rows: structuredClone(bridgeSymbolRows),
    heartbeatAgeS: { ctrader: 3, mt4: null, mt5: 4 * 3600 },
  };
}

/** BridgeStatus rows like the engine builds them from heartbeat.json (online = younger than 30 s). */
export function bridgeStatusRows(state: BridgeMockState, now: Date, toIso: (d: Date) => string) {
  const platforms: BridgePlatform[] = ['ctrader', 'mt4', 'mt5'];
  return platforms.map((p): BridgeStatus => {
    const age = state.heartbeatAgeS[p];
    const base: BridgeStatus = {
      platform: p,
      enabled: state.settings.platforms[p].enabled,
      state: 'not_installed',
      folder: `${state.settings.signalsFolder}\\${p}`,
      lastHeartbeatAt: null,
      bridgeVersion: null,
      platformVersion: null,
      accountIsDemo: null,
      missingSymbols: [],
      error: null,
    };
    if (age == null) return base;
    return {
      ...base,
      state: age < 30 ? 'online' : 'offline',
      lastHeartbeatAt: toIso(new Date(now.getTime() - age * 1000)),
      bridgeVersion: '1.1.0',
      platformVersion: p === 'ctrader' ? null : '4620',
      accountIsDemo: true,
    };
  });
}
