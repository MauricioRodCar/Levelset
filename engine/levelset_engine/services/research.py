"""Analyst (trader-analyst facts.py) and Congress trades (trader-pelosi ptr.py).

Both skills run through the normal skill runner, one worker process per call.
They do not touch the per-run trader/*.json files, so they skip the workspace
lock: an analyst lookup does not wait for a pipeline run to finish.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import shutil
import time
from typing import Any

from ..clock import iso
from ..context import EngineContext
from ..runner import SkillResult
from ..storage import workspace as wsf
from . import research_demo as demo

ANALYST_TTL = 3600.0
SEC_PARALLEL = 2
SEC_PLACEHOLDER = "you@example.com"
DERIVED_TEXT = ("Derived quarters are the 10-K year minus the three 10-Qs; derived EPS is approximate.")
# A company files its earnings 8-K about one quarter after the last one.
NEXT_REPORT_DAYS = 91

CONGRESS_SCHEMA = """
CREATE TABLE IF NOT EXISTS congress_filings (
    doc_id TEXT PRIMARY KEY,
    member TEXT NOT NULL,
    district TEXT,
    filed TEXT NOT NULL,
    url TEXT NOT NULL,
    parsed INTEGER NOT NULL,
    trade_count INTEGER NOT NULL,
    checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS congress_trades (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    filed TEXT NOT NULL,
    idx INTEGER NOT NULL,
    data TEXT NOT NULL
);
"""
CONGRESS_SETTINGS_KEY = "congress_settings"
CONGRESS_CHECKED_KEY = "congress_last_checked"
FIRST_RUN_DAYS = 45  # like ptr.py `new`: a first check shows the last 45 days only
MAX_FETCH_PER_REFRESH = 25  # PDFs downloaded per refresh; the rest wait for the next one
CONGRESS_POLL_SECONDS = 6 * 3600.0

OWNERS = {"": "self", "SP": "spouse", "JT": "joint", "DC": "dependent_child"}
TYPES = {"P": ("buy", False), "S": ("sell", False), "S (partial)": ("sell", True), "E": ("exchange", False)}


class AnalystError(Exception):
    def __init__(self, status: int, code: str, title: str, detail: str | None = None) -> None:
        super().__init__(title)
        self.status, self.code, self.title, self.detail = status, code, title, detail


class CongressFailed(Exception):
    pass


def sec_identity_ok(ua: Any) -> bool:
    """facts.py's own rule: a name and an email that is not the placeholder."""
    ua = str(ua or "").strip()
    return bool(ua) and "@" in ua and SEC_PLACEHOLDER not in ua


def _date(s: str | None) -> dt.date | None:
    try:
        return dt.date.fromisoformat(str(s)[:10]) if s else None
    except ValueError:
        return None


def _r1(v: float | None) -> float | None:
    return None if v is None else round(v, 1)


def _year_ago(rows: list[dict[str, Any]], end: str) -> dict[str, Any] | None:
    """The row ending about 365 days earlier (facts.py's _yoy_match: within 10 days)."""
    target = _date(end)
    if target is None:
        return None
    target -= dt.timedelta(days=365)
    best = None
    for r in rows:
        d = _date(r["end"])
        if d is None:
            continue
        gap = abs((d - target).days)
        if gap <= 10 and (best is None or gap < best[0]):
            best = (gap, r)
    return best[1] if best else None


def _pts(cur: float | None, prev: float | None) -> float | None:
    return None if cur is None or prev is None else round(cur - prev, 1)


def week_bounds(today: dt.date) -> tuple[dt.date, dt.date]:
    monday = today - dt.timedelta(days=today.weekday())
    return monday, monday + dt.timedelta(days=6)


def reports_this_week(earnings8k: dict[str, Any] | None, today: dt.date) -> bool:
    """True when the earnings 8-K was filed this week, or the next one is due this week.

    The News step flags earnings_this_week from an earnings headline or 8-K. Ahead of the
    report there is no headline yet, so the next date is estimated as one quarter after the
    last earnings 8-K."""
    filed = _date((earnings8k or {}).get("filed"))
    if filed is None:
        return False
    start, end = week_bounds(today)
    if start <= filed <= end:
        return True
    due = filed + dt.timedelta(days=NEXT_REPORT_DAYS)
    return start <= due <= end


def to_report(symbol: str, item: dict[str, Any], quarters: int, today: dt.date, fetched_at: str) -> dict[str, Any]:
    """facts.py --json item -> AnalystReport."""
    result = item.get("result") or {}
    rows = result.get("rows") or []
    filings = item.get("filings") or {}
    out_q = []
    for r in rows[:quarters]:
        ago = _year_ago(rows, r["end"]) or {}
        out_q.append({
            "end": r["end"], "start": r.get("start"), "fiscal": (r.get("fiscal") or "").strip() or r["end"],
            "derived": bool(r.get("derived")),
            "revenue": r.get("revenue"), "revenueYoyPct": r.get("revenue_yoy"),
            "grossProfit": r.get("gross_profit"), "grossMarginPct": r.get("gross_margin"),
            "grossMarginYoyPts": _pts(r.get("gross_margin"), ago.get("gross_margin")),
            "operatingIncome": r.get("operating_income"), "operatingMarginPct": r.get("operating_margin"),
            "operatingMarginYoyPts": _pts(r.get("operating_margin"), ago.get("operating_margin")),
            "netMarginPct": r.get("net_margin"), "netMarginYoyPts": _pts(r.get("net_margin"), ago.get("net_margin")),
            "netIncome": r.get("net_income"), "netIncomeYoyPct": r.get("net_income_yoy"),
            "epsDiluted": r.get("eps_diluted"), "epsDilutedYoyPct": r.get("eps_yoy"),
            "form": r.get("form"), "filed": r.get("filed"),
        })
    ttm = result.get("ttm") or {}
    rep = filings.get("report")
    e8 = filings.get("earnings_8k")
    latest = None
    if rep:
        latest = {"form": rep["form"], "filed": rep["filed"], "period": rep.get("period") or None, "url": rep["url"]}
    e8k = None
    if e8:
        e8k = {"form": e8.get("form") or "8-K", "filed": e8["filed"], "period": None, "url": e8["url"],
               "pressReleaseUrl": e8.get("exhibit") or e8.get("index")}
    return {
        "symbol": symbol, "entity": result.get("entity"), "cik": str(result.get("cik") or "").zfill(10),
        "quarters": out_q,
        "ttm": {"revenue": ttm.get("revenue"), "netIncome": ttm.get("net_income"),
                "epsDiluted": ttm.get("eps_diluted")},
        "changes": changes(rows, quarters, item.get("changes") or [], item.get("note"), rep),
        "latestReport": latest, "earnings8k": e8k, "reportsThisWeek": reports_this_week(e8, today),
        "source": "SEC XBRL company facts", "fetchedAt": fetched_at,
    }


def changes(rows: list[dict[str, Any]], quarters: int, texts: list[str], note: str | None,
            report: dict[str, Any] | None) -> list[dict[str, Any]]:
    """facts.py's changes() as structured codes, same conditions and order, with its sentences as text."""
    if not rows:
        return []
    cur, prev = rows[0], (rows[1] if len(rows) > 1 else None)
    out: list[dict[str, Any]] = [{"code": "quarter_summary", "values": {
        "end": cur["end"], "derived": bool(cur.get("derived")), "revenue": cur.get("revenue"),
        "revenueYoyPct": cur.get("revenue_yoy"), "netIncome": cur.get("net_income"),
        "netIncomeYoyPct": cur.get("net_income_yoy"), "epsDiluted": cur.get("eps_diluted"),
        "epsDilutedYoyPct": cur.get("eps_yoy")}}]
    for key, code in (("gross_margin", "gross_margin"), ("operating_margin", "operating_margin"),
                      ("net_margin", "net_margin")):
        if cur.get(key) is None:
            continue
        qoq = _pts(cur[key], prev.get(key)) if prev else None
        out.append({"code": code, "values": {"valuePct": cur[key], "qoqPts": qoq}})
    ni, oi = cur.get("net_income"), cur.get("operating_income")
    if ni is not None and oi is not None and ni > oi:
        out.append({"code": "net_above_operating", "values": {"netIncome": ni, "operatingIncome": oi}})
    if prev and cur.get("revenue") is not None and prev.get("revenue"):
        pct = round(100.0 * (cur["revenue"] - prev["revenue"]) / abs(prev["revenue"]), 1)
        out.append({"code": "revenue_qoq", "values": {"pct": pct}})
    for i, c in enumerate(out):
        c["text"] = texts[i] if i < len(texts) else ""
    if note and report:
        out.append({"code": "facts_stale", "text": note, "values": {
            "latestEnd": cur["end"], "form": report.get("form"), "period": report.get("period"),
            "filed": report.get("filed"), "url": report.get("url")}})
    if any(r.get("derived") for r in rows[:quarters]):
        out.append({"code": "derived_quarters", "values": {}, "text": DERIVED_TEXT})
    return out


def _analyst_error(res: SkillResult, symbol: str) -> AnalystError:
    msg = res.error_message()
    if msg.startswith("facts: "):
        msg = msg[len("facts: "):]
    low = msg.lower()
    if "user-agent" in low:
        return AnalystError(422, "sec_identity_missing", "SEC identity missing", msg)
    if "no sec cik" in low or "no xbrl" in low or "no quarterly revenue" in low or "has no data" in low \
            or "offline: no file" in low:
        return AnalystError(404, "no_sec_filer", "SEC has no reported numbers for %s" % symbol, msg)
    return AnalystError(502, "analyst_failed", "SEC could not be reached", msg)


# ---------------------------------------------------------------- congress rows

def to_trade(row: dict[str, Any], idx: int, filing: dict[str, Any]) -> dict[str, Any]:
    """ptr.py parse row -> CongressTrade (inWatchlist / inPositions are set when read)."""
    kind, partial = TYPES.get(row.get("type") or "", ("exchange", False))
    if row.get("type_name") == "partial sale":
        kind, partial = "sell", True
    opt = row.get("option")
    option = None
    if opt:
        option = {"kind": opt.get("kind"), "strike": opt.get("strike"), "expires": opt.get("expires"),
                  "contracts": opt.get("contracts"), "exercised": bool(opt.get("exercised"))}
    trade_date = row.get("date") or filing["filedDate"]
    days = row.get("days_to_disclose")
    return {
        "id": "%s-%d" % (filing["docId"], idx), "docId": filing["docId"], "member": filing["member"],
        "district": filing.get("district"), "owner": OWNERS.get(row.get("owner") or "", "self"),
        "ticker": row.get("ticker"), "assetName": row.get("asset") or "", "assetType": row.get("asset_type"),
        "type": kind, "partial": partial, "option": option, "shares": row.get("shares"),
        "tradeDate": trade_date, "notifiedDate": row.get("notified"), "filedDate": filing["filedDate"],
        "amountRange": row.get("amount") or "", "amountLow": row.get("amount_low"),
        "amountHigh": row.get("amount_high"), "daysToDisclose": days, "late": bool(row.get("late")),
        "description": row.get("description"), "inWatchlist": False, "inPositions": False,
        "filingUrl": filing["filingUrl"],
    }


class ResearchService:
    def __init__(self, ctx: EngineContext, market: Any = None, trading: Any = None) -> None:
        self.ctx = ctx
        self.market = market
        self.trading = trading
        self._cache: dict[tuple[str, int], tuple[float, dict[str, Any]]] = {}
        self._refresh_lock: asyncio.Lock | None = None
        self._sec_slots: asyncio.Semaphore | None = None
        ctx.db._conn.executescript(CONGRESS_SCHEMA)  # own tables, same database file
        ctx.db._conn.commit()

    async def _skill(self, skill: str, args: list[str], timeout: float | None = None) -> SkillResult:
        return await asyncio.to_thread(self.ctx.run_skill_blocking, skill, args, True, timeout)

    # ---------------------------------------------------------------- analyst
    def sec_identity_set(self) -> bool:
        return sec_identity_ok(self.ctx.config_doc().get("sec_user_agent"))

    async def analyst(self, symbol: str, quarters: int = 6) -> dict[str, Any]:
        symbol = symbol.upper()
        key = (symbol, quarters)
        hit = self._cache.get(key)
        if hit and (self.ctx.demo or time.monotonic() - hit[0] < ANALYST_TTL):
            return hit[1]
        args = [symbol, "--quarters", str(min(quarters + 4, 16))]
        if self.ctx.demo:
            folder = demo.prepare_analyst(self.ctx.fixtures, self.ctx.ws.path(demo.ANALYST_DIR))
            args += ["--offline", str(folder)]
        elif not self.sec_identity_set():
            raise AnalystError(422, "sec_identity_missing", "SEC identity missing",
                               "Set your name and email in Settings > Data & SEC.")
        if self._sec_slots is None:
            self._sec_slots = asyncio.Semaphore(SEC_PARALLEL)
        async with self._sec_slots:  # watchlist badges ask for many tickers at once; SEC limits rates
            res = await self._skill("analyst", args)
        items = res.data if isinstance(res.data, list) else []
        item = next((it for it in items if str(it.get("ticker", "")).upper() == symbol), None)
        if item is None:
            raise _analyst_error(res, symbol)
        report = to_report(symbol, item, quarters, self.ctx.clock.now_ny().date(), iso(self.ctx.clock.now()) or "")
        self._cache[key] = (time.monotonic(), report)
        return report

    # ---------------------------------------------------------------- congress settings
    def congress_settings(self) -> dict[str, Any]:
        doc = self.ctx.db.kv_get(CONGRESS_SETTINGS_KEY) or {}
        return {"notifyOnWatchlist": bool(doc.get("notifyOnWatchlist", True)),
                "members": [str(m) for m in doc.get("members") or []]}

    def update_congress_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        cur = self.congress_settings()
        if patch.get("notifyOnWatchlist") is not None:
            cur["notifyOnWatchlist"] = bool(patch["notifyOnWatchlist"])
        if patch.get("members") is not None:
            seen: list[str] = []
            for m in patch["members"]:
                m = " ".join(str(m).split())
                if m and m.lower() not in [x.lower() for x in seen]:
                    seen.append(m)
            cur["members"] = seen
        self.ctx.db.kv_set(CONGRESS_SETTINGS_KEY, cur)
        return cur

    # ---------------------------------------------------------------- congress feed
    def _watch_sets(self) -> tuple[set[str], set[str]]:
        watch: set[str] = set()
        if self.market is not None:
            try:
                watch = {str(w.get("symbol", "")).upper() for w in self.market.watchlist()}
            except Exception:  # noqa: BLE001 - a broken scan file must not break the feed
                watch = set()
        held: set[str] = set()
        if self.trading is not None:
            try:
                held = {s.upper() for s in self.trading._positions()}
            except Exception:  # noqa: BLE001
                held = set()
        doc = self.ctx.ws.read_json(wsf.PORTFOLIO, {}) or {}
        for p in doc.get("positions", []) if isinstance(doc, dict) else []:
            if isinstance(p, dict) and p.get("ticker") and (p.get("qty") or p.get("shares") or 0) > 0:
                held.add(str(p["ticker"]).upper())
        watch.discard("")
        return watch, held

    def _flag(self, trades: list[dict[str, Any]], watch: set[str], held: set[str]) -> list[dict[str, Any]]:
        for t in trades:
            tk = (t.get("ticker") or "").upper()
            t["inWatchlist"] = bool(tk) and tk in watch
            t["inPositions"] = bool(tk) and tk in held
        return trades

    def _filing_row(self, r: Any) -> dict[str, Any]:
        return {"docId": r["doc_id"], "member": r["member"], "district": r["district"], "filedDate": r["filed"],
                "filingUrl": r["url"], "parsed": bool(r["parsed"]), "tradeCount": int(r["trade_count"])}

    async def feed(self, member: str | None = None, ticker: str | None = None, kind: str | None = None,
                   date_from: str | None = None, date_to: str | None = None, watchlist_only: bool = False,
                   limit: int = 200) -> dict[str, Any]:
        self.ensure_poll()
        if self.ctx.demo and self.ctx.db.kv_get(CONGRESS_CHECKED_KEY) is None:
            await self.refresh(notify=False)
        db = self.ctx.db
        where, args = [], []
        if date_from:
            where.append("filed >= ?")
            args.append(date_from)
        if date_to:
            where.append("filed <= ?")
            args.append(date_to)
        sql = "SELECT data FROM congress_trades%s ORDER BY filed DESC, doc_id DESC, idx ASC" % (
            " WHERE " + " AND ".join(where) if where else "")
        trades = [json.loads(r["data"]) for r in db._all(sql, tuple(args))]
        watch, held = self._watch_sets()
        self._flag(trades, watch, held)
        m = (member or "").strip().lower()
        tk = (ticker or "").strip().upper()
        out = []
        for t in trades:
            if m and m not in t["member"].lower():
                continue
            if tk and (t.get("ticker") or "").upper() != tk:
                continue
            if kind and t["type"] != kind:
                continue
            if watchlist_only and not (t["inWatchlist"] or t["inPositions"]):
                continue
            out.append(t)
            if len(out) >= limit:
                break
        fsql = "SELECT * FROM congress_filings WHERE parsed = 0%s ORDER BY filed DESC, doc_id DESC" % (
            "".join(" AND " + w for w in where))
        unread = [self._filing_row(r) for r in db._all(fsql, tuple(args))]
        if m:
            unread = [f for f in unread if m in f["member"].lower()]
        if tk or kind or watchlist_only:
            unread = []  # an unread PDF cannot match a ticker or type filter
        return {"trades": out, "unreadFilings": unread, "lastCheckedAt": db.kv_get(CONGRESS_CHECKED_KEY)}

    # ---------------------------------------------------------------- congress refresh
    @property
    def refresh_lock(self) -> asyncio.Lock:
        if self._refresh_lock is None:
            self._refresh_lock = asyncio.Lock()
        return self._refresh_lock

    async def _index(self, year: int, members: list[str]) -> list[dict[str, Any]]:
        args = ["index", "--year", str(year), "--limit", "100000"]
        for mem in members:
            args += ["--member", mem]
        if self.ctx.demo:
            args += ["--offline", str(self.ctx.fixtures / demo.PELOSI_INDEX)]
        res = await self._skill("pelosi", args)
        if isinstance(res.data, list):
            return res.data
        raise CongressFailed(res.error_message())

    async def _read(self, filing: dict[str, Any]) -> list[dict[str, Any]] | None:
        """Rows of one PTR, or None when it cannot be read (no pdftotext, scanned paper filing)."""
        if self.ctx.demo:
            rel = demo.PELOSI_TEXTS.get(filing["doc_id"])
            if not rel:
                return None
            res = await self._skill("pelosi", ["parse", str(self.ctx.fixtures / rel), "--filed", filing["filed"]])
        else:
            if not shutil.which("pdftotext"):
                return None
            res = await self._skill("pelosi", ["fetch", filing["doc_id"], "--year", str(filing["year"]),
                                               "--filed", filing["filed"], "--pdf-dir", "trader/state/ptr-pdfs"])
        if isinstance(res.data, dict):
            rows = res.data.get("rows") or []
            return rows or None
        return None

    async def refresh(self, notify: bool = True) -> dict[str, Any]:
        async with self.refresh_lock:
            return await self._refresh(notify)

    async def _refresh(self, notify: bool) -> dict[str, Any]:
        db = self.ctx.db
        today = self.ctx.clock.now_ny().date()
        members = self.congress_settings()["members"]
        years = [today.year] + ([today.year - 1] if today.month == 1 and not self.ctx.demo else [])
        rows: list[dict[str, Any]] = []
        for y in years:
            rows += await self._index(y, members)
        first = db.kv_get(CONGRESS_CHECKED_KEY) is None
        cutoff = (today - dt.timedelta(days=FIRST_RUN_DAYS)).isoformat()
        known = {r["doc_id"] for r in db._all("SELECT doc_id FROM congress_filings")}
        fresh = [r for r in rows if r.get("type") == "P" and r.get("doc_id") and r["doc_id"] not in known
                 and r.get("filed") and r["filed"] <= today.isoformat()
                 and (self.ctx.demo or not first or r["filed"] >= cutoff)]
        fresh.sort(key=lambda r: (r["filed"], r["doc_id"]))
        fetches = 0
        checked = iso(self.ctx.clock.now()) or ""
        stored, new_trades, unread = 0, 0, 0
        watch, held = self._watch_sets()
        settings = self.congress_settings()
        for r in fresh:
            needs_fetch = not self.ctx.demo and shutil.which("pdftotext") is not None
            if needs_fetch and fetches >= MAX_FETCH_PER_REFRESH:
                break  # stays unknown: read at the next refresh
            fetches += 1 if needs_fetch else 0
            try:
                parsed = await self._read(r)
            except Exception:  # noqa: BLE001 - one bad PDF must not stop the refresh
                parsed = None
            filing = {"docId": r["doc_id"], "member": r.get("name") or r.get("last") or "?",
                      "district": r.get("district") or None, "filedDate": r["filed"], "filingUrl": r["url"],
                      "parsed": bool(parsed), "tradeCount": len(parsed or [])}
            trades = [to_trade(row, i + 1, filing) for i, row in enumerate(parsed or [])]
            db._exec("INSERT OR REPLACE INTO congress_filings (doc_id, member, district, filed, url, parsed, "
                     "trade_count, checked_at) VALUES (?,?,?,?,?,?,?,?)",
                     (filing["docId"], filing["member"], filing["district"], filing["filedDate"],
                      filing["filingUrl"], 1 if filing["parsed"] else 0, filing["tradeCount"], checked))
            for i, t in enumerate(trades):
                db._exec("INSERT OR REPLACE INTO congress_trades (id, doc_id, filed, idx, data) VALUES (?,?,?,?,?)",
                         (t["id"], t["docId"], t["filedDate"], i + 1, json.dumps(t, separators=(",", ":"))))
            stored += 1
            new_trades += len(trades)
            unread += 0 if filing["parsed"] else 1
            if notify and settings["notifyOnWatchlist"] and trades:
                flagged = [t for t in self._flag(trades, watch, held) if t["inWatchlist"] or t["inPositions"]]
                if flagged:
                    self.ctx.bus.publish("congress.filing", {"filing": filing, "trades": flagged})
        db.kv_set(CONGRESS_CHECKED_KEY, checked)
        return {"checkedAt": checked, "newFilings": stored, "newTrades": new_trades, "unreadFilings": unread}

    # ---------------------------------------------------------------- background poll (live only)
    def ensure_poll(self) -> None:
        """Check the Clerk every few hours while the engine runs, so congress.filing can fire."""
        cfg = self.ctx.config
        if self.ctx.demo or not cfg.start_background or "congress_poll" in self.ctx.tasks:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self.ctx.tasks["congress_poll"] = loop.create_task(self._poll())

    async def _poll(self) -> None:
        while True:
            await asyncio.sleep(CONGRESS_POLL_SECONDS)
            try:
                await self.refresh(notify=True)
            except Exception:  # noqa: BLE001 - try again next time
                pass
