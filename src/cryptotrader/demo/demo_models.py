# D:\CryptoTrader\src\cryptotrader\demo\demo_models.py

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class DemoBaseModel(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        populate_by_name=True,
        from_attributes=True,
    )


class DemoTrade(DemoBaseModel):
    trade_id: str
    symbol: str
    side: Literal["long", "short", "buy", "sell", "unknown"] = "unknown"
    status: Literal["open", "closed", "unknown"] = "unknown"
    quantity: float = 0.0
    entry_price: float | None = None
    current_price: float | None = None
    exit_price: float | None = None
    unrealized_pnl: float | None = None
    realized_pnl: float | None = None
    opened_at: str | None = None
    closed_at: str | None = None
    bucket_key: str | None = None
    broker_name: str | None = None
    notes: str | None = None


class DemoEquityPoint(DemoBaseModel):
    ts: str
    equity: float
    label: str | None = None


class DemoEvent(DemoBaseModel):
    ts: str
    kind: str
    message: str
    payload: dict[str, Any] = Field(default_factory=dict)


class DemoStatus(DemoBaseModel):
    mode: Literal["paper", "demo"] = "paper"
    db_path: str
    db_exists: bool
    broker_name: str
    starting_equity: float
    open_trade_count: int = 0
    closed_trade_count: int = 0
    realized_pnl: float = 0.0
    unrealized_pnl: float = 0.0
    total_equity: float = 0.0
    win_rate: float = 0.0
    winners: int = 0
    losers: int = 0
    last_trade_ts: str | None = None
    last_event_ts: str | None = None
    db_mtime: str | None = None


class DemoSnapshot(DemoBaseModel):
    generated_at: str
    status: DemoStatus
    open_trades: list[DemoTrade] = Field(default_factory=list)
    closed_trades: list[DemoTrade] = Field(default_factory=list)
    equity: list[DemoEquityPoint] = Field(default_factory=list)
    events: list[DemoEvent] = Field(default_factory=list)


class DemoWsMessage(DemoBaseModel):
    type: Literal["snapshot", "ping", "error"] = "snapshot"
    data: DemoSnapshot | dict[str, Any]