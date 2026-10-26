/**
 * /bridges/* and /tickets/{id}/send-to-bridge | cancel-bridge in the mock engine. Mirrors the engine:
 * only ready (PASS) tickets, enabled platforms, mapped symbols, volume rounded DOWN to the step.
 * An online bridge acknowledges "shown" a moment later (bridge.updated). The mock never reports
 * "placed": in real use only the user's click on Place inside the platform does that.
 */
import { http, HttpResponse, type JsonBodyType } from 'msw';
import type {
  BridgePlatform,
  BridgeSendRequest,
  BridgeSettingsUpdate,
  BridgeTicketPlatform,
  BridgeTicketState,
  SymbolMap,
  SymbolMapRow,
} from '../types';
import { db, demoNow, mockConfig, nextId, toEtIso } from './db';
import { mockEmit } from './eventBus';
import { bridgeStatusRows } from './bridgeFixtures';

const PLATFORMS: BridgePlatform[] = ['ctrader', 'mt4', 'mt5'];
const UNITS: Record<BridgePlatform, 'units' | 'lots'> = {
  ctrader: 'units',
  mt4: 'lots',
  mt5: 'lots',
};

const json = <T extends JsonBodyType>(data: T, status = 200) => HttpResponse.json(data, { status });
const problem = (status: number, code: string, title: string, detail?: string) =>
  HttpResponse.json(
    { title, detail, code },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

/** qty shares -> platform volume, floored to a multiple of the step (risk never grows). */
export function convertVolume(qty: number, row: SymbolMapRow): number {
  const steps = Math.floor((qty * row.volumePerShare) / row.volumeStep + 1e-9);
  return Number((steps * row.volumeStep).toFixed(8));
}

function isAbsolute(p: string) {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

function validRows(rows: SymbolMapRow[]): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!PLATFORMS.includes(r.platform)) return 'unknown platform';
    if (!r.usSymbol?.trim() || !r.brokerSymbol?.trim())
      return 'usSymbol and brokerSymbol are required';
    for (const k of ['volumePerShare', 'minVolume', 'volumeStep'] as const)
      if (!(typeof r[k] === 'number' && r[k] > 0)) return `${k} must be greater than 0`;
    const key = `${r.platform}:${r.usSymbol.trim().toUpperCase()}`;
    if (seen.has(key)) return `duplicate row for ${key}`;
    seen.add(key);
  }
  return null;
}

function setTicketBridge(state: BridgeTicketState) {
  db.tickets = db.tickets.map((t) => (t.id === state.ticketId ? { ...t, bridge: state } : t));
}

export function makeBridgeHandlers(P: string, latency: () => Promise<void>) {
  return [
    http.get(`${P}/bridges/settings`, async () => {
      await latency();
      return json(db.bridges.settings);
    }),

    http.patch(`${P}/bridges/settings`, async ({ request }) => {
      await latency();
      const body = (await request.json()) as BridgeSettingsUpdate;
      if (body.signalsFolder !== undefined && !isAbsolute(body.signalsFolder.trim()))
        return problem(
          422,
          'validation_error',
          'Invalid request',
          'signalsFolder must be an absolute path',
        );
      const s = db.bridges.settings;
      db.bridges.settings = {
        signalsFolder: body.signalsFolder?.trim() || s.signalsFolder,
        platforms: {
          ctrader: body.platforms?.ctrader ?? s.platforms.ctrader,
          mt4: body.platforms?.mt4 ?? s.platforms.mt4,
          mt5: body.platforms?.mt5 ?? s.platforms.mt5,
        },
      };
      return json(db.bridges.settings);
    }),

    http.get(`${P}/bridges/status`, async () => {
      await latency();
      return json(bridgeStatusRows(db.bridges, demoNow(), toEtIso));
    }),

    http.get(`${P}/bridges/symbol-map`, async () => {
      await latency();
      return json({ rows: db.bridges.rows });
    }),

    http.put(`${P}/bridges/symbol-map`, async ({ request }) => {
      await latency();
      const body = (await request.json()) as SymbolMap;
      const rows = Array.isArray(body?.rows) ? body.rows : null;
      const err = rows ? validRows(rows) : 'rows is required';
      if (err || !rows)
        return problem(422, 'validation_error', 'Invalid request', err ?? undefined);
      db.bridges.rows = rows.map((r) => ({
        ...r,
        usSymbol: r.usSymbol.trim().toUpperCase(),
        brokerSymbol: r.brokerSymbol.trim(),
      }));
      return json({ rows: db.bridges.rows });
    }),

    http.post(`${P}/tickets/:ticketId/send-to-bridge`, async ({ params, request }) => {
      await latency();
      const t = db.tickets.find((x) => x.id === params.ticketId);
      if (!t) return problem(404, 'ticket_not_found', 'Ticket not found');
      if (t.status !== 'ready')
        return problem(
          409,
          'ticket_not_ready',
          'Not sent to the platform',
          `ticket is ${t.status}`,
        );
      const text = await request.text();
      const body = (text ? JSON.parse(text) : {}) as BridgeSendRequest;
      const enabled = PLATFORMS.filter((p) => db.bridges.settings.platforms[p].enabled);
      const targets = PLATFORMS.filter((p) => (body.platforms ?? enabled).includes(p));
      if (!targets.length || targets.some((p) => !enabled.includes(p)))
        return problem(409, 'bridge_disabled', 'Not sent to the platform');
      const plats: BridgeTicketPlatform[] = [];
      const now = toEtIso(demoNow());
      for (const p of targets) {
        const row = db.bridges.rows.find((r) => r.platform === p && r.usSymbol === t.symbol);
        if (!row)
          return problem(
            422,
            'bridge_symbol_unmapped',
            'Not sent to the platform',
            `${t.symbol} on ${p}`,
          );
        const volume = convertVolume(t.qty, row);
        if (volume <= 0 || volume < row.minVolume)
          return problem(422, 'bridge_volume_too_small', 'Not sent to the platform');
        plats.push({
          platform: p,
          brokerSymbol: row.brokerSymbol,
          volume,
          volumeUnit: UNITS[p],
          state: 'written',
          updatedAt: now,
          error: null,
        });
      }
      const state: BridgeTicketState = {
        ticketId: t.id,
        signalId: nextId('sig'),
        sentAt: now,
        cancelledAt: null,
        platforms: plats,
      };
      setTicketBridge(state);
      // An online bridge shows the panel and acknowledges "shown" (never "placed").
      const online = plats.filter((pl) => (db.bridges.heartbeatAgeS[pl.platform] ?? 99) < 30);
      if (online.length) {
        const signalId = state.signalId;
        setTimeout(
          () => {
            const cur = db.tickets.find((x) => x.id === t.id)?.bridge;
            if (!cur || cur.signalId !== signalId || cur.cancelledAt) return;
            const next: BridgeTicketState = {
              ...cur,
              platforms: cur.platforms.map((pl) =>
                online.some((o) => o.platform === pl.platform) && pl.state === 'written'
                  ? { ...pl, state: 'shown', updatedAt: toEtIso(demoNow()) }
                  : pl,
              ),
            };
            setTicketBridge(next);
            mockEmit('bridge.updated', next);
          },
          Math.max(60, mockConfig.latencyMs * 8),
        );
      }
      return json(state);
    }),

    http.post(`${P}/tickets/:ticketId/cancel-bridge`, async ({ params }) => {
      await latency();
      const t = db.tickets.find((x) => x.id === params.ticketId);
      if (!t) return problem(404, 'ticket_not_found', 'Ticket not found');
      if (!t.bridge) return problem(404, 'bridge_not_sent', 'Ticket not sent');
      if (t.bridge.cancelledAt) return json(t.bridge);
      const now = toEtIso(demoNow());
      const state: BridgeTicketState = {
        ...t.bridge,
        cancelledAt: now,
        platforms: t.bridge.platforms.map((pl) =>
          pl.state === 'placed' ? pl : { ...pl, state: 'cancelled', updatedAt: now },
        ),
      };
      setTicketBridge(state);
      return json(state);
    }),
  ];
}
