"""Paper account service: accounts, auto-follow, the bar loop, catch-up backfill and the reports.

Paper state lives only in the paper_* tables (and kv paper_settings). It never reads or writes
trader/state/broker.json or trader/portfolio.json, so paper trades never count toward the real
daily limits, and nothing here talks to a broker.
"""

from __future__ import annotations

import asyncio
import contextvars
import csv
import datetime as dt
import io
import json
import logging
import time
import urllib.request
from collections import defaultdict
from typing import Any, Callable

from ..clock import UTC, iso, ny_local_to_utc, parse_iso, to_ny
from ..context import EngineContext, new_id
from ..pipeline.tickets import with_live_status
from . import simulator as sim
from .store import PaperStore

log = logging.getLogger("levelset.paper")

DEFAULT_SETTINGS = {"autoFollow": True, "slippagePct": 0.02, "slippagePerShare": 0.01}
SETTINGS_KEY = "paper_settings"
LAST_SEEN_KEY = "paper:lastSeen"
BACKFILL_DONE_KEY = "paper:backfill:%s"   # per New York day: the HH:MM intervals already replayed

LOOP_SECONDS = 60.0
BARS_TTL = 30.0
LIVE_FINAL_GRACE = 15 * 60       # live: flatten at the last bar this long after flat-by if the flat-by bar never came
BACKFILL_MINUTES = 15            # the catch-up replays the pipeline every 15 minutes of the missed time...
MAX_BACKFILL_RUNS = 8            # ...at most this many runs per engine start (earliest first)
YAHOO_5D_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=5m&range=5d"

# Set while a catch-up pass runs (inherited by the pipeline tasks it starts): a list collecting the
# paper position ids that pass created. Events are not published one by one meanwhile.
_BACKFILL: contextvars.ContextVar[list[str] | None] = contextvars.ContextVar("paper_backfill", default=None)

CSV_COLUMNS = ["id", "accountId", "periodId", "kind", "symbol", "setup", "qty", "entryAt", "entryPrice", "exitAt",
               "exitPrice", "exitReason", "rMultiple", "pnl", "slippageUsd", "skipReason", "backfilled", "ticketId",
               "runId", "createdAt"]
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


class PaperError(Exception):
    def __init__(self, status: int, code: str, title: str, detail: str = "") -> None:
        super().__init__(title)
        self.status, self.code, self.title, self.detail = status, code, title, detail


def _ts_iso(t: int | float | None) -> str | None:
    return iso(dt.datetime.fromtimestamp(int(t), UTC)) if t is not None else None


def _ts(text: str | None) -> int | None:
    d = parse_iso(text)
    return int(d.timestamp()) if d else None


def _ny_day(text: str | None) -> str | None:
    d = parse_iso(text)
    return to_ny(d).date().isoformat() if d else None


def _ny_ts(day: str, hhmm: str) -> int:
    hh, mm = (int(x) for x in str(hhmm).split(":"))
    return int(ny_local_to_utc(dt.datetime.combine(dt.date.fromisoformat(day), dt.time(hh, mm))).timestamp())


def _round(x: float | None, nd: int = 2) -> float | None:
    return round(float(x), nd) if x is not None else None


def _yahoo_5d(symbol: str) -> dict[str, Any]:
    from ..api.routes_bars import USER_AGENT
    req = urllib.request.Request(YAHOO_5D_URL % symbol, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310 - fixed https URL
        return json.loads(resp.read().decode("utf-8"))


class PaperService:
    def __init__(self, ctx: EngineContext) -> None:
        self.ctx = ctx
        self.store = PaperStore(ctx.db)
        self._bars: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._advance_lock: asyncio.Lock | None = None
        self.pipeline: Any = None  # PipelineService, set by build_services (the catch-up re-runs it)
        self.fetch: Callable[[str], dict[str, Any]] = _yahoo_5d  # live bars source; tests replace it

    # ================================================================ settings
    def settings(self) -> dict[str, Any]:
        return dict(DEFAULT_SETTINGS, **(self.ctx.db.kv_get(SETTINGS_KEY) or {}))

    def update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        s = self.settings()
        s.update({k: v for k, v in patch.items() if k in DEFAULT_SETTINGS and v is not None})
        self.ctx.db.kv_set(SETTINGS_KEY, s)
        return s

    def _slip(self) -> sim.Slippage:
        s = self.settings()
        return sim.Slippage(pct=float(s["slippagePct"]), per_share=float(s["slippagePerShare"]))

    # ================================================================ accounts
    def _default_balance(self) -> float:
        try:
            return float(self.ctx.config_doc().get("budget") or 5000)
        except (TypeError, ValueError):
            return 5000.0

    def _new_period(self, number: int, balance: float) -> dict[str, Any]:
        return {"id": new_id("pper"), "number": number, "startingBalanceUsd": round(float(balance), 2),
                "startedAt": iso(self.ctx.clock.now()), "endedAt": None}

    def _accounts_raw(self) -> list[dict[str, Any]]:
        accts = self.store.accounts()
        if not accts:
            a = {"id": new_id("pacc"), "name": "Paper 1", "active": True, "createdAt": iso(self.ctx.clock.now()),
                 "periods": [self._new_period(1, self._default_balance())]}
            self.store.put_account(a)
            accts = [a]
        return accts

    def active_account(self) -> dict[str, Any]:
        accts = self._accounts_raw()
        return next((a for a in accts if a.get("active")), accts[0])

    def _account_raw(self, account_id: str | None) -> dict[str, Any]:
        if not account_id:
            return self.active_account()
        self._accounts_raw()
        a = self.store.account(account_id)
        if a is None:
            raise PaperError(404, "paper_account_not_found", "Paper account not found", account_id)
        return a

    def account_json(self, a: dict[str, Any]) -> dict[str, Any]:
        cur = a["periods"][-1]
        rows = self.store.positions(a["id"], ("closed", "open"))
        periods = []
        for p in a["periods"]:
            closed = [r for r in rows if r["periodId"] == p["id"] and r["status"] == "closed"]
            periods.append(dict(p, realizedPnl=round(sum(float(r["pnl"]) for r in closed), 2), trades=len(closed)))
        realized = periods[-1]["realizedPnl"]
        opened = [r for r in rows if r["status"] == "open"]
        unreal = round(sum(self._unrealized(r) or 0.0 for r in opened), 2)
        cash = round(cur["startingBalanceUsd"] + realized, 2)
        return {"id": a["id"], "name": a["name"], "active": bool(a.get("active")),
                "startingBalanceUsd": cur["startingBalanceUsd"], "cashUsd": cash, "equityUsd": round(cash + unreal, 2),
                "realizedPnl": realized, "unrealizedPnl": unreal, "openPositions": len(opened),
                "currentPeriodId": cur["id"], "periods": periods, "createdAt": a["createdAt"]}

    def accounts(self) -> list[dict[str, Any]]:
        return [self.account_json(a) for a in self._accounts_raw()]

    def account(self, account_id: str | None) -> dict[str, Any]:
        return self.account_json(self._account_raw(account_id))

    def create_account(self, name: str | None, balance: float | None, activate: bool = True) -> dict[str, Any]:
        accts = self._accounts_raw()
        a = {"id": new_id("pacc"), "name": (name or "").strip() or "Paper %d" % (len(accts) + 1),
             "active": bool(activate), "createdAt": iso(self.ctx.clock.now()),
             "periods": [self._new_period(1, balance if balance else self._default_balance())]}
        if activate:
            for o in accts:
                if o.get("active"):
                    self.store.put_account(dict(o, active=False))
        self.store.put_account(a)
        self.store.add_event(a["id"], "account.created", a["createdAt"], {"name": a["name"]})
        return self.account_json(a)

    def activate(self, account_id: str) -> dict[str, Any]:
        a = self._account_raw(account_id)
        for o in self.store.accounts():
            if o["id"] != a["id"] and o.get("active"):
                self.store.put_account(dict(o, active=False))
        a["active"] = True
        self.store.put_account(a)
        self.store.add_event(a["id"], "account.activated", iso(self.ctx.clock.now()) or "", {})
        return self.account_json(a)

    async def reset(self, account_id: str, balance: float | None) -> dict[str, Any]:
        a = self._account_raw(account_id)
        now = self.ctx.clock.now()
        async with self._lock():
            for p in self.store.positions(a["id"], ("open", "pending"), period_id=a["periods"][-1]["id"]):
                if p["status"] == "pending":
                    self._skip_row(p, "stale")
                    continue
                bars = await self._day_bars(p["symbol"], p["day"], now)
                done = [b for b in bars if b["t"] + sim.BAR_SECONDS <= int(now.timestamp())] or bars
                if done:
                    ex = sim.flatten(done[-1], self._slip(), "reset", at=int(now.timestamp()))
                else:
                    ref = float(p["entryRef"])
                    ex = sim.Fill(t=int(now.timestamp()), ref=ref, price=sim.sell_fill(ref, self._slip()), reason="reset")
                self._close(p, ex)
        a = self.store.account(a["id"]) or a
        a["periods"][-1]["endedAt"] = iso(now)
        a["periods"].append(self._new_period(len(a["periods"]) + 1, balance if balance else self._default_balance()))
        self.store.put_account(a)
        self.store.add_event(a["id"], "account.reset", iso(now) or "", {"periodId": a["periods"][-1]["id"]})
        return self.account_json(a)

    # ================================================================ wire shapes
    @staticmethod
    def _unrealized(p: dict[str, Any]) -> float | None:
        last = p.get("lastPrice")
        if last is None or p.get("entryPrice") is None:
            return None
        return round((float(last) - float(p["entryPrice"])) * int(p["qty"]), 2)

    def position_json(self, p: dict[str, Any]) -> dict[str, Any]:
        unreal = self._unrealized(p)
        return {"symbol": p["symbol"], "qty": p["qty"], "avgPrice": p["entryPrice"],
                "lastPrice": _round(p.get("lastPrice")), "unrealizedPnl": unreal, "stop": p["stop"],
                "target": p["target"], "flatBy": p.get("flatBy"), "ticketId": p["ticketId"], "id": p["id"],
                "accountId": p["accountId"], "periodId": p["periodId"], "runId": p["runId"],
                "setup": p.get("setup") or "orb", "entryAt": p["entryAt"],
                "unrealizedR": sim.r_multiple(unreal, p["riskPerShare"], p["qty"]) if unreal is not None else None,
                "slippageUsd": p.get("entrySlippageUsd") or 0.0, "backfilled": bool(p.get("backfilled"))}

    @staticmethod
    def trade_json(p: dict[str, Any]) -> dict[str, Any]:
        closed = p["status"] == "closed"
        return {"id": p["id"], "accountId": p["accountId"], "periodId": p["periodId"],
                "kind": "closed" if closed else "skipped", "symbol": p["symbol"], "setup": p.get("setup") or "orb",
                "qty": p["qty"], "ticketId": p["ticketId"], "runId": p["runId"],
                "entryAt": p.get("entryAt") if closed else None, "entryPrice": p.get("entryPrice") if closed else None,
                "exitAt": p.get("exitAt") if closed else None, "exitPrice": p.get("exitPrice") if closed else None,
                "exitReason": p.get("exitReason") if closed else None,
                "rMultiple": p.get("rMultiple") if closed else None, "pnl": p.get("pnl") if closed else None,
                "slippageUsd": p.get("slippageUsd") if closed else None,
                "skipReason": None if closed else p.get("skipReason"), "backfilled": bool(p.get("backfilled")),
                "createdAt": p["createdAt"]}

    @staticmethod
    def ticket_paper(p: dict[str, Any]) -> dict[str, Any]:
        st = {"pending": "pending", "open": "opened", "closed": "closed", "skipped": "skipped"}[p["status"]]
        return {"status": st, "accountId": p["accountId"], "positionId": None if st == "skipped" else p["id"],
                "entryPrice": p.get("entryPrice"), "exitPrice": p.get("exitPrice"), "exitReason": p.get("exitReason"),
                "pnl": p.get("pnl"), "rMultiple": p.get("rMultiple"), "skipReason": p.get("skipReason"),
                "backfilled": bool(p.get("backfilled"))}

    # ================================================================ auto-follow
    def on_ticket(self, ticket: dict[str, Any]) -> None:
        """Pipeline hook: a ticket was created. Follow it (risk PASS) or log why not."""
        if not self.settings()["autoFollow"]:
            return
        ctx = self.ctx
        acct = self.active_account()
        t = with_live_status(ticket, ctx.clock.now())
        day = t.get("_date") or _ny_day(t["createdAt"]) or ctx.clock.today_ny()
        cfg = ctx.config_doc()
        flat_by = str(t.get("flatBy") or cfg.get("flat_by") or "15:55")
        flat_ts = _ny_ts(day, flat_by)
        try:
            sess = ctx.calendar.session(dt.date.fromisoformat(day))
            if sess:
                flat_ts = min(flat_ts, _ny_ts(day, sess[1].strftime("%H:%M")))
        except Exception:  # noqa: BLE001 - the calendar is a nicety here
            pass
        run = ctx.db.get_run(t["runId"]) or {}
        p: dict[str, Any] = {
            "id": new_id("ppos"), "accountId": acct["id"], "periodId": acct["periods"][-1]["id"],
            "ticketId": t["id"], "runId": t["runId"], "symbol": t["symbol"], "setup": run.get("setup") or "orb",
            "qty": int(t["qty"]), "stop": float(t["stop"]), "target": float(t["target"]), "flatBy": flat_by,
            "riskPerShare": float(t["riskPerShare"]), "day": day, "flatTs": flat_ts,
            "windowTs": _ny_ts(day, str(t.get("_noEntriesAfter") or cfg.get("no_entries_after") or "15:30")),
            "createdTs": _ts(t["createdAt"]), "createdAt": iso(ctx.clock.now()), "status": "pending",
            "backfilled": _BACKFILL.get() is not None, "checkedT": None}
        reason = None
        if t["status"] == "blocked" or t.get("side") != "buy" or p["qty"] <= 0:
            reason = "blocked"
        elif t["status"] == "stale":
            reason = "stale"
        elif any(o["symbol"] == p["symbol"] for o in self.store.positions(acct["id"], ("pending", "open"))):
            reason = "duplicate"
        bf = _BACKFILL.get()
        if bf is not None:
            bf.append(p["id"])
        if reason:
            self._skip_row(p, reason)
            return
        self.store.put_position(p)
        ctx.db.set_ticket_paper(t["id"], self.ticket_paper(p))
        try:
            task = asyncio.get_running_loop().create_task(self.advance())
            ctx.tasks["paper:%s" % p["id"]] = task
            task.add_done_callback(lambda _t, k="paper:%s" % p["id"]: ctx.tasks.pop(k, None))
        except RuntimeError:  # no loop (a sync caller): the background loop picks it up
            pass

    def _skip_row(self, p: dict[str, Any], reason: str) -> None:
        p.update(status="skipped", skipReason=reason)
        self.store.put_position(p)
        self.ctx.db.set_ticket_paper(p["ticketId"], self.ticket_paper(p))
        self.store.add_event(p["accountId"], "skipped", p["createdAt"], {"positionId": p["id"], "reason": reason})
        self._publish("paper.skipped", self.trade_json(p))

    def _publish(self, event: str, data: dict[str, Any]) -> None:
        if _BACKFILL.get() is not None:
            return  # one paper.backfilled summarises a catch-up pass
        self.ctx.bus.publish(event, data)

    # ================================================================ bars
    async def _day_bars(self, symbol: str, day: str, now: dt.datetime) -> list[dict[str, Any]]:
        """5-minute regular-session bars of `day`, oldest first, from the GET /bars source.

        Demo: the vendored fixture day in full (the demo replays the TSLA day; the pinned 10:15 clock
        would otherwise never see an exit). Live: Yahoo's chart JSON, bars started by `now`."""
        from ..api.routes_bars import demo_chart, parse_yahoo_chart
        if self.ctx.demo:
            doc = demo_chart(self.ctx, symbol)
            rows = parse_yahoo_chart(doc)[0] if doc else []
            try:  # the capture's last bar was still forming (10:45 bar, data taken 10:49:45): drop it
                as_of = int(doc["chart"]["result"][0]["meta"]["regularMarketTime"])
                rows = [b for b in rows if b["t"] + sim.BAR_SECONDS <= as_of]
            except (KeyError, IndexError, TypeError, ValueError):
                pass
        else:
            cached = self._bars.get(symbol)
            if cached and time.monotonic() - cached[0] < BARS_TTL:
                rows = cached[1]
            else:
                try:
                    rows = parse_yahoo_chart(await asyncio.to_thread(self.fetch, symbol))[0]
                except Exception as e:  # noqa: BLE001 - try again on the next loop
                    log.warning("paper bars for %s failed: %s", symbol, e)
                    return []
                self._bars[symbol] = (time.monotonic(), rows)
            rows = [b for b in rows if b["t"] <= int(now.timestamp())]
        out = []
        for b in rows:
            if b["t"] % sim.BAR_SECONDS:
                continue
            ny = to_ny(dt.datetime.fromtimestamp(b["t"], UTC))
            if ny.date().isoformat() == day and dt.time(9, 30) <= ny.time() < dt.time(16, 0):
                out.append(b)
        return out

    # ================================================================ the simulator loop
    def _lock(self) -> asyncio.Lock:
        if self._advance_lock is None:
            self._advance_lock = asyncio.Lock()
        return self._advance_lock

    async def advance(self, now: dt.datetime | None = None) -> None:
        """Move every pending / open position (all accounts) through the bars that are in."""
        async with self._lock():
            now = now or self.ctx.clock.now()
            for p in self.store.positions(statuses=("pending", "open")):
                try:
                    await self._advance_one(p, now)
                except Exception:  # noqa: BLE001 - one bad symbol never stops the others
                    log.exception("paper position %s failed to advance", p["id"])

    async def _advance_one(self, p: dict[str, Any], now: dt.datetime) -> None:
        now_ts = int(now.timestamp())
        bars = await self._day_bars(p["symbol"], p["day"], now)
        final = self.ctx.demo or now_ts >= p["flatTs"] + LIVE_FINAL_GRACE
        slip = self._slip()
        if p["status"] == "pending":
            got = sim.entry_fill(bars, int(p["createdTs"] or 0), slip)
            if got is None or got[1].t > p["windowTs"]:
                if got is not None or final or now_ts > p["windowTs"] + sim.BAR_SECONDS:
                    self._skip_row(p, "stale")
                return
            _, fill = got
            p.update(status="open", entryAt=_ts_iso(fill.t), entryPrice=fill.price, entryRef=fill.ref,
                     entryT=fill.t, entrySlippageUsd=round((fill.price - fill.ref) * p["qty"], 2), lastPrice=fill.ref)
            self._add_fill(p, "buy", fill)
            self.store.put_position(p)
            self.ctx.db.set_ticket_paper(p["ticketId"], self.ticket_paper(p))
            self.store.add_event(p["accountId"], "opened", p["entryAt"], {"positionId": p["id"]})
            self._publish("paper.opened", self.position_json(p))
        done = [b for b in bars if b["t"] >= p["entryT"] and (self.ctx.demo or b["t"] + sim.BAR_SECONDS <= now_ts)
                and (p.get("checkedT") is None or b["t"] > p["checkedT"])]
        _, ex = sim.walk(done, 0, p["stop"], p["target"], p["flatTs"], slip)
        if done:
            p["checkedT"] = done[-1]["t"]
            p["lastPrice"] = float(done[-1]["c"])
        if ex is None and final:
            through = [b for b in bars if b["t"] >= p["entryT"] and b["t"] < p["flatTs"]]
            last = through[-1] if through else None
            ex = sim.flatten(last, slip) if last else sim.Fill(t=p["entryT"], ref=p["entryRef"],
                                                               price=sim.sell_fill(p["entryRef"], slip),
                                                               reason="flat_by")
        if ex is not None:
            self._close(p, ex)
        else:
            self.store.put_position(p)

    def _add_fill(self, p: dict[str, Any], side: str, f: sim.Fill) -> None:
        self.store.add_fill({"id": new_id("pfill"), "positionId": p["id"], "accountId": p["accountId"], "side": side,
                             "qty": p["qty"], "price": f.price, "ref": f.ref, "at": _ts_iso(f.t) or "",
                             "reason": f.reason, "slippageUsd": round(abs(f.price - f.ref) * p["qty"], 2)})

    def _close(self, p: dict[str, Any], ex: sim.Fill) -> None:
        pnl = sim.pnl(p["qty"], p["entryPrice"], ex.price)
        p.update(status="closed", exitAt=_ts_iso(ex.t), exitPrice=ex.price, exitRef=ex.ref, exitReason=ex.reason,
                 pnl=pnl, rMultiple=sim.r_multiple(pnl, p["riskPerShare"], p["qty"]), lastPrice=ex.ref,
                 slippageUsd=round(float(p.get("entrySlippageUsd") or 0) + (ex.ref - ex.price) * p["qty"], 2))
        self._add_fill(p, "sell", ex)
        self.store.put_position(p)
        self.ctx.db.set_ticket_paper(p["ticketId"], self.ticket_paper(p))
        self.store.add_event(p["accountId"], "closed", p["exitAt"] or "", {"positionId": p["id"],
                                                                            "reason": ex.reason})
        self._publish("paper.closed", self.trade_json(p))

    async def loop(self, interval: float = LOOP_SECONDS) -> None:
        """Live mode: advance open positions on new bars; remember when the engine was last running."""
        while True:
            try:
                await self.advance()
                self.ctx.db.kv_set(LAST_SEEN_KEY, iso(self.ctx.clock.now()))
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - keep the loop alive
                log.exception("paper loop iteration failed")
            await asyncio.sleep(interval)

    async def background(self, interval: float = LOOP_SECONDS) -> None:
        """Engine start: catch up on the missed part of today first, then the loop."""
        try:
            await self.backfill()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("paper catch-up failed")
        await self.loop(interval)

    # ================================================================ catch-up backfill
    def missed_intervals(self, now: dt.datetime) -> list[dt.datetime]:
        """Pipeline times (every BACKFILL_MINUTES in the entry window) today, between the last time the
        engine was running and `now`, not replayed yet. At most MAX_BACKFILL_RUNS, earliest first."""
        ctx = self.ctx
        ny = to_ny(now)
        day = ny.date()
        if not ctx.calendar.is_trading_day(day):
            return []
        cfg = ctx.config_doc()
        start = _ny_ts(day.isoformat(), str(cfg.get("no_entries_before") or "09:45"))
        end = min(int(now.timestamp()) - 1, _ny_ts(day.isoformat(), str(cfg.get("no_entries_after") or "15:30")))
        seen = _ts(ctx.db.kv_get(LAST_SEEN_KEY))
        if seen is not None and seen > start:
            start = seen + 1
        done = set(ctx.db.kv_get(BACKFILL_DONE_KEY % day.isoformat()) or [])
        step = BACKFILL_MINUTES * 60
        t = -(-start // step) * step
        out = []
        while t <= end and len(out) < MAX_BACKFILL_RUNS:
            moment = dt.datetime.fromtimestamp(t, UTC)
            if to_ny(moment).strftime("%H:%M") not in done:
                out.append(moment)
            t += step
        return out

    async def backfill(self, now: dt.datetime | None = None,
                       params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        """Re-run today's missed pipeline intervals "as of" those times (skills get --now) and let the paper
        account follow the tickets on today's bars; marked backfilled. Returns the PaperBackfill summary
        (also sent as paper.backfilled) or None when there was nothing to replay."""
        ctx = self.ctx
        now = now or ctx.clock.now()
        if not self.settings()["autoFollow"] or self.pipeline is None:
            return None
        times = self.missed_intervals(now)
        if not times:
            return None
        made: list[str] = []
        token = _BACKFILL.set(made)
        day = to_ny(now).date().isoformat()
        try:
            for moment in times:
                hhmm = to_ny(moment).strftime("%H:%M")
                overrides = dict(params or {})
                overrides["scanner"] = dict(overrides.get("scanner") or {}, at=hhmm)
                with ctx.clock.as_of(moment):
                    run = self.pipeline.create_run("all", None, "orb", overrides)
                    task = ctx.tasks.get(run.get("id"))
                    if task is not None:
                        await task
                done = set(ctx.db.kv_get(BACKFILL_DONE_KEY % day) or [])
                ctx.db.kv_set(BACKFILL_DONE_KEY % day, sorted(done | {hhmm}))
            await self.advance(now)
        finally:
            _BACKFILL.reset(token)
        rows = [r for r in (self.store.position(i) for i in made) if r]
        summary = {"accountId": self.active_account()["id"], "from": iso(times[0]), "to": iso(times[-1]),
                   "opened": sum(1 for r in rows if r["status"] in ("open", "closed")),
                   "closed": sum(1 for r in rows if r["status"] == "closed"),
                   "skipped": sum(1 for r in rows if r["status"] == "skipped")}
        self.store.add_event(summary["accountId"], "backfilled", iso(now) or "", summary)
        ctx.bus.publish("paper.backfilled", summary)
        return summary

    # ================================================================ queries
    def _period_id(self, a: dict[str, Any], period_id: str | None) -> str:
        if not period_id:
            return a["periods"][-1]["id"]
        if period_id != "all" and period_id not in {p["id"] for p in a["periods"]}:
            raise PaperError(422, "validation_error", "Invalid request", "unknown periodId %s" % period_id)
        return period_id

    def positions(self, account_id: str | None) -> list[dict[str, Any]]:
        a = self._account_raw(account_id)
        return [self.position_json(p) for p in self.store.positions(a["id"], ("open",))]

    def _rows(self, account_id: str | None, period_id: str | None, frm: str | None, to: str | None,
              symbol: str | None = None, kind: str = "all") -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
        a = self._account_raw(account_id)
        pid = self._period_id(a, period_id)
        if frm and to and frm > to:
            raise PaperError(422, "validation_error", "Invalid request", "from is after to")
        statuses = {"closed": ("closed",), "skipped": ("skipped",)}.get(kind, ("closed", "skipped"))
        rows = [r for r in self.store.positions(a["id"], statuses, period_id=pid)
                if (not frm or r["day"] >= frm) and (not to or r["day"] <= to)
                and (not symbol or r["symbol"] == symbol.upper())]
        rows.sort(key=lambda r: (_ts(r["createdAt"]) or 0), reverse=True)
        return a, pid, rows

    def trades(self, account_id: str | None, period_id: str | None, frm: str | None, to: str | None,
               symbol: str | None, kind: str, limit: int) -> list[dict[str, Any]]:
        _, _, rows = self._rows(account_id, period_id, frm, to, symbol, kind)
        return [self.trade_json(r) for r in rows[:limit]]

    def export_csv(self, account_id: str | None, period_id: str | None, frm: str | None, to: str | None,
                   kind: str) -> tuple[str, str]:
        a, _, rows = self._rows(account_id, period_id, frm, to, None, kind)
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\r\n")
        w.writerow(CSV_COLUMNS)
        for r in rows:
            t = self.trade_json(r)
            w.writerow(["" if t.get(c) is None else ("true" if t[c] is True else "false" if t[c] is False else t[c])
                        for c in CSV_COLUMNS])
        return a["id"], buf.getvalue()

    @staticmethod
    def _side_stats(trades: list[dict[str, Any]]) -> dict[str, Any]:
        wins = [t for t in trades if float(t["pnl"]) > 0]
        rs = [t.get("rMultiple") for t in trades]
        return {"trades": len(trades), "pnl": round(sum(float(t["pnl"]) for t in trades), 2),
                "rTotal": round(sum(rs), 2) if trades and all(r is not None for r in rs) else None,
                "winRatePct": round(100.0 * len(wins) / len(trades), 1) if trades else None}

    @staticmethod
    def _summary(closed: list[dict[str, Any]]) -> dict[str, Any]:
        wins = [t for t in closed if float(t["pnl"]) > 0]
        losses = [t for t in closed if float(t["pnl"]) <= 0]
        rs = [float(t["rMultiple"]) for t in closed if t.get("rMultiple") is not None]

        def mean_r(ts: list[dict[str, Any]]) -> float | None:
            v = [float(t["rMultiple"]) for t in ts if t.get("rMultiple") is not None]
            return round(sum(v) / len(v), 2) if v else None
        return {"trades": len(closed), "wins": len(wins), "losses": len(losses),
                "winRatePct": round(100.0 * len(wins) / len(closed), 1) if closed else None,
                "totalPnl": round(sum(float(t["pnl"]) for t in closed), 2),
                "expectancyR": round(sum(rs) / len(rs), 2) if rs else None,
                "avgWinR": mean_r(wins), "avgLossR": mean_r(losses)}

    def stats(self, account_id: str | None, period_id: str | None, frm: str | None, to: str | None,
              group_by: str | None) -> dict[str, Any]:
        a, pid, rows = self._rows(account_id, period_id, frm, to)
        closed = sorted((r for r in rows if r["status"] == "closed"), key=lambda r: _ts(r["exitAt"]) or 0)
        skipped = sum(1 for r in rows if r["status"] == "skipped")
        periods = a["periods"] if pid == "all" else [p for p in a["periods"] if p["id"] == pid]
        start = float(periods[0]["startingBalanceUsd"])
        if frm:  # trades of the same period(s) before the range are already in the starting equity
            _, _, before = self._rows(a["id"], pid, None, None, kind="closed")
            start += sum(float(r["pnl"]) for r in before if r["day"] < frm)
            t0 = iso(ny_local_to_utc(dt.datetime.combine(dt.date.fromisoformat(frm), dt.time(0, 0))))
        else:
            t0 = periods[0]["startedAt"]
        curve = [{"t": t0, "equityUsd": round(start, 2), "tradeId": None}]
        eq, peak, max_dd, max_dd_pct = start, start, 0.0, 0.0
        streak = longest = 0
        gross_win = gross_loss = 0.0
        for r in closed:
            v = float(r["pnl"])
            eq += v
            curve.append({"t": r["exitAt"], "equityUsd": round(eq, 2), "tradeId": r["id"]})
            peak = max(peak, eq)
            if peak - eq > max_dd:
                max_dd = peak - eq
                max_dd_pct = 100.0 * max_dd / peak if peak > 0 else 0.0
            streak = streak + 1 if v <= 0 else 0
            longest = max(longest, streak)
            if v > 0:
                gross_win += v
            else:
                gross_loss += -v
        breakdown = []
        if group_by:
            groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for r in closed:
                entry = to_ny(parse_iso(r["entryAt"]) or dt.datetime.now(UTC))
                key = {"ticker": r["symbol"], "setup": r.get("setup") or "orb", "hour": entry.strftime("%H"),
                       "weekday": WEEKDAYS[entry.weekday()]}[group_by]
                groups[key].append(r)
            for key in sorted(groups):
                s = self._summary(groups[key])
                breakdown.append({"key": key, "trades": s["trades"], "wins": s["wins"], "losses": s["losses"],
                                  "winRatePct": s["winRatePct"], "totalPnl": s["totalPnl"],
                                  "expectancyR": s["expectancyR"]})
        s = self._summary(closed)
        return {"accountId": a["id"], "periodId": pid, "from": frm, "to": to, "startingBalanceUsd": round(start, 2),
                "endingEquityUsd": round(eq, 2), "totalPnl": s["totalPnl"], "trades": s["trades"], "wins": s["wins"],
                "losses": s["losses"], "skipped": skipped, "winRatePct": s["winRatePct"],
                "expectancyR": s["expectancyR"], "avgWinR": s["avgWinR"], "avgLossR": s["avgLossR"],
                "profitFactor": round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
                "maxDrawdownUsd": round(max_dd, 2), "maxDrawdownPct": round(max_dd_pct, 2),
                "longestLosingStreak": longest, "equityCurve": curve, "groupBy": group_by, "breakdown": breakdown}

    def _manual_round_trips(self) -> list[dict[str, Any]]:
        """Sell fills with their P/L and R (FIFO over the recorded manual fills, like GET /trades)."""
        lots: dict[str, list[list[Any]]] = defaultdict(list)
        out = []
        for f in self.ctx.db.list_fills(newest_first=False):
            sym = f["symbol"]
            if f["side"] == "buy":
                lots[sym].append([int(f["qty"]), float(f["price"]), f.get("ticketId")])
                continue
            left, risk, linked = int(f["qty"]), 0.0, True
            while left > 0 and lots[sym]:
                take = min(left, lots[sym][0][0])
                t = self.ctx.db.get_ticket(lots[sym][0][2]) if lots[sym][0][2] else None
                if t is None:
                    linked = False
                else:
                    risk += take * float(t["riskPerShare"])
                lots[sym][0][0] -= take
                left -= take
                if lots[sym][0][0] == 0:
                    lots[sym].pop(0)
            pnl = float(f.get("realizedPnl") or 0)
            out.append({"day": _ny_day(f.get("at")), "symbol": sym, "pnl": round(pnl, 2),
                        "rMultiple": round(pnl / risk, 2) if linked and risk > 0 else None})
        return out

    def compare(self, account_id: str | None, period_id: str | None, frm: str | None,
                to: str | None) -> dict[str, Any]:
        a, _, rows = self._rows(account_id, period_id, frm, to, kind="closed")
        paper: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for r in rows:
            paper[(r["day"], r["symbol"])].append(r)
        manual: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for m in self._manual_round_trips():
            if m["day"] and (not frm or m["day"] >= frm) and (not to or m["day"] <= to):
                manual[(m["day"], m["symbol"])].append(m)
        keys = sorted(set(paper) | set(manual), key=lambda k: (k[0], k[1]))
        keys.sort(key=lambda k: k[0], reverse=True)
        out_rows, both_p, both_m = [], [], []
        for k in keys:
            p, m = paper.get(k), manual.get(k)
            out_rows.append({"date": k[0], "symbol": k[1], "paper": self._side_stats(p) if p else None,
                             "manual": self._side_stats(m) if m else None})
            if p and m:
                both_p += p
                both_m += m
        totals = {"matched": sum(1 for r in out_rows if r["paper"] and r["manual"]),
                  "paperOnly": sum(1 for r in out_rows if r["paper"] and not r["manual"]),
                  "manualOnly": sum(1 for r in out_rows if r["manual"] and not r["paper"]),
                  "paper": self._side_stats(both_p), "manual": self._side_stats(both_m)}
        return {"accountId": a["id"], "from": frm, "to": to, "rows": out_rows, "totals": totals}

    def pnl_today(self) -> float | None:
        """Active account: today's realized + unrealized P/L after slippage (never part of dayPnl)."""
        a = self.active_account()
        today = self.ctx.clock.today_ny()
        rows = self.store.positions(a["id"], ("closed", "open"))
        closed = [r for r in rows if r["status"] == "closed" and _ny_day(r.get("exitAt")) == today]
        opened = [r for r in rows if r["status"] == "open"]
        if not closed and not opened and not self.settings()["autoFollow"]:
            return None
        return round(sum(float(r["pnl"]) for r in closed) + sum(self._unrealized(r) or 0.0 for r in opened), 2)
