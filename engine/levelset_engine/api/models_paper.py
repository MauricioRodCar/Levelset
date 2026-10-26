"""v1.1 paper account models (docs/api/openapi.yaml, Paper* schemas)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from .models import ApiModel, OpenTrade

ExitReason = Literal["stop", "target", "flat_by", "reset"]
SkipReason = Literal["blocked", "stale", "duplicate"]


class PaperPeriod(ApiModel):
    NULLABLE = frozenset({"endedAt"})
    id: str
    number: int
    starting_balance_usd: float
    started_at: str
    ended_at: Optional[str] = None
    realized_pnl: float
    trades: int


class PaperAccount(ApiModel):
    id: str
    name: str
    active: bool
    starting_balance_usd: float
    cash_usd: float
    equity_usd: float
    realized_pnl: float
    unrealized_pnl: float
    open_positions: int
    current_period_id: str
    periods: list[PaperPeriod]
    created_at: str


class PaperAccountCreate(ApiModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    starting_balance_usd: Optional[float] = Field(default=None, gt=0)
    activate: bool = True


class PaperAccountReset(ApiModel):
    starting_balance_usd: Optional[float] = Field(default=None, gt=0)


class PaperPosition(OpenTrade):
    NULLABLE = OpenTrade.NULLABLE | {"unrealizedR"}
    id: str
    account_id: str
    period_id: str
    run_id: str
    setup: Optional[str] = None
    entry_at: str
    unrealized_r: Optional[float] = None
    slippage_usd: float
    backfilled: bool


class PaperTrade(ApiModel):
    NULLABLE = frozenset({"entryAt", "entryPrice", "exitAt", "exitPrice", "exitReason", "rMultiple", "pnl",
                          "slippageUsd", "skipReason"})
    id: str
    account_id: str
    period_id: str
    kind: Literal["closed", "skipped"]
    symbol: str
    setup: Optional[str] = None
    qty: int
    ticket_id: str
    run_id: str
    entry_at: Optional[str] = None
    entry_price: Optional[float] = None
    exit_at: Optional[str] = None
    exit_price: Optional[float] = None
    exit_reason: Optional[ExitReason] = None
    r_multiple: Optional[float] = None
    pnl: Optional[float] = None
    slippage_usd: Optional[float] = None
    skip_reason: Optional[SkipReason] = None
    backfilled: bool
    created_at: str


class PaperEquityPoint(ApiModel):
    NULLABLE = frozenset({"tradeId"})
    t: str
    equity_usd: float
    trade_id: Optional[str] = None


class PaperBreakdownRow(ApiModel):
    NULLABLE = frozenset({"winRatePct", "expectancyR"})
    key: str
    trades: int
    wins: int
    losses: int
    win_rate_pct: Optional[float] = None
    total_pnl: float
    expectancy_r: Optional[float] = None


class PaperStats(ApiModel):
    NULLABLE = frozenset({"from", "to", "winRatePct", "expectancyR", "avgWinR", "avgLossR", "profitFactor",
                          "groupBy"})
    account_id: str
    period_id: str
    from_: Optional[str] = Field(default=None, alias="from")
    to: Optional[str] = None
    starting_balance_usd: float
    ending_equity_usd: float
    total_pnl: float
    trades: int
    wins: int
    losses: int
    skipped: int
    win_rate_pct: Optional[float] = None
    expectancy_r: Optional[float] = None
    avg_win_r: Optional[float] = None
    avg_loss_r: Optional[float] = None
    profit_factor: Optional[float] = None
    max_drawdown_usd: float
    max_drawdown_pct: float
    longest_losing_streak: int
    equity_curve: list[PaperEquityPoint]
    group_by: Optional[Literal["ticker", "setup", "hour", "weekday"]] = None
    breakdown: list[PaperBreakdownRow]


class PaperCompareSide(ApiModel):
    NULLABLE = frozenset({"rTotal", "winRatePct"})
    trades: int
    pnl: float
    r_total: Optional[float] = None
    win_rate_pct: Optional[float] = None


class PaperCompareRow(ApiModel):
    NULLABLE = frozenset({"paper", "manual"})
    date: str
    symbol: str
    paper: Optional[PaperCompareSide] = None
    manual: Optional[PaperCompareSide] = None


class PaperCompareTotals(ApiModel):
    matched: int
    paper_only: int
    manual_only: int
    paper: PaperCompareSide
    manual: PaperCompareSide


class PaperComparison(ApiModel):
    NULLABLE = frozenset({"from", "to"})
    account_id: str
    from_: Optional[str] = Field(default=None, alias="from")
    to: Optional[str] = None
    rows: list[PaperCompareRow]
    totals: PaperCompareTotals


class PaperSettings(ApiModel):
    auto_follow: bool = True
    slippage_pct: float = Field(default=0.02, ge=0, le=5)
    slippage_per_share: float = Field(default=0.01, ge=0, le=1)


class PaperSettingsUpdate(ApiModel):
    auto_follow: Optional[bool] = None
    slippage_pct: Optional[float] = Field(default=None, ge=0, le=5)
    slippage_per_share: Optional[float] = Field(default=None, ge=0, le=1)
