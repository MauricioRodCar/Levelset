"""AI assistant: explain, coach and chat over the user's own Levelset data.

Off by default. Needs a key pushed by the Tauri shell (keystore.py), AI enabled in
settings and spend below the monthly soft cap. Answers go through the output guard
(guard.py) and always carry the disclaimer key, the citations of the data read and the
usage / cost of the request. Settings and month-to-date spend live in the kv table.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from . import guard, pricing
from .keystore import KeyStore
from .prompts import DISCLAIMER_KEY, EMPTY, LANG_INSTRUCTION, SYSTEM_PROMPT, TASKS
from .tools import BY_NAME, ToolInputError, asgi_get, build_request, citation, definitions, result_text

log = logging.getLogger("levelset.ai")

KV_SETTINGS = "ai_settings"
KV_SPEND = "ai_spend"
DEFAULT_SETTINGS = {"enabled": False, "model": pricing.DEFAULT_MODEL, "monthlyCapUsd": 5.0}
MAX_TOKENS = 4096
MAX_TOOL_TURNS = 6
EFFORT = "medium"
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AiError(Exception):
    def __init__(self, status: int, code: str, title: str, detail: str | None = None) -> None:
        super().__init__(title)
        self.status, self.code, self.title, self.detail = status, code, title, detail


def default_client_factory(key: str) -> Any:
    import anthropic  # imported lazily: the engine starts fast and works without AI

    return anthropic.AsyncAnthropic(api_key=key, max_retries=2, timeout=120.0)


def _get(block: Any, name: str, default: Any = None) -> Any:
    return block.get(name, default) if isinstance(block, dict) else getattr(block, name, default)


class AiService:
    def __init__(self, ctx: Any, app: Any, client_factory: Callable[[str], Any] | None = None) -> None:
        self.ctx = ctx
        self.app = app
        self.keys = KeyStore()
        self.client_factory = client_factory or default_client_factory
        self._client: Any = None
        self._client_for: int | None = None  # id of the key string the client was built with

    # ---------------------------------------------------------------- key
    def set_key(self, key: str) -> None:
        self.keys.set(key)
        self._client = None

    def clear_key(self) -> None:
        self.keys.clear()
        self._client = None

    def _api(self) -> Any:
        key = self.keys.get()
        if key is None:
            raise AiError(409, "ai_no_key", "No Claude API key")
        if self._client is None or self._client_for != id(key):
            self._client = self.client_factory(key)
            self._client_for = id(key)
        return self._client

    # ---------------------------------------------------------------- settings and spend
    def settings(self) -> dict[str, Any]:
        stored = self.ctx.db.kv_get(KV_SETTINGS) or {}
        out = dict(DEFAULT_SETTINGS)
        out.update({k: v for k, v in stored.items() if k in DEFAULT_SETTINGS})
        if out["model"] not in pricing.MODEL_IDS:
            out["model"] = pricing.DEFAULT_MODEL
        out["monthlyCapUsd"] = float(out["monthlyCapUsd"])
        out["enabled"] = bool(out["enabled"])
        return out

    def update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        cur = self.settings()
        cur.update({k: v for k, v in patch.items() if k in DEFAULT_SETTINGS and v is not None})
        self.ctx.db.kv_set(KV_SETTINGS, cur)
        return self.settings()

    def month(self) -> str:
        return self.ctx.clock.now_ny().strftime("%Y-%m")

    def spent(self) -> float:
        return float((self.ctx.db.kv_get(KV_SPEND) or {}).get(self.month(), 0.0))

    def _add_spend(self, usd: float) -> None:
        doc = self.ctx.db.kv_get(KV_SPEND) or {}
        m = self.month()
        doc[m] = round(float(doc.get(m, 0.0)) + usd, 6)
        self.ctx.db.kv_set(KV_SPEND, doc)

    def status(self) -> dict[str, Any]:
        s = self.settings()
        spent = self.spent()
        cap = s["monthlyCapUsd"]
        reason = None
        if not s["enabled"]:
            reason = "disabled"
        elif not self.keys.present:
            reason = "no_key"
        elif spent >= cap:
            reason = "cap_reached"
        return {"keyPresent": self.keys.present, "enabled": s["enabled"], "ready": reason is None, "reason": reason,
                "model": s["model"], "modelId": pricing.model_id(s["model"]), "month": self.month(),
                "monthlyCapUsd": cap, "spentThisMonthUsd": round(spent, 6),
                "remainingUsd": round(max(0.0, cap - spent), 6)}

    def _require_ready(self) -> dict[str, Any]:
        st = self.status()
        if st["reason"] == "disabled":
            raise AiError(409, "ai_disabled", "AI is turned off in Settings")
        if st["reason"] == "no_key":
            raise AiError(409, "ai_no_key", "No Claude API key")
        if st["reason"] == "cap_reached":
            raise AiError(429, "ai_cap_reached", "Monthly AI spending cap reached",
                          "%.2f of %.2f USD used in %s" % (st["spentThisMonthUsd"], st["monthlyCapUsd"], st["month"]))
        return st

    # ---------------------------------------------------------------- tools
    async def _tool(self, name: str, args: dict[str, Any], lang: str, cites: list[dict[str, Any]]
                    ) -> tuple[int, Any, str, bool]:
        """Run one read-only tool. Returns (status, body, tool_result text, is_error)."""
        tool = BY_NAME.get(name)
        if tool is None:
            return 400, None, json.dumps({"error": "unknown tool %s; only the listed read-only tools exist" % name}), True
        try:
            path, query, clean = build_request(tool, args or {})
        except ToolInputError as e:
            return 422, None, json.dumps({"error": str(e)}), True
        status, body = await asgi_get(self.app, path, query, self.ctx.config.token)
        text, is_error = result_text(status, body)
        c = citation(tool, clean, lang)
        key = (c["tool"], json.dumps(c.get("params"), sort_keys=True))
        if not any((x["tool"], json.dumps(x.get("params"), sort_keys=True)) == key for x in cites):
            cites.append(c)
        return status, body, text, is_error

    # ---------------------------------------------------------------- the model call
    async def _complete(self, lang: str, messages: list[dict[str, Any]], cites: list[dict[str, Any]]
                        ) -> dict[str, Any]:
        st = self._require_ready()
        model = st["modelId"]
        client = self._api()
        system = [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}},
                  {"type": "text", "text": LANG_INSTRUCTION[lang]}]
        tools = definitions()
        inp = out = 0
        cost = 0.0
        served_by = model
        text = ""
        try:
            for turn in range(MAX_TOOL_TURNS + 1):
                kwargs: dict[str, Any] = {"model": model, "max_tokens": MAX_TOKENS, "system": system, "tools": tools,
                                          "messages": messages, "output_config": {"effort": EFFORT}}
                if turn == MAX_TOOL_TURNS:
                    kwargs["tool_choice"] = {"type": "none"}  # enough reading: answer now
                if model in pricing.SUPPORTS_FALLBACKS:
                    kwargs["betas"] = [FALLBACK_BETA]
                    kwargs["fallbacks"] = "default"
                resp = await client.beta.messages.create(**kwargs)
                served_by = str(_get(resp, "model") or model)
                i, o, cw, cr = pricing.usage_tokens(_get(resp, "usage"))
                inp += i + cw + cr
                out += o
                c = pricing.cost_usd(served_by, i, o, cw, cr)
                cost += c
                self._add_spend(c)
                content = list(_get(resp, "content") or [])
                stop = _get(resp, "stop_reason")
                if stop == "tool_use":
                    messages.append({"role": "assistant", "content": content})
                    results = []
                    for block in content:
                        if _get(block, "type") != "tool_use":
                            continue
                        _, _, result, is_error = await self._tool(_get(block, "name"), _get(block, "input") or {},
                                                                  lang, cites)
                        results.append({"type": "tool_result", "tool_use_id": _get(block, "id"), "content": result,
                                        "is_error": is_error})
                    messages.append({"role": "user", "content": results})
                    continue
                if stop == "refusal":
                    text = ""
                else:
                    text = "\n\n".join(str(_get(b, "text") or "") for b in content
                                       if _get(b, "type") == "text").strip()
                break
        except AiError:
            raise
        except Exception as e:  # SDK errors (auth, rate limit, network) and anything else
            raise AiError(502, "ai_failed", "The Claude API request failed", self._describe(e)) from None

        guarded = guard.apply(text or EMPTY[lang], lang)
        if guarded.blocked:
            log.info("AI output guard replaced an answer (rules: %s)", ", ".join(guarded.rules))
        return {"text": guarded.text, "lang": lang, "citations": cites,
                "usage": {"inputTokens": inp, "outputTokens": out, "costUsd": round(cost, 6)},
                "model": served_by, "disclaimerKey": DISCLAIMER_KEY}

    def _describe(self, e: Exception) -> str:
        name = type(e).__name__
        status = getattr(e, "status_code", None)
        if name == "AuthenticationError" or status == 401:
            return "The Claude API rejected the key (401). Check the key in Settings."
        if name == "PermissionDeniedError" or status == 403:
            return "The key is not allowed to use this model (403)."
        if name == "RateLimitError" or status == 429:
            return "The Claude API is rate limiting this key (429). Try again in a minute."
        if name in ("APIConnectionError", "APITimeoutError"):
            return "Could not reach the Claude API. Check the internet connection."
        return self.keys.scrub("%s: %s" % (name, e))[:400]

    # ---------------------------------------------------------------- layer 1: explain
    async def explain(self, req: dict[str, Any]) -> dict[str, Any]:
        self._require_ready()
        lang = req["lang"]
        kind = req["kind"]
        cites: list[dict[str, Any]] = []
        ctx_parts: dict[str, Any] = {}
        task = TASKS[kind]
        if kind == "pipeline_step":
            if not req.get("runId") or not req.get("stepKey"):
                raise AiError(422, "validation_error", "Invalid request", "runId and stepKey are required")
            status, run, _, _ = await self._tool("get_run", {"runId": req["runId"]}, lang, cites)
            if status != 200 or not isinstance(run, dict):
                raise AiError(404, "not_found", "Run not found", req["runId"])
            step = next((s for s in run.get("steps") or [] if s.get("key") == req["stepKey"]), None)
            if step is None:
                raise AiError(404, "not_found", "Step not found", req["stepKey"])
            ctx_parts["run"] = {k: run.get(k) for k in ("id", "ticker", "setup", "mode", "status", "ticketId")}
            ctx_parts["step"] = step
        elif kind == "blocked_ticket":
            if not req.get("ticketId"):
                raise AiError(422, "validation_error", "Invalid request", "ticketId is required")
            status, ticket, _, _ = await self._tool("get_ticket", {"ticketId": req["ticketId"]}, lang, cites)
            if status != 200 or not isinstance(ticket, dict):
                raise AiError(404, "ticket_not_found", "Ticket not found", req["ticketId"])
            ctx_parts["ticket"] = ticket
            _, settings, _, _ = await self._tool("get_settings", {}, lang, cites)
            ctx_parts["settings"] = settings
        elif kind == "news_summary":
            tickers = [t.strip().upper() for t in req.get("tickers") or [] if t.strip()]
            if not tickers:
                _, wl, _, _ = await self._tool("get_watchlist", {}, lang, cites)
                tickers = [w["symbol"] for w in wl or [] if isinstance(w, dict) and w.get("symbol")][:50]
            hours = int(req.get("hours") or 12)
            if tickers:
                status, news, text, _ = await self._tool("get_news", {"tickers": tickers, "hours": hours}, lang, cites)
                ctx_parts["news"] = news if status == 200 else json.loads(text)
            else:
                ctx_parts["news"] = {"available": False, "reason": "the watchlist is empty"}
            ctx_parts["tickers"] = tickers
            ctx_parts["hours"] = hours
        elif kind == "analyst_quarter":
            if not req.get("symbol"):
                raise AiError(422, "validation_error", "Invalid request", "symbol is required")
            try:
                status, report, text, _ = await self._tool("get_analyst", {"symbol": req["symbol"]}, lang, cites)
            except Exception:
                status, report, text = 502, None, json.dumps({"available": False})
            ctx_parts["analyst"] = report if status == 200 else json.loads(text)
            if req.get("quarterEnd"):
                ctx_parts["quarterEnd"] = req["quarterEnd"]
        return await self._complete(lang, [self._user(task, ctx_parts)], cites)

    # ---------------------------------------------------------------- layer 2: coach
    async def coach(self, req: dict[str, Any]) -> dict[str, Any]:
        self._require_ready()
        lang = req["lang"]
        if str(req["from"]) > str(req["to"]):
            raise AiError(422, "validation_error", "Invalid request", "from must be on or before to")
        cites: list[dict[str, Any]] = []
        rng = {"from": str(req["from"]), "to": str(req["to"])}
        if req.get("accountId"):
            rng["accountId"] = req["accountId"]
        parts: dict[str, Any] = {"period": rng}
        for key, tool, extra in (("paperStats", "get_paper_stats", {"groupBy": "hour"}),
                                 ("signalsVsYou", "get_paper_compare", {}),
                                 ("paperTrades", "get_paper_trades", {"limit": 200})):
            status, body, text, _ = await self._tool(tool, dict(rng, **extra), lang, cites)
            if status == 404 and isinstance(body, dict) and body.get("code") == "paper_account_not_found":
                raise AiError(404, "paper_account_not_found", "Paper account not found", req.get("accountId"))
            parts[key] = body if status == 200 else json.loads(text)
        _, fills, _, _ = await self._tool("get_fills", {}, lang, cites)
        parts["manualFills"] = [f for f in fills or [] if isinstance(f, dict)
                                and rng["from"] <= str(f.get("filledAt") or f.get("at") or "")[:10] <= rng["to"]]
        _, settings, _, _ = await self._tool("get_settings", {}, lang, cites)
        parts["settings"] = settings
        return await self._complete(lang, [self._user(TASKS["coach"], parts)], cites)

    # ---------------------------------------------------------------- layer 3: chat
    async def chat(self, req: dict[str, Any]) -> dict[str, Any]:
        self._require_ready()
        msgs = req["messages"]
        if not msgs or msgs[-1]["role"] != "user":
            raise AiError(422, "validation_error", "Invalid request", "the last message must be from the user")
        today = self.ctx.clock.now_ny().date().isoformat()
        history = [{"role": m["role"], "content": m["content"]} for m in msgs]
        history[0] = {"role": history[0]["role"],
                      "content": "(Today is %s, New York time.)\n\n%s" % (today, history[0]["content"])}
        if history[0]["role"] != "user":  # the API wants the conversation to start with the user
            history.insert(0, {"role": "user", "content": "(Today is %s, New York time.)" % today})
        return await self._complete(req["lang"], history, [])

    def _user(self, task: str, data: dict[str, Any]) -> dict[str, Any]:
        today = self.ctx.clock.now_ny().date().isoformat()
        blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if len(blob) > 60_000:
            blob = blob[:60_000] + "...(truncated)"
        return {"role": "user", "content": "%s\n\nToday is %s (New York time). Data from Levelset (JSON):\n%s"
                                           % (task, today, blob)}
