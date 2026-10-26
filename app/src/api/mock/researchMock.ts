/**
 * Analyst (/analyst/{symbol}) and Congress trades (/congress/*) endpoints of the mock engine.
 * Data: researchFixtures.ts (generated from the engine in demo mode). Mirrors the engine rules:
 * filters on member / ticker / type / filed date, watchlist and position flags, one
 * congress.filing event per new filing that mentions the watchlist (when notifyOnWatchlist).
 * The demo holds one Pelosi filing back, so the first refresh finds it and notifies.
 */
import { http, HttpResponse, type JsonBodyType } from 'msw';
import type { CongressFiling, CongressSettingsUpdate, CongressTrade } from '../types';
import { db, demoNow, toEtIso } from './db';
import { mockEmit } from './eventBus';
import { analystReports, congressTrades, congressUnread } from './researchFixtures';

/** The PTR the first refresh "finds" (Pelosi's exercised NVDA calls; NVDA is on the watchlist). */
export const HELD_BACK_DOC_ID = '20033725';

const json = <T extends JsonBodyType>(data: T, status = 200) => HttpResponse.json(data, { status });
const problem = (status: number, code: string, title: string, detail?: string) =>
  HttpResponse.json(
    { title, detail, code },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

const TICKER = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['buy', 'sell', 'exchange'];

function flagged(rows: CongressTrade[]): CongressTrade[] {
  const watch = new Set(db.watchlist.map((w) => w.symbol.toUpperCase()));
  const held = new Set(db.trades.map((t) => t.symbol.toUpperCase()));
  return rows.map((t) => {
    const tk = (t.ticker ?? '').toUpperCase();
    return { ...t, inWatchlist: !!tk && watch.has(tk), inPositions: !!tk && held.has(tk) };
  });
}

const visible = () =>
  congressTrades.filter((t) => db.research.refreshed || t.docId !== HELD_BACK_DOC_ID);

export function makeResearchHandlers(P: string, latency: () => Promise<void>) {
  return [
    http.get(`${P}/analyst/:symbol`, async ({ params, request }) => {
      await latency();
      const sym = String(params.symbol).trim().toUpperCase();
      if (!TICKER.test(sym)) return problem(422, 'validation_error', 'Invalid ticker', sym);
      const q = Number(new URL(request.url).searchParams.get('quarters') ?? 6);
      if (!Number.isInteger(q) || q < 1 || q > 12)
        return problem(422, 'validation_error', 'Invalid request', 'quarters: 1 to 12');
      const report = analystReports[sym];
      if (!report)
        return problem(
          404,
          'no_sec_filer',
          `SEC has no reported numbers for ${sym}`,
          `no SEC CIK for ${sym} (demo data covers TSLA, AAPL and KO)`,
        );
      return json({ ...report, quarters: report.quarters.slice(0, q) });
    }),

    http.get(`${P}/congress/trades`, async ({ request }) => {
      await latency();
      const sp = new URL(request.url).searchParams;
      const member = (sp.get('member') ?? '').trim().toLowerCase();
      const ticker = (sp.get('ticker') ?? '').trim().toUpperCase();
      const type = sp.get('type');
      const from = sp.get('from');
      const to = sp.get('to');
      const watchOnly = sp.get('watchlistOnly') === 'true';
      const limit = Number(sp.get('limit') ?? 200);
      if (type && !TYPES.includes(type))
        return problem(422, 'validation_error', 'Invalid request', 'type');
      if ((from && !DATE.test(from)) || (to && !DATE.test(to)))
        return problem(422, 'validation_error', 'Invalid date');
      const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
      const trades = flagged(visible())
        .filter((t) => inRange(t.filedDate))
        .filter((t) => !member || t.member.toLowerCase().includes(member))
        .filter((t) => !ticker || (t.ticker ?? '').toUpperCase() === ticker)
        .filter((t) => !type || t.type === type)
        .filter((t) => !watchOnly || t.inWatchlist || t.inPositions)
        .slice(0, Math.max(1, Math.min(2000, limit)));
      const unread: CongressFiling[] =
        ticker || type || watchOnly
          ? []
          : congressUnread.filter(
              (f) => inRange(f.filedDate) && (!member || f.member.toLowerCase().includes(member)),
            );
      return json({ trades, unreadFilings: unread, lastCheckedAt: db.research.lastCheckedAt });
    }),

    http.post(`${P}/congress/refresh`, async () => {
      await latency();
      const checkedAt = toEtIso(demoNow());
      const st = db.research;
      st.lastCheckedAt = checkedAt;
      if (st.refreshed) return json({ checkedAt, newFilings: 0, newTrades: 0, unreadFilings: 0 });
      st.refreshed = true;
      const rows = flagged(congressTrades.filter((t) => t.docId === HELD_BACK_DOC_ID));
      const first = rows[0];
      if (first && st.settings.notifyOnWatchlist) {
        const hits = rows.filter((t) => t.inWatchlist || t.inPositions);
        if (hits.length)
          mockEmit('congress.filing', {
            filing: {
              docId: first.docId,
              member: first.member,
              district: first.district ?? null,
              filedDate: first.filedDate,
              filingUrl: first.filingUrl,
              parsed: true,
              tradeCount: rows.length,
            },
            trades: hits,
          });
      }
      return json({ checkedAt, newFilings: 1, newTrades: rows.length, unreadFilings: 0 });
    }),

    http.get(`${P}/congress/settings`, async () => {
      await latency();
      return json(db.research.settings);
    }),

    http.patch(`${P}/congress/settings`, async ({ request }) => {
      await latency();
      const body = (await request.json().catch(() => null)) as CongressSettingsUpdate | null;
      if (!body || typeof body !== 'object')
        return problem(422, 'validation_error', 'Invalid request');
      if (body.members !== undefined && !Array.isArray(body.members))
        return problem(422, 'validation_error', 'Invalid request', 'members');
      const cur = db.research.settings;
      if (typeof body.notifyOnWatchlist === 'boolean')
        cur.notifyOnWatchlist = body.notifyOnWatchlist;
      if (body.members) {
        const out: string[] = [];
        for (const m of body.members) {
          const v = String(m).split(/\s+/).filter(Boolean).join(' ');
          if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
        }
        cur.members = out;
      }
      return json(cur);
    }),
  ];
}
