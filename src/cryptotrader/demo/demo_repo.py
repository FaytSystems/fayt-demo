# D:\CryptoTrader\src\cryptotrader\demo\demo_repo.py

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .demo_models import DemoEquityPoint, DemoEvent, DemoSnapshot, DemoStatus, DemoTrade


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_float(value: Any, default: float | None = None) -> float | None:
    try:
        if value is None:
            return default

        text = str(value).strip()

        if not text:
            return default

        return float(text)

    except Exception:
        return default


class DemoRepo:
    EVENT_TABLE_CANDIDATES = ("runner_events", "trade_events", "event_log", "events")

    def __init__(
        self,
        db_path: str | Path,
        starting_equity: float = 30_000.0,
        broker_name: str = "paper_sim",
    ) -> None:
        self.db_path = Path(db_path)
        self.starting_equity = float(starting_equity)
        self.broker_name = broker_name

    def db_exists(self) -> bool:
        return self.db_path.exists()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=5.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = 1")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def _table_exists(self, table_name: str) -> bool:
        if not self.db_exists():
            return False

        try:
            with self._connect() as conn:
                row = conn.execute(
                    """
                    SELECT 1
                    FROM sqlite_master
                    WHERE type = 'table'
                      AND name = ?
                    LIMIT 1
                    """,
                    (table_name,),
                ).fetchone()

            return row is not None

        except sqlite3.Error:
            return False

    def _columns(self, table_name: str) -> set[str]:
        if not self._table_exists(table_name):
            return set()

        try:
            with self._connect() as conn:
                rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()

            return {str(row["name"]) for row in rows}

        except sqlite3.Error:
            return set()

    def _first(self, row: dict[str, Any], *keys: str, default: Any = None) -> Any:
        for key in keys:
            if key in row and row[key] not in (None, ""):
                return row[key]

        return default

    def _to_iso(self, value: Any) -> str | None:
        if value in (None, ""):
            return None

        if isinstance(value, (int, float)):
            epoch = float(value)

            if epoch > 1_000_000_000_000:
                epoch /= 1000.0

            return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()

        text = str(value).strip()

        if not text:
            return None

        if text.isdigit():
            epoch = float(text)

            if epoch > 1_000_000_000_000:
                epoch /= 1000.0

            return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()

        try:
            normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
            parsed = datetime.fromisoformat(normalized)

            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)

            return parsed.astimezone(timezone.utc).isoformat()

        except ValueError:
            return text

    def _normalize_side(self, value: Any) -> str:
        text = str(value or "").strip().lower()

        if text in {"buy", "long"}:
            return "long" if text == "long" else "buy"

        if text in {"sell", "short"}:
            return "short" if text == "short" else "sell"

        return "unknown"

    def _normalize_status(
        self,
        value: Any,
        *,
        closed_at: str | None,
        exit_price: float | None,
    ) -> str:
        text = str(value or "").strip().lower()

        if text in {"open", "opened", "active", "filled"} and not closed_at and exit_price is None:
            return "open"

        if text in {"closed", "complete", "completed", "done", "exited"}:
            return "closed"

        if closed_at or exit_price is not None:
            return "closed"

        return "open"

    def _parse_payload(self, value: Any) -> dict[str, Any]:
        if value in (None, ""):
            return {}

        if isinstance(value, dict):
            return value

        try:
            parsed = json.loads(value)

            if isinstance(parsed, dict):
                return parsed

            return {"value": parsed}

        except Exception:
            return {"value": str(value)}

    def _fetch_trade_rows(self) -> list[dict[str, Any]]:
        if not self._table_exists("trades"):
            return []

        try:
            with self._connect() as conn:
                rows = conn.execute("SELECT * FROM trades").fetchall()

            return [dict(row) for row in rows]

        except sqlite3.Error:
            return []

    def _trade_from_row(self, row: dict[str, Any]) -> DemoTrade:
        trade_id = str(
            self._first(
                row,
                "trade_id",
                "id",
                "client_order_id",
                "order_id",
                default="unknown",
            )
        )

        symbol = str(self._first(row, "symbol", "product_id", default="unknown"))
        side = self._normalize_side(self._first(row, "side", "direction", default="unknown"))

        quantity = safe_float(
            self._first(row, "quantity", "qty", "size", "position_size", default=0.0),
            0.0,
        ) or 0.0

        entry_price = safe_float(self._first(row, "entry_price", "entry", "avg_entry_price"))
        current_price = safe_float(
            self._first(row, "current_price", "mark_price", "last_price", "price")
        )
        exit_price = safe_float(self._first(row, "exit_price", "exit", "avg_exit_price"))

        opened_at = self._to_iso(self._first(row, "opened_at", "open_time", "created_at", "ts"))
        closed_at = self._to_iso(self._first(row, "closed_at", "close_time", "closed_ts"))

        status = self._normalize_status(
            self._first(row, "status"),
            closed_at=closed_at,
            exit_price=exit_price,
        )

        realized_pnl = safe_float(self._first(row, "realized_pnl", "pnl", "profit"))
        unrealized_pnl = safe_float(self._first(row, "unrealized_pnl"))

        direction = -1.0 if side in {"short", "sell"} else 1.0

        if (
            status == "closed"
            and realized_pnl is None
            and entry_price is not None
            and exit_price is not None
            and quantity
        ):
            realized_pnl = round((exit_price - entry_price) * quantity * direction, 6)

        if (
            status == "open"
            and unrealized_pnl is None
            and entry_price is not None
            and current_price is not None
            and quantity
        ):
            unrealized_pnl = round((current_price - entry_price) * quantity * direction, 6)

        if status == "open" and current_price is None:
            current_price = entry_price

        if status == "closed":
            unrealized_pnl = 0.0
            realized_pnl = realized_pnl or 0.0
        else:
            realized_pnl = realized_pnl or 0.0
            unrealized_pnl = unrealized_pnl or 0.0

        return DemoTrade(
            trade_id=trade_id,
            symbol=symbol,
            side=side,
            status=status,
            quantity=quantity,
            entry_price=entry_price,
            current_price=current_price,
            exit_price=exit_price,
            unrealized_pnl=unrealized_pnl,
            realized_pnl=realized_pnl,
            opened_at=opened_at,
            closed_at=closed_at,
            bucket_key=self._first(row, "bucket_key"),
            broker_name=str(self._first(row, "broker_name", default=self.broker_name)),
            notes=str(self._first(row, "notes", "comment", default="")) or None,
        )

    def _all_trades(self) -> list[DemoTrade]:
        return [self._trade_from_row(row) for row in self._fetch_trade_rows()]

    def get_open_trades(self, limit: int = 25) -> list[DemoTrade]:
        trades = [trade for trade in self._all_trades() if trade.status == "open"]
        trades.sort(key=lambda trade: trade.opened_at or "", reverse=True)
        return trades[:limit]

    def get_closed_trades(self, limit: int = 50) -> list[DemoTrade]:
        trades = [trade for trade in self._all_trades() if trade.status == "closed"]
        trades.sort(key=lambda trade: trade.closed_at or trade.opened_at or "", reverse=True)
        return trades[:limit]

    def _event_table(self) -> str | None:
        for table_name in self.EVENT_TABLE_CANDIDATES:
            if self._table_exists(table_name):
                return table_name

        return None

    def get_events(self, limit: int = 100) -> list[DemoEvent]:
        table_name = self._event_table()

        if table_name is None:
            return []

        try:
            with self._connect() as conn:
                rows = conn.execute(
                    f"SELECT * FROM {table_name} ORDER BY rowid DESC LIMIT ?",
                    (limit,),
                ).fetchall()

        except sqlite3.Error:
            return []

        events: list[DemoEvent] = []

        for row in rows:
            data = dict(row)

            kind = str(
                self._first(
                    data,
                    "event_type",
                    "type",
                    "kind",
                    "name",
                    default="event",
                )
            )

            message = str(
                self._first(
                    data,
                    "message",
                    "summary",
                    "reason",
                    "description",
                    default=kind.replace("_", " ").title(),
                )
            )

            payload = self._parse_payload(
                self._first(data, "payload", "data", "details", "metadata")
            )

            ts = (
                self._to_iso(self._first(data, "ts", "created_at", "event_ts", "timestamp"))
                or utc_now_iso()
            )

            events.append(
                DemoEvent(
                    ts=ts,
                    kind=kind,
                    message=message,
                    payload=payload,
                )
            )

        return events

    def get_equity(self, limit: int = 250) -> list[DemoEquityPoint]:
        closed_trades = self.get_closed_trades(limit=10_000)
        open_trades = self.get_open_trades(limit=500)

        points: list[DemoEquityPoint] = []
        equity = self.starting_equity

        for trade in sorted(closed_trades, key=lambda item: item.closed_at or item.opened_at or ""):
            equity += trade.realized_pnl or 0.0

            points.append(
                DemoEquityPoint(
                    ts=trade.closed_at or trade.opened_at or utc_now_iso(),
                    equity=round(equity, 6),
                    label=trade.symbol,
                )
            )

        live_equity = equity + sum(trade.unrealized_pnl or 0.0 for trade in open_trades)

        points.append(
            DemoEquityPoint(
                ts=utc_now_iso(),
                equity=round(live_equity, 6),
                label="live",
            )
        )

        if not points:
            points = [
                DemoEquityPoint(
                    ts=utc_now_iso(),
                    equity=round(self.starting_equity, 6),
                    label="start",
                )
            ]

        return points[-limit:]

    def _db_mtime_iso(self) -> str | None:
        if not self.db_exists():
            return None

        return datetime.fromtimestamp(self.db_path.stat().st_mtime, tz=timezone.utc).isoformat()

    def get_status(self) -> DemoStatus:
        open_trades = self.get_open_trades(limit=500)
        closed_trades = self.get_closed_trades(limit=10_000)
        events = self.get_events(limit=1)

        realized_pnl = round(sum(trade.realized_pnl or 0.0 for trade in closed_trades), 6)
        unrealized_pnl = round(sum(trade.unrealized_pnl or 0.0 for trade in open_trades), 6)
        total_equity = round(self.starting_equity + realized_pnl + unrealized_pnl, 6)

        winners = sum(1 for trade in closed_trades if (trade.realized_pnl or 0.0) > 0)
        losers = sum(1 for trade in closed_trades if (trade.realized_pnl or 0.0) < 0)
        win_rate = round((winners / len(closed_trades)) * 100.0, 2) if closed_trades else 0.0

        trade_timestamps = [
            timestamp
            for timestamp in [
                *(trade.opened_at for trade in open_trades),
                *(trade.closed_at for trade in closed_trades),
            ]
            if timestamp
        ]

        return DemoStatus(
            db_path=str(self.db_path),
            db_exists=self.db_exists(),
            broker_name=self.broker_name,
            starting_equity=self.starting_equity,
            open_trade_count=len(open_trades),
            closed_trade_count=len(closed_trades),
            realized_pnl=realized_pnl,
            unrealized_pnl=unrealized_pnl,
            total_equity=total_equity,
            win_rate=win_rate,
            winners=winners,
            losers=losers,
            last_trade_ts=max(trade_timestamps) if trade_timestamps else None,
            last_event_ts=events[0].ts if events else None,
            db_mtime=self._db_mtime_iso(),
        )

    def get_snapshot(
        self,
        *,
        open_trade_limit: int = 25,
        closed_trade_limit: int = 50,
        event_limit: int = 100,
        equity_limit: int = 250,
    ) -> DemoSnapshot:
        return DemoSnapshot(
            generated_at=utc_now_iso(),
            status=self.get_status(),
            open_trades=self.get_open_trades(limit=open_trade_limit),
            closed_trades=self.get_closed_trades(limit=closed_trade_limit),
            equity=self.get_equity(limit=equity_limit),
            events=self.get_events(limit=event_limit),
        )