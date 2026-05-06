from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Iterable


DEFAULT_MARKET_SYMBOLS = [
    "BTC/USD",
    "ETH/USD",
    "SOL/USD",
    "XRP/USD",
    "DOGE/USD",
    "LINK/USD",
    "AVAX/USD",
    "BCH/USD",
]


class DemoRepo:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.starting_equity = float(os.getenv("DEMO_STARTING_EQUITY", "30000"))

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _table_exists(self, conn: sqlite3.Connection, table_name: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
            (table_name,),
        ).fetchone()
        return row is not None

    def _safe_float(self, value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except Exception:
            return default

    def _utc_now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def get_status(self) -> dict[str, Any]:
        status = {
            "mode": "paper",
            "broker_name": os.getenv("BROKER_NAME", "paper_sim"),
            "db_exists": os.path.exists(self.db_path),
            "starting_equity": self.starting_equity,
            "total_equity": self.starting_equity,
            "realized_pnl": 0.0,
            "unrealized_pnl": 0.0,
            "open_trade_count": 0,
            "closed_trade_count": 0,
            "win_rate": 0.0,
        }

        if not status["db_exists"]:
            return status

        with self._connect() as conn:
            if not self._table_exists(conn, "trades"):
                return status

            row = conn.execute(
                """
                SELECT
                    COALESCE(SUM(CASE WHEN status='open' THEN 1 ELSE 0 END), 0) AS open_trade_count,
                    COALESCE(SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END), 0) AS closed_trade_count,
                    COALESCE(SUM(CASE WHEN status='closed' THEN COALESCE(realized_pnl, 0) ELSE 0 END), 0) AS realized_pnl,
                    COALESCE(SUM(
                        CASE
                            WHEN status='open' THEN
                                CASE
                                    WHEN lower(COALESCE(side, '')) IN ('sell', 'short') THEN
                                        (COALESCE(entry_price, 0) - COALESCE(current_price, COALESCE(entry_price, 0))) * COALESCE(qty, 0)
                                    ELSE
                                        (COALESCE(current_price, COALESCE(entry_price, 0)) - COALESCE(entry_price, 0)) * COALESCE(qty, 0)
                                END
                            ELSE 0
                        END
                    ), 0) AS unrealized_pnl,
                    COALESCE(SUM(CASE WHEN status='closed' AND COALESCE(realized_pnl, 0) > 0 THEN 1 ELSE 0 END), 0) AS wins
                FROM trades
                """
            ).fetchone()

            open_trade_count = int(row["open_trade_count"] or 0)
            closed_trade_count = int(row["closed_trade_count"] or 0)
            realized_pnl = self._safe_float(row["realized_pnl"])
            unrealized_pnl = self._safe_float(row["unrealized_pnl"])
            wins = int(row["wins"] or 0)
            win_rate = (wins / closed_trade_count * 100.0) if closed_trade_count else 0.0

            status.update(
                {
                    "open_trade_count": open_trade_count,
                    "closed_trade_count": closed_trade_count,
                    "realized_pnl": round(realized_pnl, 6),
                    "unrealized_pnl": round(unrealized_pnl, 6),
                    "total_equity": round(self.starting_equity + realized_pnl + unrealized_pnl, 6),
                    "win_rate": round(win_rate, 4),
                }
            )

        return status

    def _get_trades(self, status: str, limit: int) -> list[dict[str, Any]]:
        if not os.path.exists(self.db_path):
            return []

        with self._connect() as conn:
            if not self._table_exists(conn, "trades"):
                return []

            rows = conn.execute(
                """
                SELECT
                    id,
                    symbol,
                    side,
                    qty,
                    entry_price,
                    current_price,
                    opened_at,
                    status,
                    closed_at,
                    exit_price,
                    realized_pnl,
                    stop_loss,
                    take_profit,
                    learned_bucket_id,
                    bucket_key,
                    notes
                FROM trades
                WHERE status = ?
                ORDER BY COALESCE(closed_at, opened_at) DESC
                LIMIT ?
                """,
                (status, limit),
            ).fetchall()

            return [dict(row) for row in rows]

    def get_open_trades(self, limit: int = 50) -> list[dict[str, Any]]:
        return self._get_trades("open", limit)

    def get_closed_trades(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._get_trades("closed", limit)

    def get_events(self, limit: int = 100) -> list[dict[str, Any]]:
        if not os.path.exists(self.db_path):
            return []

        with self._connect() as conn:
            if not self._table_exists(conn, "runner_events"):
                return []

            rows = conn.execute(
                """
                SELECT
                    id,
                    event_ts,
                    event_type,
                    symbol,
                    payload_json
                FROM runner_events
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

            return [dict(row) for row in rows]

    def get_equity(self, limit: int = 240) -> list[dict[str, Any]]:
        if not os.path.exists(self.db_path):
            return []

        with self._connect() as conn:
            if self._table_exists(conn, "equity_history"):
                rows = conn.execute(
                    """
                    SELECT ts, equity
                    FROM equity_history
                    ORDER BY ts DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
                points = [dict(row) for row in rows]
                points.reverse()
                return points

            if not self._table_exists(conn, "trades"):
                return []

            rows = conn.execute(
                """
                SELECT closed_at AS ts, COALESCE(realized_pnl, 0) AS realized_pnl
                FROM trades
                WHERE status='closed' AND closed_at IS NOT NULL
                ORDER BY closed_at ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

            running = self.starting_equity
            points: list[dict[str, Any]] = []
            for row in rows:
                running += self._safe_float(row["realized_pnl"])
                points.append(
                    {
                        "ts": row["ts"],
                        "equity": round(running, 6),
                    }
                )

            if not points:
                points.append({"ts": self._utc_now_iso(), "equity": self.starting_equity})

            return points

    def _discover_symbols(self, conn: sqlite3.Connection) -> list[str]:
        symbols: list[str] = []

        if self._table_exists(conn, "trades"):
            rows = conn.execute(
                """
                SELECT DISTINCT symbol
                FROM trades
                WHERE symbol IS NOT NULL AND symbol <> ''
                ORDER BY symbol
                LIMIT 24
                """
            ).fetchall()
            symbols.extend([str(row["symbol"]) for row in rows])

        if self._table_exists(conn, "bars"):
            rows = conn.execute(
                """
                SELECT DISTINCT symbol
                FROM bars
                WHERE timeframe='1m'
                ORDER BY symbol
                LIMIT 24
                """
            ).fetchall()
            for row in rows:
                symbol = str(row["symbol"])
                if symbol not in symbols:
                    symbols.append(symbol)

        if not symbols:
            symbols = DEFAULT_MARKET_SYMBOLS[:]

        return symbols[:12]

    def _get_trade_markers_for_symbol(
        self,
        conn: sqlite3.Connection,
        symbol: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        if not self._table_exists(conn, "trades"):
            return []

        rows = conn.execute(
            """
            SELECT
                id,
                symbol,
                side,
                qty,
                status,
                entry_price,
                exit_price,
                take_profit AS target_exit_price,
                stop_loss,
                opened_at AS entry_ts,
                closed_at AS exit_ts
            FROM trades
            WHERE symbol=?
            ORDER BY COALESCE(closed_at, opened_at) DESC
            LIMIT ?
            """,
            (symbol, limit),
        ).fetchall()

        return [dict(row) for row in rows]

    def get_market_board(
        self,
        symbols: Iterable[str] | None = None,
        timeframe: str = "1m",
        limit: int = 60,
    ) -> dict[str, Any]:
        payload = {
            "as_of": self._utc_now_iso(),
            "timeframe": timeframe,
            "symbols": [],
        }

        if not os.path.exists(self.db_path):
            return payload

        with self._connect() as conn:
            if not self._table_exists(conn, "bars"):
                return payload

            symbol_list = [s for s in (symbols or self._discover_symbols(conn)) if s][:12]

            for symbol in symbol_list:
                rows = conn.execute(
                    """
                    SELECT
                        ts,
                        open,
                        high,
                        low,
                        close,
                        volume
                    FROM bars
                    WHERE symbol=? AND timeframe=?
                    ORDER BY ts DESC
                    LIMIT ?
                    """,
                    (symbol, timeframe, limit),
                ).fetchall()

                if not rows:
                    continue

                ordered = list(reversed(rows))
                candles = [
                    {
                        "ts": row["ts"],
                        "open": self._safe_float(row["open"]),
                        "high": self._safe_float(row["high"]),
                        "low": self._safe_float(row["low"]),
                        "close": self._safe_float(row["close"]),
                        "volume": self._safe_float(row["volume"]),
                    }
                    for row in ordered
                ]

                last = candles[-1]
                prev = candles[-2] if len(candles) > 1 else candles[-1]
                change = last["close"] - prev["close"]
                pct_change = (change / prev["close"] * 100.0) if prev["close"] else 0.0
                high = max(c["high"] for c in candles)
                low = min(c["low"] for c in candles)
                volume = sum(c["volume"] for c in candles)

                payload["symbols"].append(
                    {
                        "symbol": symbol,
                        "last_price": round(last["close"], 8),
                        "change": round(change, 8),
                        "pct_change": round(pct_change, 6),
                        "high": round(high, 8),
                        "low": round(low, 8),
                        "volume": round(volume, 8),
                        "candles": candles,
                        "markers": self._get_trade_markers_for_symbol(conn, symbol, 20),
                    }
                )

        return payload

    def get_snapshot(self) -> dict[str, Any]:
        return {
            "status": self.get_status(),
            "open_trades": self.get_open_trades(25),
            "closed_trades": self.get_closed_trades(50),
            "equity": self.get_equity(240),
            "events": self.get_events(60),
            "market_board": self.get_market_board(limit=60),
        }