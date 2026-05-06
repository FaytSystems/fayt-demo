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
    trade_id: str | None = None
    id: int | None = None
    symbol: str
    side: Literal["long", "short", "buy", "sell", "unknown"] = "unknown"
    status: Literal["open", "closed", "unknown"] = "unknown"
    quantity: float = 0.0
    qty: float | None = None
    entry_price: float | None = None
    current_price: float | None = None
    exit_price: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    unrealized_pnl: float | None = None
    realized_pnl: float | None = None
    opened_at: str | None = None
    closed_at: str | None = None
    learned_bucket_id: int | None = None
    bucket_key: str | None = None
    broker_name: str | None = None
    notes: str | None = None


class DemoEquityPoint(DemoBaseModel):
    ts: str
    equity: float
    label: str | None = None


class DemoEvent(DemoBaseModel):
    id: int | None = None
    ts: str | None = None
    event_ts: str | None = None
    kind: str | None = None
    event_type: str | None = None
    message: str | None = None
    symbol: str | None = None
    payload_json: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class DemoStatus(DemoBaseModel):
    mode: Literal["paper", "demo"] = "paper"
    db_path: str | None = None
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
    account_name: str | None = None
    execution_mode: str | None = None
    market_data_mode: str | None = None
    orders_allowed: bool = False
    status_source: str | None = None
    updated_at: str | None = None


class MarketCandle(DemoBaseModel):
    ts: str
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class MarketTradeMarker(DemoBaseModel):
    id: int
    symbol: str
    side: str = "unknown"
    qty: float = 0.0
    status: str = "unknown"
    entry_price: float
    exit_price: float | None = None
    target_exit_price: float | None = None
    stop_loss: float | None = None
    entry_ts: str
    exit_ts: str | None = None


class MarketBoardSymbol(DemoBaseModel):
    symbol: str
    last_price: float = 0.0
    change: float = 0.0
    pct_change: float = 0.0
    high: float = 0.0
    low: float = 0.0
    volume: float = 0.0
    candles: list[MarketCandle] = Field(default_factory=list)
    markers: list[MarketTradeMarker] = Field(default_factory=list)


class MarketBoardResponse(DemoBaseModel):
    as_of: str
    timeframe: str = "1m"
    symbols: list[MarketBoardSymbol] = Field(default_factory=list)


class DemoSnapshot(DemoBaseModel):
    generated_at: str
    status: DemoStatus
    open_trades: list[DemoTrade] = Field(default_factory=list)
    closed_trades: list[DemoTrade] = Field(default_factory=list)
    equity: list[DemoEquityPoint] = Field(default_factory=list)
    events: list[DemoEvent] = Field(default_factory=list)
    market_board: MarketBoardResponse | None = None


class DemoWsMessage(DemoBaseModel):
    type: Literal["snapshot", "ping", "error"] = "snapshot"
    data: DemoSnapshot | dict[str, Any]