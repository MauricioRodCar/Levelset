"""Settings (API) <-> trader/config.json (what the skills read).

Key names come from trader-budget/config.example.json and the skills' sources:
budget, cash_buffer_pct, paper (size.py, check.py, ticket.py); max_loss_per_trade_usd,
max_daily_loss_usd, max_trades_per_day, min_reward_risk, max_position_pct,
max_order_usd, require_stop, pdt_guard (check.py, size.py); no_entries_before /
no_entries_after (entry.py, check.py, scan.py); flat_by (exit.py, alerts.py);
sec_user_agent (news.py, facts.py).
"""

from __future__ import annotations

from typing import Any

# API path (section, camelCase key) -> config.json key
FIELD_MAP: dict[tuple[str, str], str] = {
    ("account", "accountSizeUsd"): "budget",
    ("account", "cashBufferPct"): "cash_buffer_pct",
    ("account", "paper"): "paper",
    ("limits", "maxLossPerTradeUsd"): "max_loss_per_trade_usd",
    ("limits", "maxDailyLossUsd"): "max_daily_loss_usd",
    ("limits", "maxTradesPerDay"): "max_trades_per_day",
    ("limits", "minRewardRisk"): "min_reward_risk",
    ("limits", "maxPositionPct"): "max_position_pct",
    ("limits", "maxOrderUsd"): "max_order_usd",
    ("limits", "noEntriesBefore"): "no_entries_before",
    ("limits", "noEntriesAfter"): "no_entries_after",
    ("limits", "flatBy"): "flat_by",
    ("limits", "requireStop"): "require_stop",
    ("limits", "pdtGuard"): "pdt_guard",
    ("data", "secUserAgent"): "sec_user_agent",
}

# Defaults: the skills' config.example.json, with the owner's starting account.
DEFAULT_CONFIG: dict[str, Any] = {
    "budget": 5000,
    "cash_buffer_pct": 10,
    "max_position_pct": 75,
    "max_order_usd": 4000,
    "min_order_usd": 5,
    "max_loss_per_trade_usd": 50,
    "max_daily_loss_usd": 150,
    "max_trades_per_day": 3,
    "max_orders_per_day": 10,
    "min_reward_risk": 1.0,
    "require_stop": True,
    "no_entries_before": "09:45",
    "no_entries_after": "15:30",
    "flat_by": "15:55",
    "fractional": False,
    "broker": "alpaca",
    "paper": True,
    "blocked": [],
    "allow_options": False,
    "allow_margin": False,
    "allow_short": False,
    "pdt_guard": False,
    "sec_user_agent": "",
}

PLACEHOLDER_UA = "Your Name you@example.com"
INT_KEYS = {"max_trades_per_day"}


def effective_config(cfg: dict[str, Any] | None) -> dict[str, Any]:
    out = dict(DEFAULT_CONFIG)
    for k, v in (cfg or {}).items():
        if v is not None:
            out[k] = v
    return out


def settings_from_config(cfg: dict[str, Any] | None, demo: bool) -> dict[str, Any]:
    """config.json -> Settings JSON (camelCase)."""
    c = effective_config(cfg)
    doc: dict[str, dict[str, Any]] = {"account": {}, "limits": {}, "data": {}}
    for (section, key), ck in FIELD_MAP.items():
        v = c.get(ck)
        if ck == "sec_user_agent" and (v == PLACEHOLDER_UA or v is None):
            v = ""
        if ck in INT_KEYS and v is not None:
            v = int(v)
        doc[section][key] = v
    doc["data"]["demoMode"] = demo
    return doc


def config_from_settings(settings: dict[str, Any], current: dict[str, Any] | None) -> dict[str, Any]:
    """Merge a Settings JSON (camelCase) into the existing config.json, keeping every other key."""
    out = dict(current or {})
    for (section, key), ck in FIELD_MAP.items():
        sec = settings.get(section) or {}
        if key in sec and sec[key] is not None:
            out[ck] = sec[key]
    for k, v in DEFAULT_CONFIG.items():
        out.setdefault(k, v)
    return out
