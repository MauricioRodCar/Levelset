"""Pydantic models that mirror docs/api/openapi.yaml (camelCase on the wire).

Fields the contract marks nullable (type [x, "null"]) serialize as null when
empty; other optional fields are left out instead of being sent as null.
"""

from __future__ import annotations

from typing import Any, ClassVar, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_serializer
from pydantic.alias_generators import to_camel

StepKey = Literal["scanner", "news", "entry", "exit", "timemachine", "budget", "risk", "ticket"]
StepStatus = Literal["pending", "running", "done", "check", "blocked", "error"]
RunStatus = Literal["running", "done", "check", "blocked", "error", "pending"]
STEP_KEYS: tuple[str, ...] = ("scanner", "news", "entry", "exit", "timemachine", "budget", "risk", "ticket")


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")
    NULLABLE: ClassVar[frozenset[str]] = frozenset()

    @model_serializer(mode="wrap")
    def _drop_unset_nulls(self, handler: Any) -> Any:
        data = handler(self)
        if isinstance(data, dict):
            keep = self.NULLABLE
            return {k: v for k, v in data.items() if v is not None or k in keep or to_camel(k) in keep}
        return data


class Problem(ApiModel):
    title: str
    detail: Optional[str] = None
    code: str


class Health(ApiModel):
    ok: bool
    version: str


class Status(ApiModel):
    NULLABLE = frozenset({"nextOpen", "nextClose"})
    market_open: bool
    now_et: str
    next_open: Optional[str] = None
    next_close: Optional[str] = None
    early_close: bool = False
    data_delay_seconds: int
    mode: Literal["demo", "live"]
    paper: bool
    tier: Literal["free", "pro", "tester"] = "free"
    engine_version: str


class DashboardSummary(ApiModel):
    NULLABLE = frozenset({"lastScanAt"})
    day_pnl: float
    risk_used: float
    daily_loss_limit: float
    trades_today: int
    max_trades_per_day: int
    setups_found: int
    last_scan_at: Optional[str] = None


class AccountSettings(ApiModel):
    account_size_usd: float = Field(ge=0)
    cash_buffer_pct: Optional[float] = Field(default=None, ge=0, le=100)
    paper: bool


class LimitSettings(ApiModel):
    max_loss_per_trade_usd: Optional[float] = Field(default=None, ge=0)
    max_daily_loss_usd: Optional[float] = Field(default=None, ge=0)
    max_trades_per_day: Optional[int] = Field(default=None, ge=0)
    min_reward_risk: Optional[float] = Field(default=None, ge=0)
    max_position_pct: Optional[float] = Field(default=None, ge=0, le=100)
    max_order_usd: Optional[float] = Field(default=None, ge=0)
    no_entries_before: Optional[str] = Field(default=None, pattern=r"^([01]?\d|2[0-3]):[0-5]\d$")
    no_entries_after: Optional[str] = Field(default=None, pattern=r"^([01]?\d|2[0-3]):[0-5]\d$")
    flat_by: Optional[str] = Field(default=None, pattern=r"^([01]?\d|2[0-3]):[0-5]\d$")
    require_stop: Optional[bool] = None
    pdt_guard: Optional[bool] = None


class DataSettings(ApiModel):
    sec_user_agent: Optional[str] = None
    demo_mode: Optional[bool] = None


class Settings(ApiModel):
    account: AccountSettings
    limits: LimitSettings = Field(default_factory=LimitSettings)
    data: DataSettings = Field(default_factory=DataSettings)


class ScanRequest(ApiModel):
    kind: Literal["orb", "daily"] = "orb"
    at: Optional[str] = Field(default=None, pattern=r"^([01]?\d|2[0-3]):[0-5]\d$")
    tickers: Optional[list[str]] = None


class ScanHit(ApiModel):
    NULLABLE = frozenset({"rangeHigh", "rangeLow", "pctOverTrigger", "changePct"})
    symbol: str
    setup: str
    price: Optional[float] = None
    range_high: Optional[float] = None
    range_low: Optional[float] = None
    pct_over_trigger: Optional[float] = None
    change_pct: Optional[float] = None


class ScanResult(ApiModel):
    kind: str
    scanned: int
    hits: list[ScanHit]
    at: Optional[str] = None


class WatchItem(ApiModel):
    NULLABLE = frozenset({"distancePct", "price", "changePct"})
    symbol: str
    setup: Optional[str] = None
    entry_state: Literal["waiting", "triggered", "expired", "not_open"]
    distance_pct: Optional[float] = None
    price: Optional[float] = None
    change_pct: Optional[float] = None


class NewsItem(ApiModel):
    id: str
    symbol: str
    title: str
    url: Optional[str] = None
    source: Literal["yahoo", "sec"]
    published_at: str
    tags: list[str] = Field(default_factory=list)


class StepSummary(ApiModel):
    in_line: Optional[str] = None
    out_line: Optional[str] = None
    code: Optional[str] = None
    values: Optional[dict[str, Any]] = None


class Step(ApiModel):
    NULLABLE = frozenset({"error", "startedAt", "endedAt"})
    key: StepKey
    status: StepStatus
    params: dict[str, Any] = Field(default_factory=dict)
    inputs: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, Any] = Field(default_factory=dict)
    summary: StepSummary = Field(default_factory=StepSummary)
    checks: list[str] = Field(default_factory=list)
    error: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None


class StepRunRequest(ApiModel):
    params: Optional[dict[str, Any]] = None


class PipelineRunRequest(ApiModel):
    mode: Literal["all", "step"]
    ticker: Optional[str] = Field(default=None, pattern=r"^[A-Za-z]{1,5}([.\-][A-Za-z]{1,2})?$")
    setup: Literal["orb", "level"] = "orb"
    params: Optional[dict[str, Any]] = None


class PipelineRunSummary(ApiModel):
    NULLABLE = frozenset({"ticker", "endedAt", "ticketId"})
    id: str
    ticker: Optional[str] = None
    setup: str
    mode: Literal["all", "step"]
    status: RunStatus
    started_at: str
    ended_at: Optional[str] = None
    ticket_id: Optional[str] = None


class PipelineRun(PipelineRunSummary):
    steps: list[Step] = Field(min_length=8, max_length=8)


class TimeMachineSummary(ApiModel):
    target_first_pct: float
    stop_first_pct: float
    open_at_close_pct: float
    verdict: str
    history_fired: int
    history_won: int
    history_lost: int


class Ticket(ApiModel):
    NULLABLE = frozenset({"timeMachine"})
    id: str
    run_id: str
    symbol: str
    side: Literal["buy", "sell"]
    qty: int
    order_type: Literal["market", "limit"]
    time_in_force: Optional[Literal["day", "gtc"]] = None
    entry: float
    stop: float
    target: float
    risk_per_share: float
    reward_per_share: Optional[float] = None
    r_multiple: float
    max_loss: float
    position_usd: Optional[float] = None
    flat_by: Optional[str] = None
    status: Literal["ready", "blocked", "stale"]
    risk_reasons: list[str] = Field(default_factory=list)
    risk_detail: list[str] = Field(default_factory=list)
    time_machine: Optional[TimeMachineSummary] = None
    created_at: str


class OpenTrade(ApiModel):
    NULLABLE = frozenset({"lastPrice", "unrealizedPnl", "stop", "target", "flatBy", "ticketId"})
    symbol: str
    qty: int
    avg_price: float
    last_price: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    stop: Optional[float] = None
    target: Optional[float] = None
    flat_by: Optional[str] = None
    ticket_id: Optional[str] = None


class FillCreate(ApiModel):
    symbol: str = Field(pattern=r"^[A-Za-z]{1,5}([.\-][A-Za-z]{1,2})?$")
    side: Literal["buy", "sell"]
    qty: int = Field(ge=1)
    price: float = Field(gt=0)
    ticket_id: Optional[str] = None
    at: Optional[str] = None


class Fill(FillCreate):
    NULLABLE = frozenset({"realizedPnl"})
    id: str
    realized_pnl: Optional[float] = None


AlertType = Literal["above", "below", "stop", "target", "pct_move", "time", "open_bell", "flat_by"]


class AlertCreate(ApiModel):
    type: AlertType
    symbol: Optional[str] = Field(default=None, pattern=r"^[A-Za-z]{1,5}([.\-][A-Za-z]{1,2})?$")
    level: Optional[float] = Field(default=None, gt=0)
    pct: Optional[float] = Field(default=None, gt=0)
    time: Optional[str] = Field(default=None, pattern=r"^([01]?\d|2[0-3]):[0-5]\d$")
    note: Optional[str] = None


class Alert(AlertCreate):
    NULLABLE = frozenset({"rungAt"})
    id: str
    status: Literal["armed", "rung"]
    created_at: str
    rung_at: Optional[str] = None


class AlertsFromPlan(ApiModel):
    run_id: str


def dump(model: BaseModel) -> Any:
    """Wire JSON (camelCase, nullable rules applied)."""
    return model.model_dump(mode="json", by_alias=True)
