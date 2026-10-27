"""Model choice (AiModel) -> Claude API model id, and the cost of one request.

Prices are Anthropic first-party API list prices in USD per million tokens
(Claude API reference, cached 2026-10-06). Cache writes cost 1.25x input and
cache reads 0.1x input. A model id we do not know (e.g. a server-side fallback
model) is priced like Opus so the soft cap errs on the safe side.
"""

from __future__ import annotations

from typing import Any

MODEL_IDS: dict[str, str] = {
    "haiku": "claude-haiku-5-5",
    "sonnet": "claude-sonnet-5-5",
    "opus": "claude-opus-5-5",
}
DEFAULT_MODEL = "sonnet"

# (input, output) USD per 1M tokens
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
}
FALLBACK_PRICE = (5.00, 25.00)

# Haiku 5.5 list price is for prompts up to 100K tokens; longer prompts cost more.
LONG_PROMPT_TOKENS = 100_000
LONG_PROMPT_PRICES: dict[str, tuple[float, float]] = {"claude-haiku-5-5": (0.50, 2.50)}

# Server-side refusal fallbacks exist for these models only (not Haiku).
SUPPORTS_FALLBACKS = frozenset({"claude-sonnet-5-5", "claude-opus-5-5"})


def model_id(model: str) -> str:
    return MODEL_IDS.get(model, MODEL_IDS[DEFAULT_MODEL])


def _n(usage: Any, name: str) -> int:
    v = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def usage_tokens(usage: Any) -> tuple[int, int, int, int]:
    """(input, output, cache_write, cache_read) from an SDK usage object or dict."""
    return (_n(usage, "input_tokens"), _n(usage, "output_tokens"),
            _n(usage, "cache_creation_input_tokens"), _n(usage, "cache_read_input_tokens"))


def cost_usd(model: str, inp: int, out: int, cache_write: int = 0, cache_read: int = 0) -> float:
    pin, pout = PRICES.get(model, FALLBACK_PRICE)
    if inp + cache_write + cache_read > LONG_PROMPT_TOKENS and model in LONG_PROMPT_PRICES:
        pin, pout = LONG_PROMPT_PRICES[model]
    return (inp * pin + cache_write * pin * 1.25 + cache_read * pin * 0.1 + out * pout) / 1_000_000
