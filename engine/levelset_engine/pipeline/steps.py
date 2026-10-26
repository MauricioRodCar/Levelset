"""The eight pipeline steps. Each runs one skill CLI exactly as its SKILL.md describes,
then reads what it wrote and turns it into a Step (status, inputs, outputs, summary, checks).

summary.inLine / outLine are the documented English fallbacks; the UI renders
summary.code + summary.values through i18n.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from ..context import EngineContext, new_id
from ..runner import SkillResult
from ..storage import workspace as wsf
from . import codes
from .params import to_flags
from .tickets import build_ticket, with_live_status


@dataclass
class StepCtx:
    ctx: EngineContext
    run: dict[str, Any]
    params: dict[str, Any]
    steps: dict[str, dict[str, Any]]  # rows of this run by key

    @property
    def ticker(self) -> str | None:
        return self.run.get("ticker")

    async def skill(self, name: str, args: list[str], json_output: bool = True) -> SkillResult:
        return await self.ctx.run_skill(name, args, json_output=json_output, locked=True)

    def read(self, rel: str) -> Any:
        return self.ctx.ws.read_json(rel)


@dataclass
class Outcome:
    status: str
    inputs: dict[str, Any] = field(default_factory=dict)
    outputs: dict[str, Any] = field(default_factory=dict)
    summary: dict[str, Any] = field(default_factory=dict)
    checks: list[str] = field(default_factory=list)
    error: str | None = None
    halt: bool = False            # stop a run-all here (the next steps cannot run)
    ticker: str | None = None     # the scanner picked or confirmed the ticker
    ticket: dict[str, Any] | None = None


def _money(x: Any) -> str:
    try:
        return "${:,.2f}".format(float(x))
    except (TypeError, ValueError):
        return "-"


def _p(x: Any) -> str:
    try:
        return "%.2f" % float(x)
    except (TypeError, ValueError):
        return "-"


def _error(res: SkillResult, inputs: dict[str, Any], code: str) -> Outcome:
    msg = res.error_message()
    return Outcome("error", inputs=inputs, outputs={"stderr": res.stderr[-4000:], "exitCode": res.code},
                   summary={"code": code + ".error", "values": {"message": msg}, "outLine": msg},
                   error=msg, halt=True)


def _cfg_subset(cfg: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {k: cfg.get(k) for k in keys}


def best_hit(hits: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The scanner's best hit: the most recent breakout (closest to the price now),
    then the strongest close over the range, then the highest price."""
    def when(h: dict[str, Any]) -> int:
        hh, mm = (int(x) for x in str(h.get("bar_start") or "00:00").split(":"))
        return hh * 60 + mm
    if not hits:
        return None
    return max(hits, key=lambda h: (when(h), float(h.get("pct_over") or 0), float(h.get("price") or 0)))


# ---------------------------------------------------------------- 1. scanner

async def run_scanner(sc: StepCtx) -> Outcome:
    ctx, p = sc.ctx, sc.params
    kind = "daily" if p.get("kind") == "daily" else "orb"
    ticker = (p.get("ticker") or sc.ticker or "").upper() or None
    args: list[str] = [kind]
    if kind == "orb":
        args += to_flags(p, ["orMinutes", "maxConfirm"])
    args += to_flags(p, ["minPrice", "minVolume"])
    if ctx.demo:
        args += ctx.demo_args("scanner", kind)
        if "minPrice" not in p:
            args += ["--min-price", "0"]  # the reel's wall had no price floor
        at = p.get("at")
        args += ["--now", "%s %s" % (ctx.clock.today_ny(), at)] if at else ctx.now_args()
    else:
        if p.get("at") and kind == "orb":
            args += ["--at", str(p["at"])]
        if ticker:
            args += ["--symbols", ticker]
        elif not ctx.ws.exists("trader/universe.txt"):
            uni = await sc.skill("scanner", ["universe"])
            if not uni.has_json:
                return _error(uni, {"kind": kind}, "scanner")
    cfg = ctx.config_doc()
    inputs = {"kind": kind, "at": p.get("at"), "symbols": ticker or "universe",
              "config": _cfg_subset(cfg, ("no_entries_after",)),
              "source": "fixtures" if ctx.demo else "yahoo"}
    res = await sc.skill("scanner", args)
    data = res.data if isinstance(res.data, dict) else None
    if data is None:
        if ticker:  # the trade can still be checked without the scan
            msg = res.error_message()
            return Outcome("check", inputs=inputs, outputs={"stderr": res.stderr[-4000:]}, checks=["scan_failed"],
                           summary={"code": "scanner.failed", "values": {"message": msg, "symbol": ticker},
                                    "inLine": "Scan for %s" % ticker, "outLine": msg}, ticker=ticker)
        return _error(res, inputs, "scanner")
    ctx.db.kv_set("last_watchlist", data)
    hits = data.get("hits") or []
    chosen = None
    checks: list[str] = []
    if ticker:
        chosen = next((h for h in hits if h.get("symbol") == ticker), None)
        if chosen is None:
            checks.append("not_in_scan")
    else:
        chosen = best_hit(hits) if kind == "orb" else (hits[0] if hits else None)
        if chosen is None:
            return Outcome("check", inputs=inputs, outputs=data, checks=["no_hits"], halt=True,
                           summary={"code": "scanner.none", "values": {"scanned": data.get("scanned", 0)},
                                    "inLine": "%s scan of %s charts" % (kind, data.get("universe", 0)),
                                    "outLine": "No chart matched the rule."})
        ticker = chosen["symbol"]
    values = {"kind": kind, "hits": len(hits), "scanned": data.get("scanned", 0), "universe": data.get("universe", 0),
              "asOf": data.get("as_of"), "symbol": ticker}
    out_line = "%d of %s charts matched" % (len(hits), data.get("scanned", 0))
    if chosen and kind == "orb":
        values.update(price=chosen.get("price"), rangeHigh=chosen.get("or_high"), rangeLow=chosen.get("or_low"),
                      at=chosen.get("at"), pctOver=chosen.get("pct_over"))
        out_line += "; %s range %s to %s, %s at %s (%+.2f%% over)" % (
            ticker, _p(chosen.get("or_low")), _p(chosen.get("or_high")), _p(chosen.get("price")),
            chosen.get("at"), float(chosen.get("pct_over") or 0))
    elif ticker:
        out_line += "; %s %s" % (ticker, "not in the hits" if not chosen else "picked")
    return Outcome("check" if checks else "done", inputs=inputs, outputs=data, checks=checks, ticker=ticker,
                   summary={"code": "scanner.found", "values": values,
                            "inLine": "%s scan, %s ET, %s charts" % (kind, data.get("as_of", ""), data.get("universe", 0)),
                            "outLine": out_line})


# ---------------------------------------------------------------- 2. news

async def run_news(sc: StepCtx) -> Outcome:
    ctx, p, t = sc.ctx, sc.params, sc.ticker
    args = ["--tickers", t, "--all"] + to_flags(p, ["hours", "forms", "movePct", "noSec"])
    args += ctx.demo_args("news") + ctx.now_args(iso_style=True)
    inputs = {"tickers": [t], "hours": p.get("hours"), "secUserAgentSet": bool(ctx.config_doc().get("sec_user_agent"))}
    res = await sc.skill("news", args)
    data = res.data if isinstance(res.data, dict) else None
    if data is None:
        msg = res.error_message()
        return Outcome("check", inputs=inputs, outputs={"stderr": res.stderr[-4000:]}, checks=["news_unavailable"],
                       summary={"code": "news.unavailable", "values": {"message": msg, "symbol": t},
                                "inLine": "Headlines for %s" % t, "outLine": msg})
    items = data.get("items") or []
    tags = {tg for it in items for tg in (it.get("tags") or [])}
    checks: list[str] = []
    if "earnings" in tags:
        checks.append("earnings_this_week")
    if "halt" in tags:
        checks.append("halt")
    if any(it.get("important") for it in items):
        checks.append("important_filing")
    if any(m.get("moving") for m in data.get("moves") or []):
        checks.append("moving")
    latest = items[0]["title"] if items else None
    values = {"symbol": t, "items": len(items), "tags": sorted(tags), "latest": latest,
              "filings": sum(1 for it in items if it.get("kind") == "filing")}
    out_line = "%d item%s for %s" % (len(items), "" if len(items) == 1 else "s", t)
    if checks:
        out_line += " (%s)" % ", ".join(checks)
    if latest:
        out_line += "; latest: %s" % latest
    return Outcome("check" if checks else "done", inputs=inputs, outputs=data, checks=checks,
                   summary={"code": "news.items", "values": values,
                            "inLine": "Headlines and 8-Ks for %s, last %s h" % (t, p.get("hours")),
                            "outLine": out_line})


# ---------------------------------------------------------------- 3. entry

async def run_entry(sc: StepCtx) -> Outcome:
    ctx, p, t = sc.ctx, sc.params, sc.ticker
    setup = sc.run.get("setup") or "orb"
    if setup == "level" and p.get("level") is None:
        msg = "a level setup needs a level: params.entry.level"
        return Outcome("error", error=msg, halt=True, summary={"code": "entry.needs_level", "outLine": msg})
    args = ["check", t, "--setup", setup, "--write"] + to_flags(p, ["orMinutes", "interval", "minVolumeX"])
    if setup == "level":
        args += to_flags(p, ["level"])
    args += ctx.demo_args("entry") + ctx.now_args()
    cfg = ctx.config_doc()
    wl = ctx.db.kv_get("last_watchlist") or {}
    hit = next((h for h in wl.get("hits") or [] if h.get("symbol") == t), None)
    inputs = {"symbol": t, "setup": setup, "watchlistHit": hit,
              "config": _cfg_subset(cfg, ("no_entries_before", "no_entries_after"))}
    res = await sc.skill("entry", args)
    data = res.data if isinstance(res.data, dict) else None
    if data is None:
        return _error(res, inputs, "entry")
    st = data.get("status")
    orr = data.get("opening_range") or {}
    trig = data.get("trigger") or {}
    last = data.get("last") or {}
    ctx.db.kv_set("entry:%s" % t, {"status": st, "phase": data.get("phase"), "level": data.get("level"),
                                   "vsLevelPct": last.get("vs_level_pct"), "price": trig.get("price") or last.get("close"),
                                   "prevClose": data.get("prev_close"), "date": data.get("date"), "setup": setup})
    values = {"symbol": t, "status": st, "phase": data.get("phase"), "level": data.get("level"),
              "rangeHigh": orr.get("high"), "rangeLow": orr.get("low"), "price": trig.get("price"),
              "time": trig.get("time"), "barStart": trig.get("bar_start"), "pctOver": trig.get("pct_over"),
              "lastClose": last.get("close"), "distancePct": last.get("vs_level_pct")}
    in_line = "%s %s on %s bars, range %s to %s" % (t, setup, data.get("interval"), _p(orr.get("low")), _p(orr.get("high")))
    if st == "triggered":
        return Outcome("done", inputs=inputs, outputs=data,
                       summary={"code": "entry.triggered", "values": values, "inLine": in_line,
                                "outLine": "Triggered %s at %s: the %s bar closed above %s" % (
                                    trig.get("time"), _p(trig.get("price")), trig.get("bar_start"), _p(data.get("level")))})
    if st == "waiting":
        return Outcome("check", inputs=inputs, outputs=data, checks=["entry_waiting"], halt=True,
                       summary={"code": "entry.waiting", "values": values, "inLine": in_line,
                                "outLine": "Waiting: %s" % data.get("reason", "")})
    if st == "expired":
        return Outcome("blocked", inputs=inputs, outputs=data, checks=["entry_expired"], halt=True,
                       summary={"code": "entry.expired", "values": values, "inLine": in_line,
                                "outLine": "Expired: %s" % data.get("reason", "")})
    check = "market_closed" if data.get("phase") in ("closed", "pre-open") else "no_data"
    return Outcome("blocked" if check == "market_closed" else "error", inputs=inputs, outputs=data, checks=[check],
                   halt=True, error=None if check == "market_closed" else data.get("reason"),
                   summary={"code": "entry." + check, "values": values, "inLine": in_line,
                            "outLine": data.get("reason", "")})


# ---------------------------------------------------------------- 4. exit

async def run_exit(sc: StepCtx) -> Outcome:
    ctx, p = sc.ctx, sc.params
    args = ["plan", "--write"] + to_flags(p, ["stop", "target", "flatBy", "entry"])
    args += ctx.demo_args("exit") + ctx.now_args()
    cfg = ctx.config_doc()
    inputs = {"entry": sc.read(wsf.ENTRY), "config": _cfg_subset(cfg, ("flat_by", "min_reward_risk")),
              "stop": p.get("stop"), "target": p.get("target")}
    res = await sc.skill("exit", args)
    data = res.data if isinstance(res.data, dict) else None
    if data is None:
        return _error(res, inputs, "exit")
    checks = [codes.exit_warning_code(w) for w in data.get("warnings") or []]
    values = {"symbol": data.get("symbol"), "entry": data.get("entry"), "stop": data.get("stop"),
              "target": data.get("target"), "riskPerShare": data.get("risk_per_share"),
              "rewardRisk": data.get("reward_risk"), "targetR": data.get("target_r"), "stopRule": data.get("stop_rule"),
              "flatBy": data.get("flat_by")}
    return Outcome("check" if checks else "done", inputs=inputs, outputs=data, checks=checks,
                   summary={"code": "exit.plan", "values": values,
                            "inLine": "Entry %s at %s, stop rule %s, target %s" % (
                                _p(data.get("entry")), data.get("entry_time") or "-", p.get("stop"), p.get("target")),
                            "outLine": "Stop %s: %s. Target %s: %s. Risk %s a share, flat by %s" % (
                                _p(data.get("stop")), data.get("stop_label"), _p(data.get("target")),
                                data.get("target_label"), _p(data.get("risk_per_share")), data.get("flat_by"))})


# ---------------------------------------------------------------- 5. time machine

async def run_timemachine(sc: StepCtx) -> Outcome:
    ctx, p = sc.ctx, sc.params
    args = ["run", "--write"] + to_flags(p, ["replays", "seed", "window", "until"])
    args += ctx.demo_args("timemachine") + ctx.now_args()
    inputs = {"plan": sc.read(wsf.PLAN), "replays": p.get("replays"), "seed": p.get("seed"), "window": p.get("window")}
    res = await sc.skill("timemachine", args)
    data = res.data if isinstance(res.data, dict) else None
    if data is None:
        return _error(res, inputs, "timemachine")
    mc, h = data.get("mc") or {}, data.get("history") or {}
    verdict = codes.tm_verdict(mc)
    checks: list[str] = []
    if verdict == "coin_flip":
        checks.append("coin_flip")
    elif verdict == "unfavorable":
        checks.append("unfavorable_odds")
    if float(mc.get("p_neither") or 0) > codes.MANY_NEITHER:
        checks.append("many_open_at_close")
    tm = codes.tm_summary(data) or {}
    values = dict(tm, greenPct=round(100.0 * float(mc.get("p_green") or 0), 1), seed=mc.get("seed"),
                  replays=mc.get("replays"), historySessions=h.get("sessions"), historyNeither=h.get("close"),
                  medianClose=mc.get("median_close"), p5Close=mc.get("p5_close"), p95Close=mc.get("p95_close"),
                  avgR=mc.get("avg_R"), until=mc.get("until"))
    return Outcome("check" if checks else "done", inputs=inputs, outputs=data, checks=checks,
                   summary={"code": "timemachine.result", "values": values,
                            "inLine": "%s replays from the %s entry, seed %s" % (
                                "{:,}".format(int(mc.get("replays") or 0)), (data.get("plan") or {}).get("entry_time"),
                                mc.get("seed")),
                            "outLine": data.get("verdict") or ""})


# ---------------------------------------------------------------- 6. budget

async def run_budget(sc: StepCtx) -> Outcome:
    ctx, p = sc.ctx, sc.params
    args = ["--write"]
    if p.get("limit") is True:
        args.append("--limit")
    elif p.get("limit") not in (None, False):
        args += ["--limit", str(p["limit"])]
    args += to_flags(p, ["budget"]) + ctx.now_args()
    cfg = ctx.config_doc()
    inputs = {"plan": sc.read(wsf.PLAN),
              "config": _cfg_subset(cfg, ("budget", "cash_buffer_pct", "max_loss_per_trade_usd", "max_position_pct",
                                          "max_order_usd", "min_order_usd", "min_reward_risk")),
              "portfolio": sc.read(wsf.PORTFOLIO), "prices": sc.read(wsf.PRICES)}
    res = await sc.skill("budget", args)
    data = res.data if isinstance(res.data, dict) else None
    if data is None:
        return _error(res, inputs, "budget")
    s = data.get("sizing") or {}
    orders = data.get("orders") or []
    values = {"qty": s.get("qty"), "cost": s.get("cost"), "maxLoss": s.get("max_loss"), "boundBy": s.get("bound_by"),
              "riskPerShare": s.get("risk_per_share"), "budget": s.get("budget"), "entry": s.get("entry"),
              "maxLossPerTrade": s.get("max_loss_per_trade_usd")}
    in_line = "Budget %s, max loss %s a trade, risk %s a share" % (
        _money(s.get("budget")), _money(s.get("max_loss_per_trade_usd")), _p(s.get("risk_per_share")))
    if not orders:
        refusal = s.get("refusal") or "no order"
        return Outcome("blocked", inputs=inputs, outputs=data, checks=[codes.budget_refusal_code(refusal)], halt=True,
                       summary={"code": "budget.refused", "values": dict(values, message=refusal),
                                "inLine": in_line, "outLine": refusal})
    checks: list[str] = []
    for n in data.get("notes") or []:
        if "is above the plan's entry" in n:
            checks.append("price_above_entry")
        elif "not used" in n:
            checks.append("stale_price")
    return Outcome("check" if checks else "done", inputs=inputs, outputs=data, checks=checks,
                   summary={"code": "budget.sized", "values": values, "inLine": in_line,
                            "outLine": "%s shares (%s), max loss %s at the stop, bound by %s" % (
                                s.get("qty"), _money(s.get("cost")), _money(s.get("max_loss")), s.get("bound_by"))})


# ---------------------------------------------------------------- 7. risk

async def run_risk(sc: StepCtx) -> Outcome:
    ctx = sc.ctx
    args = ctx.now_args()
    cfg = ctx.config_doc()
    inputs = {"orders": sc.read(wsf.ORDERS),
              "config": _cfg_subset(cfg, ("max_loss_per_trade_usd", "max_daily_loss_usd", "max_trades_per_day",
                                          "min_reward_risk", "no_entries_before", "no_entries_after", "require_stop",
                                          "pdt_guard", "paper")),
              "brokerLog": sc.read(wsf.BROKER), "portfolio": sc.read(wsf.PORTFOLIO)}
    res = await sc.skill("risk", args)
    data = res.data if isinstance(res.data, dict) else None
    if data is None or not data.get("results"):
        return _error(res, inputs, "risk")
    r = data["results"][0]
    today = data.get("today") or {}
    values = {"verdict": r.get("verdict"), "maxLoss": r.get("max_loss"),
              "maxLossLimit": cfg.get("max_loss_per_trade_usd"), "rewardRisk": r.get("reward_risk"),
              "minRewardRisk": cfg.get("min_reward_risk"), "tradesToday": today.get("entries_placed"),
              "maxTradesPerDay": cfg.get("max_trades_per_day"), "lossAtRisk": today.get("loss_at_risk"),
              "dailyLossLimit": cfg.get("max_daily_loss_usd"), "cashAfter": data.get("cash_after")}
    in_line = "%s %s %s, entry %s, stop %s" % (r.get("side"), r.get("symbol"), r.get("amount"),
                                                _p(r.get("entry_ref")), _p(r.get("stop")))
    if r.get("verdict") != "PASS":
        reasons = r.get("reasons") or []
        return Outcome("blocked", inputs=inputs, outputs=data, checks=codes.risk_codes(reasons),
                       summary={"code": "risk.block", "values": dict(values, reasons=reasons), "inLine": in_line,
                                "outLine": "BLOCK: " + "; ".join(reasons)})
    checks = ["live_account"] if not data.get("paper", True) else []
    return Outcome("check" if checks else "done", inputs=inputs, outputs=data, checks=checks,
                   summary={"code": "risk.pass", "values": values, "inLine": in_line,
                            "outLine": "PASS: max loss %s (limit %s), reward:risk %s" % (
                                _money(r.get("max_loss")), _money(cfg.get("max_loss_per_trade_usd")),
                                _p(r.get("reward_risk")))})


# ---------------------------------------------------------------- 8. ticket

async def run_ticket(sc: StepCtx) -> Outcome:
    ctx = sc.ctx
    orders_doc = sc.read(wsf.ORDERS) or {}
    orders = orders_doc.get("orders") if isinstance(orders_doc, dict) else orders_doc
    risk_doc = sc.read(wsf.RISK) or {}
    inputs = {"orders": orders_doc, "risk": risk_doc}
    res = await sc.skill("broker", ["show"] + ctx.now_args())
    shown = res.data
    if not orders:
        return _error(res, inputs, "ticket")
    order = orders[0]
    rr = next((x for x in risk_doc.get("results") or [] if x.get("index") == 1), None)
    ticket = build_ticket(new_id("tkt"), sc.run["id"], order, rr, sc.read(wsf.TIMEMACHINE), sc.read(wsf.PLAN),
                          ctx.config_doc(), ctx.clock.now())
    ticket = with_live_status(ticket, ctx.clock.now())
    first = shown[0] if isinstance(shown, list) and shown else (shown if isinstance(shown, dict) else {})
    values = {"ticketId": ticket["id"], "status": ticket["status"], "symbol": ticket["symbol"], "qty": ticket["qty"],
              "entry": ticket["entry"], "stop": ticket["stop"], "target": ticket["target"],
              "maxLoss": ticket["maxLoss"], "ready": bool(first.get("ready"))}
    status = {"ready": "done", "blocked": "blocked", "stale": "check"}[ticket["status"]]
    checks = ticket["riskReasons"] if ticket["status"] == "blocked" else (["stale"] if ticket["status"] == "stale" else [])
    return Outcome(status, inputs=inputs, outputs={"tickets": shown}, checks=checks, ticket=ticket,
                   summary={"code": "ticket." + ticket["status"], "values": values,
                            "inLine": first.get("plain") or "",
                            "outLine": "%s %s %s: entry %s, stop loss %s, take profit %s (%s)" % (
                                ticket["side"].upper(), ticket["qty"], ticket["symbol"], _p(ticket["entry"]),
                                _p(ticket["stop"]), _p(ticket["target"]), ticket["status"].upper())})


HANDLERS: dict[str, Callable[[StepCtx], Awaitable[Outcome]]] = {
    "scanner": run_scanner,
    "news": run_news,
    "entry": run_entry,
    "exit": run_exit,
    "timemachine": run_timemachine,
    "budget": run_budget,
    "risk": run_risk,
    "ticket": run_ticket,
}
