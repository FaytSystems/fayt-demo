# D:\CryptoTrader\src\cryptotrader\demo\public_live_trades.py
"""Public-safe live trade rows for the Fayt demo.

This endpoint is intentionally a public display adapter, not a trading/control API.
It exposes only the fields required by demo.faytsystems.com:

- symbol
- side
- target exit price
- current price
- entry/exit marker prices
- PnL

It also enforces a public display symbol allowlist so stale/dev/test rows such as
FIL/USD or GRT/USD cannot leak into the public demo even if they still exist in
fayt_public_demo_live.db.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

DEFAULT_DEMO_DB = Path(r"D:\CryptoTrader\data\fayt_public_demo_live.db")

# Keep this intentionally narrow.  The public website should never infer its own
# universe from whatever rows happen to exist in a SQLite table.
DEFAULT_ALLOWED_SYMBOLS: tuple[str, ...] = (
    "AAVE/USD",
    "ADA/USD",
    "ARB/USD",
    "ATOM/USD",
    "AVAX/USD",
    "BCH/USD",
    "BTC/USD",
    "DOGE/USD",
    "DOT/USD",
    "ENA/USD",
    "ETH/USD",
    "HBAR/USD",
    "LINK/USD",
    "LTC/USD",
    "NEAR/USD",
    "ONDO/USD",
    "PAXG/USD",
    "PEPE/USD",
    "SHIB/USD",
    "SOL/USD",
    "XRP/USD",
    "ZEC/USD",
)

MAX_QUERY_ROWS = 2_000
MAX_PUBLIC_LIMIT = 100


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_demo_db() -> Path:
    for key in ("DEMO_DB_PATH", "FAYT_DEMO_DB", "LIVE_DB_PATH", "DB_PATH"):
        val = os.environ.get(key)
        if val:
            return Path(val)
    return DEFAULT_DEMO_DB


def _split_symbols(raw: str | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    for item in raw.replace(";", ",").split(","):
        symbol = item.strip().upper()
        if symbol and symbol not in out:
            out.append(symbol)
    return out


def _allowed_symbols() -> list[str]:
    """Return the public demo symbol universe.

    Optional env override, still explicit and controlled:
      FAYT_PUBLIC_DEMO_SYMBOLS="AAVE/USD,ARB/USD,..."
      FAYT_DEMO_ALLOWED_SYMBOLS="AAVE/USD,ARB/USD,..."
    """
    configured = _split_symbols(
        os.environ.get("FAYT_PUBLIC_DEMO_SYMBOLS")
        or os.environ.get("FAYT_DEMO_ALLOWED_SYMBOLS")
        or os.environ.get("DEMO_ALLOWED_SYMBOLS")
    )
    return configured or list(DEFAULT_ALLOWED_SYMBOLS)


def _selected_symbols(symbols: str | None, allowed: Sequence[str]) -> list[str]:
    """Query param can narrow the display, never expand it."""
    allowed_set = set(allowed)
    requested = _split_symbols(symbols)
    if not requested:
        return list(allowed)
    return [s for s in requested if s in allowed_set]


def _connect(db_path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(db_path), timeout=8)
    con.row_factory = sqlite3.Row
    return con


def _quote_identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _tables(con: sqlite3.Connection) -> set[str]:
    return {str(r[0]) for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _columns(con: sqlite3.Connection, table: str) -> dict[str, str]:
    return {str(r[1]).lower(): str(r[1]) for r in con.execute(f"PRAGMA table_info({_quote_identifier(table)})")}


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
    s = str(value or "long").lower().strip()
    if "short" in s or s in {"sell", "sell_short", "short_sell"}:
        return "short"
    return "long"


def _status(value: Any, exit_price: float | None = None, closed_at: Any = None) -> str:
    s = str(value or "").lower().strip()
    if exit_price is not None or closed_at not in (None, ""):
        return "closed"
    if s in {"closed", "exit", "exited", "complete", "completed", "filled_exit"}:
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


def _sort_key(trade: dict[str, Any]) -> tuple[int, str, float]:
    # Open trades first, then newest by id/open timestamp.
    status_rank = 0 if trade.get("status") == "open" else 1
    opened = str(trade.get("opened_at") or "")
    try:
        numeric_id = float(trade.get("id") or 0)
    except Exception:
        numeric_id = 0.0
    return (status_rank, opened, numeric_id)


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


def _query_allowed_rows(
    con: sqlite3.Connection,
    table: str,
    cols: dict[str, str],
    sym_col: str,
    selected: Sequence[str],
    row_limit: int,
) -> list[sqlite3.Row]:
    order = _pick(cols, ["updated_utc", "created_utc", "opened_at", "entry_ts", "ts", "id"])
    if not selected:
        return []
    placeholders = ",".join("?" for _ in selected)
    sql = f"SELECT * FROM {_quote_identifier(table)} WHERE {_quote_identifier(sym_col)} IN ({placeholders})"
    if order:
        sql += f" ORDER BY {_quote_identifier(order)} DESC"
    sql += f" LIMIT {int(row_limit)}"
    try:
        return list(con.execute(sql, list(selected)))
    except Exception:
        return []


def _count_filtered_out(con: sqlite3.Connection, table: str, sym_col: str, allowed: Sequence[str]) -> int | None:
    if not allowed:
        return None
    placeholders = ",".join("?" for _ in allowed)
    sql = f"SELECT COUNT(*) FROM {_quote_identifier(table)} WHERE {_quote_identifier(sym_col)} NOT IN ({placeholders})"
    try:
        return int(con.execute(sql, list(allowed)).fetchone()[0])
    except Exception:
        return None


def _read_trades(
    con: sqlite3.Connection,
    timeframe: str,
    selected: Sequence[str],
    allowed: Sequence[str],
) -> tuple[list[dict[str, Any]], int | None, str | None]:
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

        rows = _query_allowed_rows(con, table, cols, sym_col, selected, row_limit=MAX_QUERY_ROWS)
        filtered_out = _count_filtered_out(con, table, sym_col, allowed)

        trades: list[dict[str, Any]] = []
        for idx, row in enumerate(rows):
            symbol = str(_val(row, sym_col, "") or "").strip().upper()
            if symbol not in selected:
                continue

            side = _side(_val(row, side_col, "long"))
            entry = _f(_val(row, entry_col))
            exit_price = _f(_val(row, exit_col))
            target = _f(_val(row, target_col))
            current = _f(_val(row, current_col)) or _try_latest_close(symbol, timeframe)
            qty = _f(_val(row, qty_col), 1.0)
            closed_at = _val(row, closed_col)
            pnl = _f(_val(row, pnl_col))
            if pnl is None and entry is not None and current is not None and qty is not None:
                mult = -1.0 if side == "short" else 1.0
                pnl = (current - entry) * qty * mult

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
                    "status": _status(_val(row, status_col), exit_price=exit_price, closed_at=closed_at),
                    "opened_at": _val(row, opened_col),
                    "closed_at": closed_at,
                }
            )

        if trades:
            trades.sort(key=_sort_key, reverse=True)
            # Because _sort_key reverse=True would put closed first by status_rank, repair with explicit open-first sort.
            trades.sort(key=lambda t: (0 if t.get("status") == "open" else 1, str(t.get("opened_at") or "")), reverse=False)
            # Keep newest within each status group.
            open_trades = sorted(
                [t for t in trades if t.get("status") == "open"],
                key=lambda t: (str(t.get("opened_at") or ""), float(t.get("id") or 0) if str(t.get("id") or "").replace(".", "", 1).isdigit() else 0.0),
                reverse=True,
            )
            closed_trades = sorted(
                [t for t in trades if t.get("status") != "open"],
                key=lambda t: (str(t.get("closed_at") or t.get("opened_at") or ""), float(t.get("id") or 0) if str(t.get("id") or "").replace(".", "", 1).isdigit() else 0.0),
                reverse=True,
            )
            return open_trades + closed_trades, filtered_out, table

    return [], None, None


def _read_event_markers(
    con: sqlite3.Connection,
    selected: Sequence[str],
    marker_source_trades: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    tables = _tables(con)
    markers: list[dict[str, Any]] = []
    selected_set = set(selected)

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

        placeholders = ",".join("?" for _ in selected)
        order = ts_col or _pick(cols, ["id"])
        sql = f"SELECT * FROM {_quote_identifier(table)} WHERE {_quote_identifier(sym_col)} IN ({placeholders})"
        if order:
            sql += f" ORDER BY {_quote_identifier(order)} DESC"
        sql += " LIMIT 300"
        try:
            rows = list(con.execute(sql, list(selected)))
        except Exception:
            continue

        for row in rows:
            symbol = str(_val(row, sym_col, "") or "").strip().upper()
            if symbol not in selected_set:
                continue
            raw_kind = str(_val(row, kind_col, "entry") or "entry").lower()
            kind = "exit" if any(x in raw_kind for x in ["exit", "close", "sell_to_close", "cover"]) else "entry"
            marker_price = _f(_val(row, price_col))
            if marker_price is None:
                continue
            markers.append(
                {
                    "symbol": symbol,
                    "kind": kind,
                    "side": _side(_val(row, side_col, "long")),
                    "price": marker_price,
                    "ts": _val(row, ts_col),
                    "label": "Exit" if kind == "exit" else "Entry",
                }
            )

        if markers:
            return markers

    # Fallback: create markers from already filtered trade rows only.
    for trade in marker_source_trades:
        symbol = str(trade.get("symbol") or "").strip().upper()
        if symbol not in selected_set:
            continue
        if trade.get("entry_price") is not None:
            markers.append(
                {
                    "symbol": symbol,
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
                    "symbol": symbol,
                    "kind": "exit",
                    "side": trade.get("side"),
                    "price": trade.get("exit_price"),
                    "ts": trade.get("closed_at"),
                    "label": "Exit",
                }
            )
    return markers


def _clip(items: Sequence[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    n = max(1, min(int(limit or 50), MAX_PUBLIC_LIMIT))
    return list(items[:n])


def get_public_live_trades(symbols: str | None = None, timeframe: str = "60m", limit: int = 50) -> dict[str, Any]:
    """Return public-safe live trades for demo.faytsystems.com.

    Enforcement rules:
      1. Only allowed public symbols are returned.
      2. The `symbols` query parameter can narrow the allowed list, never expand it.
      3. `trades` contains open trades only; if no open trades exist it returns an empty list.
      4. `recent_trades` contains recent allowed open+closed rows for diagnostics/future UI.
      5. Markers are filtered to the same allowed public symbol universe.
      6. won_count/lost_count summarize closed allowed trades by PnL.
    """
    db_path = _resolve_demo_db()
    allowed = _allowed_symbols()
    selected = _selected_symbols(symbols, allowed)
    public_limit = max(1, min(int(limit or 50), MAX_PUBLIC_LIMIT))

    base: dict[str, Any] = {
        "ok": False,
        "source": "public_live_trades_allowed_filter_v1",
        "generated_at": _now(),
        "allowed_symbols": allowed,
        "selected_symbols": selected,
        "running_pnl": 0.0,
        "open_pnl": 0.0,
        "closed_pnl": 0.0,
        "open_count": 0,
        "recent_count": 0,
        "won_count": 0,
        "lost_count": 0,
        "filtered_out_count": None,
        "trade_table": None,
        "trades": [],
        "recent_trades": [],
        "markers": [],
    }

    if not selected:
        base["ok"] = True
        return base

    if not db_path.exists():
        base["error"] = "demo_db_missing"
        return base

    con = _connect(db_path)
    try:
        all_allowed_trades, filtered_out_count, trade_table = _read_trades(
            con,
            timeframe=timeframe,
            selected=selected,
            allowed=allowed,
        )
        open_trades = [t for t in all_allowed_trades if t.get("status") == "open"]
        closed_trades = [t for t in all_allowed_trades if t.get("status") != "open"]
        visible_trades = _clip(open_trades, public_limit)
        recent_trades = _clip(open_trades + closed_trades, public_limit)
        markers = _read_event_markers(con, selected=selected, marker_source_trades=recent_trades)
        markers = _clip(markers, max(public_limit * 4, 50))

        open_pnl = sum(float(t.get("pnl") or 0.0) for t in open_trades)
        closed_pnl = sum(float(t.get("pnl") or 0.0) for t in closed_trades)
        won_count = sum(1 for t in closed_trades if float(t.get("pnl") or 0.0) > 0.0)
        lost_count = sum(1 for t in closed_trades if float(t.get("pnl") or 0.0) < 0.0)

        return {
            **base,
            "ok": True,
            "generated_at": _now(),
            "running_pnl": open_pnl + closed_pnl,
            "open_pnl": open_pnl,
            "closed_pnl": closed_pnl,
            "open_count": len(open_trades),
            "recent_count": len(all_allowed_trades),
            "won_count": won_count,
            "lost_count": lost_count,
            "filtered_out_count": filtered_out_count,
            "trade_table": trade_table,
            "trades": visible_trades,
            "recent_trades": recent_trades,
            "markers": markers,
        }
    finally:
        con.close()
