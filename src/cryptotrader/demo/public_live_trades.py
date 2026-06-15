# D:\CryptoTrader\src\cryptotrader\demo\public_live_trades.py
"""Public-safe live trade rows for the Fayt demo.

This module intentionally exposes only display fields needed by the public demo:
symbol, side, target exit price, current price, entry/exit marker prices, and PnL.
It does not expose strategy reasons, signal atoms, policy scores, database paths,
broker keys, order IDs, or any write/trade controls.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DEFAULT_DEMO_DB = Path(r"D:\CryptoTrader\data\fayt_public_demo_live.db")
DEFAULT_SYMBOLS = ["AAVE/USD", "ARB/USD", "BTC/USD", "ETH/USD", "SOL/USD", "ADA/USD"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_demo_db() -> Path:
    for key in ("DEMO_DB_PATH", "FAYT_DEMO_DB", "LIVE_DB_PATH", "DB_PATH"):
        val = os.environ.get(key)
        if val:
            return Path(val)
    return DEFAULT_DEMO_DB


def _connect(db_path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(db_path), timeout=8)
    con.row_factory = sqlite3.Row
    return con


def _tables(con: sqlite3.Connection) -> set[str]:
    return {str(r[0]) for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _columns(con: sqlite3.Connection, table: str) -> dict[str, str]:
    return {str(r[1]).lower(): str(r[1]) for r in con.execute(f"PRAGMA table_info({table})")}


def _pick(cols: dict[str, str], names: Iterable[str]) -> str | None:
    for name in names:
        if name.lower() in cols:
            return cols[name.lower()]
    return None


def _val(row: sqlite3.Row | dict[str, Any], key: str | None, default: Any = None) -> Any:
    if not key:
        return default
    try:
        return row[key]
    except Exception:
        return default


def _f(value: Any, default: float | None = None) -> float | None:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def _side(value: Any) -> str:
    s = str(value or "long").lower()
    if "short" in s or s == "sell":
        return "short"
    return "long"


def _status(value: Any, exit_price: float | None = None) -> str:
    s = str(value or "").lower()
    if exit_price is not None or s in {"closed", "exit", "exited", "complete", "filled_exit"}:
        return "closed"
    return "open"


def _try_latest_close(symbol: str, timeframe: str) -> float | None:
    try:
        from cryptotrader.demo.live_candles import get_public_live_candles

        payload = get_public_live_candles(symbol=symbol, timeframe=timeframe, limit=1)
        candles = payload.get("candles") or []
        if candles:
            return _f(candles[-1].get("close"))
    except Exception:
        return None
    return None


def _candidate_trade_tables(tables: set[str]) -> list[str]:
    preferred = [
        "public_live_trades",
        "live_trades",
        "open_trades",
        "positions",
        "open_positions",
        "trades",
        "paper_trades",
        "runtime_trades",
    ]
    out = [t for t in preferred if t in tables]
    out.extend(sorted(t for t in tables if "trade" in t.lower() and t not in out and "event" not in t.lower()))
    return out


def _query_rows(con: sqlite3.Connection, table: str, cols: dict[str, str], limit: int) -> list[sqlite3.Row]:
    order = _pick(cols, ["updated_utc", "created_utc", "opened_at", "entry_ts", "ts", "id"])
    sql = f"SELECT * FROM {table}"
    if order:
        sql += f" ORDER BY {order} DESC"
    sql += f" LIMIT {int(limit)}"
    try:
        return list(con.execute(sql))
    except Exception:
        return []


def _read_trades(con: sqlite3.Connection, timeframe: str, limit: int) -> list[dict[str, Any]]:
    tables = _tables(con)
    for table in _candidate_trade_tables(tables):
        cols = _columns(con, table)
        sym_col = _pick(cols, ["symbol", "pair", "asset"])
        if not sym_col:
            continue
        side_col = _pick(cols, ["side", "direction", "position_side", "action"])
        entry_col = _pick(cols, ["entry_price", "open_price", "avg_entry_price", "price"])
        exit_col = _pick(cols, ["exit_price", "close_price", "avg_exit_price"])
        target_col = _pick(cols, ["target_exit_price", "target_price", "take_profit_price", "take_profit", "tp_price", "exit_target"])
        current_col = _pick(cols, ["current_price", "last_price", "mark_price", "latest_price"])
        qty_col = _pick(cols, ["qty", "quantity", "size", "notional_qty", "shares", "units"])
        pnl_col = _pick(cols, ["pnl", "unrealized_pnl", "realized_pnl", "closed_pnl", "profit_loss"])
        status_col = _pick(cols, ["status", "state", "trade_status"])
        opened_col = _pick(cols, ["opened_at", "entry_ts", "created_utc", "created_at", "ts"])
        closed_col = _pick(cols, ["closed_at", "exit_ts", "closed_utc"])
        id_col = _pick(cols, ["id", "trade_id", "position_id"])

        rows = _query_rows(con, table, cols, limit=limit)
        trades: list[dict[str, Any]] = []
        for idx, row in enumerate(rows):
            symbol = str(_val(row, sym_col, "") or "").strip()
            if not symbol:
                continue
            side = _side(_val(row, side_col, "long"))
            entry = _f(_val(row, entry_col))
            exit_price = _f(_val(row, exit_col))
            target = _f(_val(row, target_col))
            current = _f(_val(row, current_col)) or _try_latest_close(symbol, timeframe)
            qty = _f(_val(row, qty_col), 1.0)
            pnl = _f(_val(row, pnl_col))
            if pnl is None and entry is not None and current is not None and qty is not None:
                mult = -1.0 if side == "short" else 1.0
                pnl = (current - entry) * qty * mult
            status = _status(_val(row, status_col), exit_price=exit_price)
            trades.append(
                {
                    "id": _val(row, id_col, idx),
                    "symbol": symbol,
                    "side": side,
                    "target_exit_price": target,
                    "current_price": current,
                    "entry_price": entry,
                    "exit_price": exit_price,
                    "qty": qty,
                    "pnl": pnl,
                    "status": status,
                    "opened_at": _val(row, opened_col),
                    "closed_at": _val(row, closed_col),
                }
            )
        if trades:
            return trades
    return []


def _read_event_markers(con: sqlite3.Connection, trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tables = _tables(con)
    markers: list[dict[str, Any]] = []

    event_tables = [t for t in ["public_trade_markers", "trade_events", "events", "fills"] if t in tables]
    event_tables.extend(sorted(t for t in tables if "trade" in t.lower() and "event" in t.lower() and t not in event_tables))

    for table in event_tables:
        cols = _columns(con, table)
        sym_col = _pick(cols, ["symbol", "pair", "asset"])
        if not sym_col:
            continue
        kind_col = _pick(cols, ["kind", "event", "event_type", "action", "type"])
        price_col = _pick(cols, ["price", "fill_price", "entry_price", "exit_price", "close_price"])
        side_col = _pick(cols, ["side", "direction", "position_side"])
        ts_col = _pick(cols, ["ts", "time", "created_utc", "created_at", "event_ts", "timestamp"])
        if not price_col:
            continue
        order = ts_col or _pick(cols, ["id"])
        sql = f"SELECT * FROM {table}"
        if order:
            sql += f" ORDER BY {order} DESC"
        sql += " LIMIT 80"
        try:
            rows = list(con.execute(sql))
        except Exception:
            continue
        for row in rows:
            raw_kind = str(_val(row, kind_col, "entry")).lower()
            kind = "exit" if any(x in raw_kind for x in ["exit", "close", "sell_to_close", "cover"]) else "entry"
            price = _f(_val(row, price_col))
            if price is None:
                continue
            markers.append(
                {
                    "symbol": str(_val(row, sym_col, "")),
                    "kind": kind,
                    "side": _side(_val(row, side_col, "long")),
                    "price": price,
                    "ts": _val(row, ts_col),
                    "label": "Exit" if kind == "exit" else "Entry",
                }
            )
        if markers:
            return markers

    for trade in trades:
        if trade.get("entry_price") is not None:
            markers.append(
                {
                    "symbol": trade.get("symbol"),
                    "kind": "entry",
                    "side": trade.get("side"),
                    "price": trade.get("entry_price"),
                    "ts": trade.get("opened_at"),
                    "label": "Entry",
                }
            )
        if trade.get("exit_price") is not None:
            markers.append(
                {
                    "symbol": trade.get("symbol"),
                    "kind": "exit",
                    "side": trade.get("side"),
                    "price": trade.get("exit_price"),
                    "ts": trade.get("closed_at"),
                    "label": "Exit",
                }
            )
    return markers


def get_public_live_trades(symbols: str | None = None, timeframe: str = "60m", limit: int = 50) -> dict[str, Any]:
    db_path = _resolve_demo_db()
    selected = [s.strip() for s in str(symbols or "").split(",") if s.strip()]
    if not selected:
        selected = []

    if not db_path.exists():
        return {
            "ok": False,
            "source": "public_live_trades",
            "generated_at": _now(),
            "running_pnl": 0.0,
            "trades": [],
            "markers": [],
        }

    con = _connect(db_path)
    try:
        trades = _read_trades(con, timeframe=timeframe, limit=limit)
        if selected:
            trades = [t for t in trades if t.get("symbol") in selected]
        markers = _read_event_markers(con, trades)
        if selected:
            markers = [m for m in markers if m.get("symbol") in selected]
        running_pnl = sum(float(t.get("pnl") or 0.0) for t in trades)
        return {
            "ok": True,
            "source": "public_live_trades",
            "generated_at": _now(),
            "running_pnl": running_pnl,
            "trades": trades,
            "markers": markers,
        }
    finally:
        con.close()
