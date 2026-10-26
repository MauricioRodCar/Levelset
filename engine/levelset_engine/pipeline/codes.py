"""Machine codes derived from the skills' plain-English output (the UI translates codes)."""

from __future__ import annotations

import re
from typing import Any

COIN_FLIP = 0.05      # trader-timemachine's own thresholds
MANY_NEITHER = 0.40


def risk_reason_code(reason: str) -> str:
    """trader-risk prefixes every reason with its check name: "loss: 9 shares x ..." -> "loss"."""
    text = (reason or "").strip()
    if text.lower().startswith("reward:risk"):
        return "reward_risk"
    head = text.split(":", 1)[0].strip().lower()
    code = re.sub(r"[^a-z0-9]+", "_", head).strip("_")
    return code or "other"


def risk_codes(reasons: list[str]) -> list[str]:
    out: list[str] = []
    for r in reasons or []:
        c = risk_reason_code(r)
        if c not in out:
            out.append(c)
    return out


def tm_verdict(mc: dict[str, Any]) -> str:
    """favorable | coin_flip | unfavorable, by the same lean the skill's verdict line uses."""
    pt, ps = float(mc.get("p_target") or 0), float(mc.get("p_stop") or 0)
    if pt + ps <= 0:
        return "coin_flip"
    r = float(mc.get("r_at_target") or 1.0)
    d = pt / (pt + ps) - 1.0 / (1.0 + r)
    if abs(d) < COIN_FLIP:
        return "coin_flip"
    return "favorable" if d > 0 else "unfavorable"


def tm_summary(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    """trader/timemachine.json -> Ticket.timeMachine."""
    if not doc or not isinstance(doc.get("mc"), dict):
        return None
    mc, h = doc["mc"], doc.get("history") or {}
    return {
        "targetFirstPct": round(100.0 * float(mc.get("p_target") or 0), 1),
        "stopFirstPct": round(100.0 * float(mc.get("p_stop") or 0), 1),
        "openAtClosePct": round(100.0 * float(mc.get("p_neither") or 0), 1),
        "verdict": tm_verdict(mc),
        "historyFired": int(h.get("triggered") or 0),
        "historyWon": int(h.get("target") or 0),
        "historyLost": int(h.get("stop") or 0),
    }


def budget_refusal_code(refusal: str) -> str:
    r = (refusal or "").lower()
    if "max loss" in r:
        return "max_loss_per_trade"
    if "reward:risk" in r:
        return "reward_risk"
    if "minimum order" in r:
        return "min_order"
    if "costs" in r:
        return "position_limit"
    return "budget_refused"


def exit_warning_code(warning: str) -> str:
    w = (warning or "").lower()
    if "min_reward_risk" in w:
        return "reward_risk_below_min"
    if "early close" in w:
        return "early_close"
    if "not today" in w:
        return "plan_not_today"
    return "exit_note"


NEWS_TAGS = {"people": "leadership", "capital": "other", "risk": "other"}
KNOWN_NEWS_TAGS = {"earnings", "analyst", "deal", "halt", "regulatory", "macro", "leadership", "legal", "other"}


def news_tags(tags: list[str]) -> list[str]:
    """trader-news tags -> the contract's tag set (people -> leadership, capital/risk -> other)."""
    out: list[str] = []
    for t in tags or []:
        m = NEWS_TAGS.get(t, t)
        if m not in KNOWN_NEWS_TAGS:
            m = "other"
        if m not in out:
            out.append(m)
    return out


SCAN_SETUPS = {"breakout_20d": "breakout20", "reclaim_ma20": "reclaim20"}


def scan_setup(setup: str) -> str:
    return SCAN_SETUPS.get(setup, setup)
