"""Read-only tools for the Claude API.

Every tool is one GET on the engine's own HTTP API, called in-process through the
ASGI app (no socket, no network). That makes the tools read-only by construction:
the dispatcher can only send GET, only to the paths below, and the answer has the
same shape the UI sees (docs/api/openapi.yaml). Endpoints another work package has
not built yet (paper, analyst) answer 404/405, which the tool reports as
"not available" so the model can say the data is missing.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import quote, urlencode

ID = re.compile(r"^[A-Za-z0-9_.\-]{1,80}$")
TICKER = re.compile(r"^[A-Z]{1,5}([.\-][A-Z]{1,2})?$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_RESULT_CHARS = 24_000
TOOL_TIMEOUT = 90.0

_DATE_PROP = {"type": "string", "description": "New York date YYYY-MM-DD"}
_ACCOUNT_PROP = {"type": "string", "description": "paper account id; omit for the active account"}


@dataclass(frozen=True)
class Tool:
    name: str
    path: str                       # may contain {param}
    description: str
    props: dict[str, Any] = field(default_factory=dict)
    required: tuple[str, ...] = ()
    ref_kind: str | None = None     # AiCitation.ref.kind
    ref_param: str | None = None    # which input is the ref id (None: a fixed id)
    label_en: str = ""
    label_es: str = ""

    def definition(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description,
                "input_schema": {"type": "object", "properties": self.props, "required": list(self.required),
                                 "additionalProperties": False}}


TOOLS: tuple[Tool, ...] = (
    Tool("get_status", "/status", "Engine status: New York time, market open/closed, next open/close, demo or live.",
         label_en="Engine status", label_es="Estado del motor"),
    Tool("get_dashboard", "/dashboard", "Today's dashboard numbers: realized P/L, risk used, trades today, limits.",
         label_en="Dashboard", label_es="Panel"),
    Tool("get_settings", "/settings", "The user's account size and risk limits (max loss per trade, daily loss "
         "limit, trades per day, entry window, flat-by time, minimum reward:risk...).",
         ref_kind="settings", label_en="Your settings and limits", label_es="Tu configuración y límites"),
    Tool("get_watchlist", "/watchlist", "The current watchlist from the last scan, with each symbol's entry state.",
         label_en="Watchlist", label_es="Watchlist"),
    Tool("list_runs", "/pipeline/runs", "Recent pipeline runs (newest first): id, ticker, status, ticket id.",
         {"limit": {"type": "integer", "minimum": 1, "maximum": 100}},
         label_en="Pipeline runs", label_es="Corridas del pipeline"),
    Tool("get_run", "/pipeline/runs/{runId}", "One pipeline run with every step's inputs, outputs, summary and "
         "checks.", {"runId": {"type": "string"}}, ("runId",), "run", "runId",
         "Pipeline run {runId}", "Corrida del pipeline {runId}"),
    Tool("list_tickets", "/tickets", "Order tickets (newest first) with status ready / blocked / stale and the "
         "risk reasons.", {"status": {"type": "string", "enum": ["ready", "blocked", "stale", "all"]}},
         label_en="Tickets", label_es="Tickets"),
    Tool("get_ticket", "/tickets/{ticketId}", "One ticket: entry, stop loss, take profit, qty, max loss, R, status, "
         "risk reasons and the Time Machine summary.", {"ticketId": {"type": "string"}}, ("ticketId",),
         "ticket", "ticketId", "Ticket {ticketId}", "Ticket {ticketId}"),
    Tool("get_open_trades", "/trades", "Open real positions built from the user's recorded manual fills.",
         label_en="Open trades", label_es="Operaciones abiertas"),
    Tool("get_fills", "/fills", "The user's recorded manual fills (real trades they placed themselves).",
         label_en="Your recorded fills", label_es="Tus operaciones registradas"),
    Tool("get_alerts", "/alerts", "Price alerts and whether they rang.", label_en="Alerts", label_es="Alertas"),
    Tool("get_news", "/news", "Headlines and SEC filings for tickers over the last hours.",
         {"tickers": {"type": "array", "items": {"type": "string"}, "maxItems": 50},
          "hours": {"type": "integer", "minimum": 1, "maximum": 72}}, ("tickers",), "news", "tickers",
         "News, {tickers}", "Noticias, {tickers}"),
    Tool("get_paper_accounts", "/paper/accounts", "Paper accounts with balance, equity and periods.",
         ref_kind="paper_account", label_en="Paper accounts", label_es="Cuentas en papel"),
    Tool("get_paper_positions", "/paper/positions", "Open paper positions.", {"accountId": _ACCOUNT_PROP},
         label_en="Open paper positions", label_es="Posiciones en papel abiertas"),
    Tool("get_paper_trades", "/paper/trades", "Paper trade log (closed and skipped) with exit reason, R and P/L.",
         {"accountId": _ACCOUNT_PROP, "from": _DATE_PROP, "to": _DATE_PROP, "symbol": {"type": "string"},
          "kind": {"type": "string", "enum": ["closed", "skipped", "all"]},
          "limit": {"type": "integer", "minimum": 1, "maximum": 500}},
         ref_kind="paper_account", ref_param="accountId",
         label_en="Paper trades", label_es="Operaciones en papel"),
    Tool("get_paper_stats", "/paper/stats", "Paper account report: P/L, win rate, expectancy (R), profit factor, "
         "drawdown, losing streak, optional breakdown by ticker / setup / hour / weekday.",
         {"accountId": _ACCOUNT_PROP, "from": _DATE_PROP, "to": _DATE_PROP,
          "groupBy": {"type": "string", "enum": ["ticker", "setup", "hour", "weekday"]}},
         ref_kind="paper_account", ref_param="accountId",
         label_en="Paper stats", label_es="Estadísticas en papel"),
    Tool("get_paper_compare", "/paper/compare", "\"Signals vs. you\": paper results next to the user's manual "
         "round trips, per day and ticker.", {"accountId": _ACCOUNT_PROP, "from": _DATE_PROP, "to": _DATE_PROP},
         ref_kind="paper_account", ref_param="accountId",
         label_en="Signals vs. you", label_es="Señales vs. tú"),
    Tool("get_analyst", "/analyst/{symbol}", "Reported quarterly numbers from SEC filings for one company "
         "(revenue, margins, net income, EPS, year-over-year) and the \"what changed\" lines.",
         {"symbol": {"type": "string"}, "quarters": {"type": "integer", "minimum": 1, "maximum": 12}},
         ("symbol",), "analyst", "symbol", "Earnings report, {symbol}", "Reporte de resultados, {symbol}"),
)
BY_NAME = {t.name: t for t in TOOLS}


def definitions() -> list[dict[str, Any]]:
    return [t.definition() for t in TOOLS]


class ToolInputError(ValueError):
    pass


def _clean_value(tool: Tool, key: str, value: Any) -> Any:
    schema = tool.props.get(key)
    if schema is None:
        raise ToolInputError("unknown argument %s" % key)
    kind = schema.get("type")
    if kind == "integer":
        try:
            v = int(value)
        except (TypeError, ValueError):
            raise ToolInputError("%s must be an integer" % key)
        return max(schema.get("minimum", v), min(schema.get("maximum", v), v))
    if kind == "array":
        items = value if isinstance(value, list) else str(value).split(",")
        out = [str(x).strip().upper() for x in items if str(x).strip()][: schema.get("maxItems", 50)]
        if not out or any(not TICKER.match(x) for x in out):
            raise ToolInputError("%s must be tickers" % key)
        return out
    v = str(value).strip()
    if "enum" in schema and v not in schema["enum"]:
        raise ToolInputError("%s must be one of %s" % (key, ", ".join(schema["enum"])))
    if key in ("from", "to") and not DATE.match(v):
        raise ToolInputError("%s must be YYYY-MM-DD" % key)
    if key == "symbol":
        v = v.upper()
        if not TICKER.match(v):
            raise ToolInputError("symbol must be a ticker")
    elif not ID.match(v):
        raise ToolInputError("%s has invalid characters" % key)
    return v


def build_request(tool: Tool, args: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """(path, query, cleaned args). Raises ToolInputError."""
    if not isinstance(args, dict):
        raise ToolInputError("arguments must be an object")
    clean = {k: _clean_value(tool, k, v) for k, v in args.items() if v is not None and v != ""}
    for r in tool.required:
        if r not in clean:
            raise ToolInputError("%s is required" % r)
    path = tool.path
    query: dict[str, Any] = {}
    for k, v in clean.items():
        token = "{%s}" % k
        if token in path:
            path = path.replace(token, quote(str(v), safe=""))
        else:
            query[k] = ",".join(v) if isinstance(v, list) else v
    if tool.name == "get_news":
        query.setdefault("hours", 12)
    if tool.name == "get_paper_trades":
        query.setdefault("limit", 200)
    return path, query, clean


async def asgi_get(app: Callable[..., Any], path: str, query: dict[str, Any], token: str) -> tuple[int, Any]:
    """One in-process GET through the ASGI app. Returns (status, parsed JSON or text)."""
    qs = urlencode(query, doseq=True)
    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
             "method": "GET", "scheme": "http", "path": path, "raw_path": path.encode(),
             "query_string": qs.encode(), "root_path": "",
             "headers": [(b"host", b"127.0.0.1"), (b"authorization", ("Bearer %s" % token).encode()),
                         (b"accept", b"application/json")],
             "client": ("127.0.0.1", 0), "server": ("127.0.0.1", 0)}
    sent = False
    status = {"code": 500}
    chunks: list[bytes] = []

    async def receive() -> dict[str, Any]:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        if message["type"] == "http.response.start":
            status["code"] = int(message["status"])
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body", b""))

    await asyncio.wait_for(app(scope, receive, send), timeout=TOOL_TIMEOUT)
    raw = b"".join(chunks).decode("utf-8", "replace")
    try:
        return status["code"], json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return status["code"], raw


def result_text(status: int, body: Any) -> tuple[str, bool]:
    """(tool_result content, is_error). Missing endpoints / data become "not available"."""
    if status == 200:
        text = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
        if len(text) > MAX_RESULT_CHARS:
            text = text[:MAX_RESULT_CHARS] + "...(truncated)"
        return text, False
    code = body.get("code") if isinstance(body, dict) else None
    detail = body.get("detail") or body.get("title") if isinstance(body, dict) else None
    if status in (404, 405) and code in (None, "not_found", "method_not_allowed"):
        return json.dumps({"available": False, "reason": "this data is not available in this Levelset version"}), True
    return json.dumps({"available": False, "status": status, "code": code, "detail": detail}), True


def citation(tool: Tool, args: dict[str, Any], lang: str) -> dict[str, Any]:
    fmt = {k: (", ".join(v) if isinstance(v, list) else v) for k, v in args.items()}
    template = tool.label_es if lang == "es" else tool.label_en
    try:
        label = template.format(**fmt)
    except KeyError:
        label = template.split(",")[0].replace(" {", "").strip("{}")
    period = [args.get("from"), args.get("to")]
    if any(period):
        label += " (%s)" % " – ".join(p for p in period if p)
    out: dict[str, Any] = {"tool": tool.name, "label": label}
    if tool.ref_kind:
        if tool.ref_param and args.get(tool.ref_param):
            rid = fmt[tool.ref_param]
            out["ref"] = {"kind": tool.ref_kind, "id": str(rid)}
        elif tool.ref_kind == "settings":
            out["ref"] = {"kind": "settings", "id": "settings"}
        elif tool.ref_kind == "paper_account":
            out["ref"] = {"kind": "paper_account", "id": "active"}
    if args:
        out["params"] = dict(args)
    return out
