"""Status, watchlist, news, quotes and scans: thin wrappers over the skills."""

from __future__ import annotations

import datetime as dt
import time
from typing import Any

from ..adapters.settings_map import settings_from_config
from ..clock import iso, ny_local_to_utc, parse_iso
from ..context import EngineContext
from ..pipeline import codes
from ..storage import workspace as wsf

# Free Yahoo quotes are unofficial and can lag; the skills treat a price as fresh for 15 minutes.
LIVE_DATA_DELAY_SECONDS = 900
QUOTE_TTL = 30.0


class MarketService:
    def __init__(self, ctx: EngineContext) -> None:
        self.ctx = ctx
        self._quotes: dict[str, tuple[float, dict[str, Any]]] = {}

    # ---------------------------------------------------------------- status
    def status(self) -> dict[str, Any]:
        cal = self.ctx.calendar.status(self.ctx.clock.now())
        cfg = self.ctx.config_doc()
        return {"marketOpen": cal["marketOpen"], "nowEt": iso(self.ctx.clock.now()), "nextOpen": cal["nextOpen"],
                "nextClose": cal["nextClose"], "earlyClose": cal["earlyClose"],
                "dataDelaySeconds": LIVE_DATA_DELAY_SECONDS,
                "mode": "demo" if self.ctx.demo else "live", "paper": bool(cfg.get("paper", True)),
                "tier": "free", "engineVersion": self.ctx.version}

    # ---------------------------------------------------------------- settings
    def settings(self) -> dict[str, Any]:
        return settings_from_config(self.ctx.ws.read_json(wsf.CONFIG, {}), self.ctx.demo)

    # ---------------------------------------------------------------- quotes
    async def quotes(self, symbols: list[str]) -> dict[str, dict[str, Any]]:
        """Latest delayed quotes via trader-alerts (fixtures in demo), cached briefly."""
        now = time.monotonic()
        want = sorted({s.upper() for s in symbols if s})
        missing = [s for s in want if s not in self._quotes or now - self._quotes[s][0] > QUOTE_TTL]
        if missing:
            res = await self.ctx.run_skill("alerts", ["quote"] + missing + self.ctx.demo_args("alerts")
                                           + self.ctx.now_args())
            got = (res.data or {}).get("quotes") if isinstance(res.data, dict) else None
            for s, q in (got or {}).items():
                self._quotes[s.upper()] = (now, q)
        return {s: self._quotes[s][1] for s in want if s in self._quotes}

    # ---------------------------------------------------------------- watchlist
    def last_watchlist(self) -> dict[str, Any]:
        return self.ctx.db.kv_get("last_watchlist") or self.ctx.ws.read_json(wsf.WATCHLIST, {}) or {}

    def watchlist(self) -> list[dict[str, Any]]:
        doc = self.last_watchlist()
        hits = doc.get("hits") or []
        cfg = self.ctx.config_doc()
        now_ny = self.ctx.clock.now_ny()
        cal = self.ctx.calendar.status(self.ctx.clock.now())
        mode = doc.get("mode", "orb")
        after = str(cfg.get("no_entries_after") or "15:30")
        scan_day = str(doc.get("as_of") or "")[:10]
        past_window = now_ny.strftime("%H:%M") > after or (scan_day and scan_day != now_ny.date().isoformat())
        out = []
        for h in hits:
            sym = str(h.get("symbol", "")).upper()
            cached = self.ctx.db.kv_get("entry:%s" % sym) or {}
            setup = codes.scan_setup((h.get("setups") or [mode])[0])
            dist = None
            if mode == "orb":
                state = "triggered"  # an ORB hit is a completed bar that closed above the range
            else:
                state = "waiting"
            if cached.get("date") == now_ny.date().isoformat():
                state = {"triggered": "triggered", "waiting": "waiting", "expired": "expired"}.get(
                    cached.get("status"), state)
                if state == "waiting" and cached.get("vsLevelPct") is not None:
                    dist = round(-float(cached["vsLevelPct"]), 2)
            if state != "triggered" and not cal["marketOpen"] and not past_window:
                state = "not_open"
            elif state == "waiting" and past_window:
                state = "expired"
            change = None
            prev = cached.get("prevClose")
            price = h.get("price")
            if prev and price:
                change = round((float(price) / float(prev) - 1) * 100, 2)
            out.append({"symbol": sym, "setup": setup, "entryState": state, "distancePct": dist,
                        "price": price, "changePct": change})
        return out

    def last_scan_at(self) -> str | None:
        doc = self.last_watchlist()
        as_of = str(doc.get("as_of") or "")
        try:
            local = dt.datetime.strptime(as_of[:16], "%Y-%m-%d %H:%M")
            return iso(ny_local_to_utc(local))
        except ValueError:
            created = parse_iso(doc.get("created_at"))
            return iso(created) if created else None

    # ---------------------------------------------------------------- scanner
    async def scan(self, kind: str, at: str | None, tickers: list[str] | None) -> dict[str, Any]:
        ctx = self.ctx
        args: list[str] = [kind]
        if ctx.demo:
            args += ctx.demo_args("scanner", kind) + ["--min-price", "0"]
            args += ["--now", "%s %s" % (ctx.clock.today_ny(), at)] if at else ctx.now_args()
        else:
            if at and kind == "orb":
                args += ["--at", at]
            if not tickers and not ctx.ws.exists("trader/universe.txt"):
                await ctx.run_skill("scanner", ["universe"])
        if tickers:
            args += ["--symbols", ",".join(t.upper() for t in tickers)]
        res = await ctx.run_skill("scanner", args, timeout=900)
        data = res.data if isinstance(res.data, dict) else None
        if data is None:
            raise ScanFailed(res.error_message())
        ctx.db.kv_set("last_watchlist", data)
        hits = []
        for h in data.get("hits") or []:
            setups = h.get("setups") or [kind]
            hits.append({"symbol": h["symbol"], "setup": codes.scan_setup(setups[0]), "price": h.get("price"),
                         "rangeHigh": h.get("or_high"), "rangeLow": h.get("or_low"),
                         "pctOverTrigger": h.get("pct_over"), "changePct": None})
        return {"kind": kind, "scanned": int(data.get("scanned") or 0), "hits": hits, "at": self.last_scan_at()}

    # ---------------------------------------------------------------- news
    async def news(self, tickers: list[str], hours: int) -> list[dict[str, Any]]:
        ctx = self.ctx
        args = ["--tickers"] + [t.upper() for t in tickers] + ["--hours", str(hours), "--all", "--dry-run",
                                                                "--no-moves"]
        args += [a for a in ctx.demo_args("news") if a != "--no-moves"] + ctx.now_args(iso_style=True)
        res = await ctx.run_skill("news", args)
        data = res.data if isinstance(res.data, dict) else None
        if data is None:
            raise NewsFailed(res.error_message())
        out = []
        for it in data.get("items") or []:
            when = parse_iso(it.get("time"))
            if when is None:
                continue
            touches = it.get("touches") or []
            sym = it.get("ticker") or (touches[0] if touches else "")
            out.append({"id": it["id"], "symbol": str(sym).upper(), "title": it.get("title") or "",
                        "url": it.get("link") or None, "source": "sec" if it.get("kind") == "filing" else "yahoo",
                        "publishedAt": iso(when), "tags": codes.news_tags(it.get("tags") or [])})
        return out


class ScanFailed(Exception):
    pass


class NewsFailed(Exception):
    pass
