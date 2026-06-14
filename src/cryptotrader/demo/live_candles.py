# D:\CryptoTrader\src\cryptotrader\demo\live_candles.py

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_RUNTIME_BARS_DB = r"W:\CryptoTrader_Archive\research_top100_l2.db"
DEFAULT_DEMO_DB = r"D:\CryptoTrader\data\fayt_public_demo_live.db"

SYMBOL_COLUMNS = ("symbol", "pair", "asset", "product_id")
TIMEFRAME_COLUMNS = ("timeframe", "tf", "interval", "bar_interval")
TS_COLUMNS = ("ts", "timestamp", "time", "datetime", "bar_ts", "start_ts", "open_time")
OPEN_COLUMNS = ("open", "open_price", "o")
HIGH_COLUMNS = ("high", "high_price", "h")
LOW_COLUMNS = ("low", "low_price", "l")
CLOSE_COLUMNS = ("close", "close_price", "c", "price")
VOLUME_COLUMNS = ("volume", "vol", "v")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        n = int(value)
    except Exception:
        return default
    return max(minimum, min(maximum, n))


def _safe_symbol(value: Any) -> str:
    text = str(value or "AAVE/USD").strip().upper().replace("-", "/")
    if not text:
        return "AAVE/USD"
    # Public endpoint guard: no raw SQL fragments, filesystem paths, or lists.
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/_")
    cleaned = "".join(ch for ch in text if ch in allowed)
    return cleaned[:24] or "AAVE/USD"


def _safe_timeframe(value: Any) -> str:
    text = str(value or "60m").strip().lower()
    aliases = {"1h": "60m", "60min": "60m", "1hour": "60m", "5min": "5m", "15min": "15m", "30min": "30m"}
    text = aliases.get(text, text)
    allowed = {"1m", "2m", "5m", "10m", "15m", "30m", "45m", "60m", "120m", "240m", "1d"}
    return text if text in allowed else "60m"


def _resolve_bars_db_path() -> Path:
    value = (
        os.getenv("DEMO_CANDLE_BARS_DB")
        or os.getenv("FAYT_DEMO_CANDLE_BARS_DB")
        or os.getenv("W_MASTER_300_RUNTIME_BARS_DB")
        or os.getenv("W_MASTER_300_BARS_DB")
        or os.getenv("RESEARCH_DB_PATH")
        or os.getenv("LIVE_DB_PATH")
        or os.getenv("DB_PATH")
        or DEFAULT_RUNTIME_BARS_DB
    )
    return Path(str(value))


def _resolve_demo_db_path() -> Path:
    value = (
        os.getenv("DEMO_DB_PATH")
        or os.getenv("PUBLIC_DEMO_DB_PATH")
        or os.getenv("LIVE_DB_PATH")
        or os.getenv("DB_PATH")
        or DEFAULT_DEMO_DB
    )
    return Path(str(value))


def _connect_readonly(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path.resolve().as_posix()}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=8)
    con.row_factory = sqlite3.Row
    try:
        con.execute("PRAGMA query_only = 1")
    except Exception:
        pass
    return con


def _quote_ident(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _table_names(con: sqlite3.Connection) -> list[str]:
    try:
        return [str(r[0]) for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    except Exception:
        return []


def _column_map(con: sqlite3.Connection, table: str) -> dict[str, str]:
    try:
        rows = con.execute(f"PRAGMA table_info({_quote_ident(table)})").fetchall()
    except Exception:
        return {}
    return {str(r[1]).lower(): str(r[1]) for r in rows}


def _pick(cols: dict[str, str], candidates: tuple[str, ...]) -> str | None:
    for c in candidates:
        if c.lower() in cols:
            return cols[c.lower()]
    return None


def _detect_bars_table(con: sqlite3.Connection, symbol: str, timeframe: str) -> dict[str, str] | None:
    preferred = ["bars", "market_bars", "ohlcv_bars", "candles", "runtime_bars", "selected_bars"]
    tables = _table_names(con)
    candidates = []
    for t in preferred:
        if t in tables:
            candidates.append(t)
    for t in tables:
        lt = t.lower()
        if t not in candidates and ("bar" in lt or "candle" in lt or "ohlcv" in lt):
            candidates.append(t)

    for table in candidates:
        cols = _column_map(con, table)
        sym = _pick(cols, SYMBOL_COLUMNS)
        ts = _pick(cols, TS_COLUMNS)
        op = _pick(cols, OPEN_COLUMNS)
        hi = _pick(cols, HIGH_COLUMNS)
        lo = _pick(cols, LOW_COLUMNS)
        cl = _pick(cols, CLOSE_COLUMNS)
        tf = _pick(cols, TIMEFRAME_COLUMNS)
        vol = _pick(cols, VOLUME_COLUMNS)
        if not all([sym, ts, op, hi, lo, cl]):
            continue
        where = f"{_quote_ident(sym)} = ?"
        params: list[Any] = [symbol]
        if tf:
            where += f" AND {_quote_ident(tf)} = ?"
            params.append(timeframe)
        try:
            row = con.execute(
                f"SELECT COUNT(*) AS n FROM (SELECT 1 FROM {_quote_ident(table)} WHERE {where} LIMIT 2)",
                params,
            ).fetchone()
            if row and int(row[0] or 0) > 0:
                return {
                    "table": table,
                    "symbol": sym or "",
                    "timeframe": tf or "",
                    "ts": ts or "",
                    "open": op or "",
                    "high": hi or "",
                    "low": lo or "",
                    "close": cl or "",
                    "volume": vol or "",
                }
        except Exception:
            continue
    return None


def _normalize_candle(row: sqlite3.Row, idx: int, ts_col: str, o_col: str, h_col: str, l_col: str, c_col: str, v_col: str | None) -> dict[str, Any]:
    def f(name: str, default: float = 0.0) -> float:
        try:
            return float(row[name])
        except Exception:
            return default

    o = f(o_col)
    h = f(h_col)
    l = f(l_col)
    c = f(c_col)
    volume = f(v_col, 0.0) if v_col else 0.0
    rng = max(h - l, 0.0)
    body = c - o
    midpoint = (h + l) / 2.0 if h or l else c
    return {
        "i": idx,
        "ts": str(row[ts_col]),
        "time": str(row[ts_col]),
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "volume": volume,
        "direction": "up" if c >= o else "down",
        "body": body,
        "range": rng,
        "midpoint": midpoint,
    }


def get_public_live_candles(symbol: str = "AAVE/USD", timeframe: str = "60m", limit: int = 96) -> dict[str, Any]:
    """Return public-safe OHLCV candles for the demo chart.

    The response intentionally omits database paths, table names, SQL, policy reasons,
    feature atoms, and broker/account identifiers. It is chart-only data.
    """
    symbol = _safe_symbol(symbol)
    timeframe = _safe_timeframe(timeframe)
    limit = _safe_int(limit, default=96, minimum=12, maximum=240)
    db_path = _resolve_bars_db_path()

    if not db_path.exists():
        return {
            "ok": False,
            "source": "live_runner_candles",
            "symbol": symbol,
            "timeframe": timeframe,
            "count": 0,
            "generated_at": _utc_now_iso(),
            "latest_ts": None,
            "candles": [],
        }

    try:
        con = _connect_readonly(db_path)
        meta = _detect_bars_table(con, symbol, timeframe)
        if not meta:
            con.close()
            return {
                "ok": False,
                "source": "live_runner_candles",
                "symbol": symbol,
                "timeframe": timeframe,
                "count": 0,
                "generated_at": _utc_now_iso(),
                "latest_ts": None,
                "candles": [],
            }

        table = meta["table"]
        sym_col = meta["symbol"]
        tf_col = meta["timeframe"]
        ts_col = meta["ts"]
        o_col = meta["open"]
        h_col = meta["high"]
        l_col = meta["low"]
        c_col = meta["close"]
        v_col = meta["volume"]

        select_cols = [ts_col, o_col, h_col, l_col, c_col]
        if v_col:
            select_cols.append(v_col)
        select_sql = ", ".join(_quote_ident(c) for c in select_cols)
        where = f"{_quote_ident(sym_col)} = ?"
        params: list[Any] = [symbol]
        if tf_col:
            where += f" AND {_quote_ident(tf_col)} = ?"
            params.append(timeframe)
        params.append(limit)
        rows = con.execute(
            f"""
            SELECT {select_sql}
            FROM {_quote_ident(table)}
            WHERE {where}
            ORDER BY {_quote_ident(ts_col)} DESC
            LIMIT ?
            """,
            params,
        ).fetchall()
        con.close()
        rows = list(reversed(rows))
        candles = [_normalize_candle(r, i, ts_col, o_col, h_col, l_col, c_col, v_col or None) for i, r in enumerate(rows)]
        latest = candles[-1]["ts"] if candles else None
        return {
            "ok": True,
            "source": "live_runner_candles",
            "symbol": symbol,
            "timeframe": timeframe,
            "count": len(candles),
            "generated_at": _utc_now_iso(),
            "latest_ts": latest,
            "candles": candles,
        }
    except Exception:
        return {
            "ok": False,
            "source": "live_runner_candles",
            "symbol": symbol,
            "timeframe": timeframe,
            "count": 0,
            "generated_at": _utc_now_iso(),
            "latest_ts": None,
            "candles": [],
        }


def _public_symbols_from_demo_db(limit: int = 12) -> list[str]:
    db_path = _resolve_demo_db_path()
    if not db_path.exists():
        return []
    try:
        con = _connect_readonly(db_path)
        rows = con.execute(
            """
            SELECT symbol
            FROM public_sig300_decisions
            ORDER BY approved DESC, symbol ASC
            LIMIT ?
            """,
            (_safe_int(limit, 12, 1, 50),),
        ).fetchall()
        con.close()
        return [_safe_symbol(r["symbol"]) for r in rows if r["symbol"]]
    except Exception:
        return []


def get_public_live_candle_board(symbols: str | None = None, timeframe: str = "60m", limit: int = 96) -> dict[str, Any]:
    timeframe = _safe_timeframe(timeframe)
    limit = _safe_int(limit, default=96, minimum=12, maximum=240)
    if symbols:
        symbol_list = [_safe_symbol(s) for s in str(symbols).split(",") if str(s).strip()]
    else:
        symbol_list = _public_symbols_from_demo_db(12)
    if not symbol_list:
        symbol_list = ["AAVE/USD", "BTC/USD", "ETH/USD", "SOL/USD"]
    symbol_list = symbol_list[:12]
    series = [get_public_live_candles(symbol=s, timeframe=timeframe, limit=limit) for s in symbol_list]
    return {
        "ok": any(item.get("ok") for item in series),
        "source": "live_runner_candle_board",
        "timeframe": timeframe,
        "count": len(series),
        "generated_at": _utc_now_iso(),
        "series": series,
    }
