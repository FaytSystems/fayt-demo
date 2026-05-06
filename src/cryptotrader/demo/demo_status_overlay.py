# D:\CryptoTrader\src\cryptotrader\demo\demo_status_overlay.py

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


DEFAULT_PUBLIC_DEMO_DB = r"D:\CryptoTrader\data\fayt_public_demo_live.db"
DEFAULT_STARTING_EQUITY = 1000.0


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _file_mtime_iso(path: Path) -> Optional[str]:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    except Exception:
        return None


def _get_demo_db_path() -> Path:
    raw = (
        os.environ.get("DEMO_DB_PATH")
        or os.environ.get("LIVE_DB_PATH")
        or os.environ.get("DB_PATH")
        or DEFAULT_PUBLIC_DEMO_DB
    )
    return Path(raw)


def _connect(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path.resolve().as_posix()}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=10.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA query_only = 1")
    con.execute("PRAGMA busy_timeout = 10000")
    return con


def _table_exists(con: sqlite3.Connection, table: str) -> bool:
    row = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def _columns(con: sqlite3.Connection, table: str) -> List[str]:
    if not _table_exists(con, table):
        return []

    rows = con.execute(f"PRAGMA table_info({table})").fetchall()
    return [str(row["name"]) for row in rows]


def _first_existing(columns: Iterable[str], candidates: Sequence[str]) -> Optional[str]:
    colset = {c.lower(): c for c in columns}

    for candidate in candidates:
        found = colset.get(candidate.lower())
        if found:
            return found

    return None


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default

        text = str(value).strip()
        if not text:
            return default

        return float(text)
    except Exception:
        return default


def _safe_text(value: Any) -> str:
    if value is None:
        return ""

    return str(value)


def _read_setting(con: sqlite3.Connection, key: str) -> Optional[str]:
    for table in ("public_demo_settings", "settings", "management_parameters"):
        if not _table_exists(con, table):
            continue

        cols = _columns(con, table)
        key_col = _first_existing(cols, ["key", "name", "parameter", "param_key"])
        value_col = _first_existing(cols, ["value", "param_value", "setting_value"])

        if not key_col or not value_col:
            continue

        row = con.execute(
            f"SELECT {value_col} AS value FROM {table} WHERE {key_col} = ? LIMIT 1",
            (key,),
        ).fetchone()

        if row is not None:
            return str(row["value"])

    return None


def _read_starting_equity(con: sqlite3.Connection) -> float:
    env_value = (
        os.environ.get("PUBLIC_DEMO_STARTING_BALANCE")
        or os.environ.get("DEMO_STARTING_BALANCE")
        or os.environ.get("PAPER_SIM_STARTING_CASH")
    )

    if env_value:
        parsed = _safe_float(env_value, 0.0)
        if parsed > 0:
            return parsed

    for key in (
        "public_demo_starting_balance",
        "demo_starting_balance",
        "paper_sim_starting_cash",
        "starting_equity",
    ):
        value = _read_setting(con, key)

        if value:
            parsed = _safe_float(value, 0.0)
            if parsed > 0:
                return parsed

    if _table_exists(con, "public_demo_account_profile"):
        cols = _columns(con, "public_demo_account_profile")
        if "starting_balance" in cols:
            row = con.execute(
                """
                SELECT starting_balance
                FROM public_demo_account_profile
                ORDER BY updated_at_ms DESC
                LIMIT 1
                """
            ).fetchone()

            if row is not None:
                parsed = _safe_float(row["starting_balance"], 0.0)
                if parsed > 0:
                    return parsed

    return DEFAULT_STARTING_EQUITY


def _get_trade_table(con: sqlite3.Connection) -> Optional[str]:
    preferred = [
        "trades",
        "paper_trades",
        "demo_trades",
        "simulated_trades",
    ]

    for table in preferred:
        if _table_exists(con, table):
            return table

    rows = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()

    for row in rows:
        name = str(row["name"])
        lowered = name.lower()

        if "trade" in lowered and "event" not in lowered and "sqlite_" not in lowered:
            return name

    return None


def _status_expr(status_col: Optional[str], open_value: bool) -> str:
    if not status_col:
        return "1 = 0" if open_value else "1 = 1"

    if open_value:
        return f"LOWER(COALESCE({status_col}, '')) IN ('open', 'opened', 'active', 'live')"

    return (
        f"LOWER(COALESCE({status_col}, '')) IN "
        "('closed', 'close', 'filled', 'exited', 'exit', 'done', 'complete', 'completed')"
    )


def _count_rows(con: sqlite3.Connection, table: str, where_expr: str) -> int:
    try:
        row = con.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE {where_expr}").fetchone()
        return int(row["n"] or 0)
    except Exception:
        return 0


def _sum_rows(con: sqlite3.Connection, table: str, column: Optional[str], where_expr: str) -> float:
    if not column:
        return 0.0

    try:
        row = con.execute(
            f"""
            SELECT COALESCE(SUM(COALESCE({column}, 0)), 0) AS total
            FROM {table}
            WHERE {where_expr}
            """
        ).fetchone()
        return _safe_float(row["total"], 0.0)
    except Exception:
        return 0.0


def _count_winners_losers(
    con: sqlite3.Connection,
    table: str,
    pnl_col: Optional[str],
    closed_expr: str,
) -> Tuple[int, int]:
    if not pnl_col:
        return 0, 0

    try:
        row = con.execute(
            f"""
            SELECT
                SUM(CASE WHEN COALESCE({pnl_col}, 0) > 0 THEN 1 ELSE 0 END) AS winners,
                SUM(CASE WHEN COALESCE({pnl_col}, 0) < 0 THEN 1 ELSE 0 END) AS losers
            FROM {table}
            WHERE {closed_expr}
            """
        ).fetchone()

        return int(row["winners"] or 0), int(row["losers"] or 0)
    except Exception:
        return 0, 0


def _estimate_open_unrealized_pnl(
    con: sqlite3.Connection,
    table: str,
    cols: Sequence[str],
    open_expr: str,
) -> float:
    side_col = _first_existing(cols, ["side", "direction"])
    qty_col = _first_existing(cols, ["qty", "quantity", "size"])
    entry_col = _first_existing(cols, ["entry_price", "entry"])
    current_col = _first_existing(cols, ["current_price", "mark_price", "last_price"])
    unrealized_col = _first_existing(cols, ["unrealized_pnl", "open_pnl", "floating_pnl", "mark_to_market_pnl"])

    if unrealized_col:
        return _sum_rows(con, table, unrealized_col, open_expr)

    if not qty_col or not entry_col or not current_col:
        return 0.0

    side_sql = f"LOWER(COALESCE({side_col}, ''))" if side_col else "''"

    try:
        row = con.execute(
            f"""
            SELECT COALESCE(SUM(
                CASE
                    WHEN {side_sql} IN ('sell', 'short') THEN
                        (COALESCE({entry_col}, 0) - COALESCE({current_col}, COALESCE({entry_col}, 0))) * COALESCE({qty_col}, 0)
                    ELSE
                        (COALESCE({current_col}, COALESCE({entry_col}, 0)) - COALESCE({entry_col}, 0)) * COALESCE({qty_col}, 0)
                END
            ), 0) AS total
            FROM {table}
            WHERE {open_expr}
            """
        ).fetchone()

        return _safe_float(row["total"], 0.0)
    except Exception:
        return 0.0


def _latest_value(
    con: sqlite3.Connection,
    table: str,
    columns: Sequence[str],
) -> Optional[str]:
    if not _table_exists(con, table):
        return None

    cols = _columns(con, table)
    ts_col = _first_existing(cols, columns)

    if not ts_col:
        return None

    try:
        row = con.execute(
            f"""
            SELECT {ts_col} AS ts
            FROM {table}
            WHERE {ts_col} IS NOT NULL
            ORDER BY {ts_col} DESC
            LIMIT 1
            """
        ).fetchone()

        if row is None:
            return None

        return _safe_text(row["ts"])
    except Exception:
        return None


def _latest_event_ts(con: sqlite3.Connection) -> Optional[str]:
    for table in ("runner_events", "trade_events", "demo_events", "events"):
        ts = _latest_value(
            con,
            table,
            [
                "created_at",
                "created_at_iso",
                "created_at_ms",
                "event_ts",
                "event_ts_ms",
                "ts",
                "ts_ms",
                "updated_at",
                "updated_at_ms",
            ],
        )

        if ts:
            return ts

    return None


def _build_status_from_db(db_path: Path) -> Dict[str, Any]:
    db_exists = db_path.exists()

    base: Dict[str, Any] = {
        "mode": "paper",
        "db_path": str(db_path),
        "db_exists": db_exists,
        "broker_name": os.environ.get("BROKER_NAME", "paper_sim"),
        "starting_equity": DEFAULT_STARTING_EQUITY,
        "open_trade_count": 0,
        "closed_trade_count": 0,
        "realized_pnl": 0.0,
        "unrealized_pnl": 0.0,
        "total_equity": DEFAULT_STARTING_EQUITY,
        "win_rate": 0.0,
        "winners": 0,
        "losers": 0,
        "last_trade_ts": None,
        "last_event_ts": None,
        "db_mtime": _file_mtime_iso(db_path),
        "account_name": "Fayt Public Demo - $1,000 Paper Account",
        "execution_mode": "simulated_paper_execution",
        "market_data_mode": "coinbase_advanced_live_market_data",
        "orders_allowed": False,
        "status_source": "public_demo_status_overlay",
        "updated_at": _utc_now_iso(),
    }

    if not db_exists:
        return base

    con = _connect(db_path)

    try:
        starting_equity = _read_starting_equity(con)

        trade_table = _get_trade_table(con)
        realized_pnl = 0.0
        unrealized_pnl = 0.0
        open_count = 0
        closed_count = 0
        winners = 0
        losers = 0
        last_trade_ts = None

        if trade_table:
            cols = _columns(con, trade_table)

            status_col = _first_existing(cols, ["status", "state", "trade_status"])
            realized_col = _first_existing(
                cols,
                [
                    "realized_pnl",
                    "net_pnl",
                    "pnl",
                    "profit_loss",
                    "closed_pnl",
                    "realized_profit",
                ],
            )

            open_expr = _status_expr(status_col, open_value=True)
            closed_expr = _status_expr(status_col, open_value=False)

            open_count = _count_rows(con, trade_table, open_expr)
            closed_count = _count_rows(con, trade_table, closed_expr)
            realized_pnl = _sum_rows(con, trade_table, realized_col, closed_expr)
            unrealized_pnl = _estimate_open_unrealized_pnl(con, trade_table, cols, open_expr)
            winners, losers = _count_winners_losers(con, trade_table, realized_col, closed_expr)

            last_trade_ts = _latest_value(
                con,
                trade_table,
                [
                    "closed_at",
                    "closed_at_iso",
                    "closed_at_ms",
                    "opened_at",
                    "opened_at_iso",
                    "opened_at_ms",
                    "created_at",
                    "created_at_iso",
                    "created_at_ms",
                    "updated_at",
                    "updated_at_ms",
                    "ts",
                    "ts_ms",
                ],
            )

        total_equity = starting_equity + realized_pnl + unrealized_pnl
        win_rate = round((winners / closed_count) * 100.0, 2) if closed_count > 0 else 0.0

        base.update(
            {
                "starting_equity": round(starting_equity, 6),
                "open_trade_count": open_count,
                "closed_trade_count": closed_count,
                "realized_pnl": round(realized_pnl, 6),
                "unrealized_pnl": round(unrealized_pnl, 6),
                "total_equity": round(total_equity, 6),
                "win_rate": win_rate,
                "winners": winners,
                "losers": losers,
                "last_trade_ts": last_trade_ts,
                "last_event_ts": _latest_event_ts(con),
                "db_mtime": _file_mtime_iso(db_path),
            }
        )

        account_name = _read_setting(con, "public_demo_account_name")
        if account_name:
            base["account_name"] = account_name

        return base
    finally:
        con.close()


def get_public_demo_status() -> Dict[str, Any]:
    return _build_status_from_db(_get_demo_db_path())


def install_demo_status_overlay(app: Any) -> None:
    """
    Removes the original GET /demo/status route and replaces it with a public-demo
    overlay that respects the $1,000 paper demo account profile.
    """
    kept_routes = []

    for route in list(app.router.routes):
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", set()) or set()

        if path == "/demo/status" and "GET" in methods:
            continue

        kept_routes.append(route)

    app.router.routes = kept_routes

    @app.get("/demo/status")
    def demo_status_overlay() -> Dict[str, Any]:
        return get_public_demo_status()

    app.state.public_demo_status_overlay_installed = True