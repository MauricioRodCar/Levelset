"""Per-step parameters: defaults, the allowed overrides and how they become CLI flags."""

from __future__ import annotations

import re
from typing import Any

DEFAULTS: dict[str, dict[str, Any]] = {
    "scanner": {"kind": "orb", "orMinutes": 15},
    "news": {"hours": 12},
    "entry": {"orMinutes": 15, "interval": "5m"},
    "exit": {"stop": "or-mid", "target": "1R"},
    "timemachine": {"replays": 10000, "seed": 19, "window": 2},
    "budget": {},
    "risk": {},
    "ticket": {},
}

# Overrides a caller may send per step (anything else is ignored).
ALLOWED: dict[str, set[str]] = {
    "scanner": {"kind", "at", "orMinutes", "minPrice", "minVolume", "maxConfirm", "ticker"},
    "news": {"hours", "forms", "movePct", "noSec"},
    "entry": {"orMinutes", "interval", "level", "minVolumeX"},
    "exit": {"stop", "target", "flatBy", "entry"},
    "timemachine": {"replays", "seed", "window", "until"},
    "budget": {"limit", "budget"},
    "risk": set(),
    "ticket": set(),
}


def merged(key: str, *overrides: dict[str, Any] | None) -> dict[str, Any]:
    out = dict(DEFAULTS.get(key, {}))
    allowed = ALLOWED.get(key, set())
    for o in overrides:
        for k, v in (o or {}).items():
            if k in allowed:
                out[k] = v
    return out


def flag(name: str) -> str:
    return "--" + re.sub(r"([A-Z])", r"-\1", name).lower()


def to_flags(params: dict[str, Any], keys: list[str]) -> list[str]:
    """{"orMinutes": 15} -> ["--or-minutes", "15"]; booleans become bare flags."""
    out: list[str] = []
    for k in keys:
        if k not in params or params[k] is None:
            continue
        v = params[k]
        if isinstance(v, bool):
            if v:
                out.append(flag(k))
            continue
        out += [flag(k), str(v)]
    return out
