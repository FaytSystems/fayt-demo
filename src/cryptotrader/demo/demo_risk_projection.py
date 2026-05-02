# D:\CryptoTrader\src\cryptotrader\demo\demo_risk_projection.py

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


DEFAULT_RISK_LEVELS = [1.25, 2.5, 5.0, 10.0, 25.0]
DEFAULT_ACCOUNT_SIZES = [1_000.0, 5_000.0, 10_000.0, 25_000.0, 100_000.0]


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


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


def safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default

    return str(value)


def normalize_side(value: Any) -> str:
    text = str(value or "").strip().lower()

    if text in {"buy", "long"}:
        return "long"

    if text in {"sell", "short"}:
        return "short"

    return text or "unknown"


def normalize_status(row: dict[str, Any]) -> str:
    raw = str(row.get("status") or "").strip().lower()
    closed_at = row.get("closed_at") or row.get("closed_ts")
    exit_price = row.get("exit_price") or row.get("exit")

    if raw in {"closed", "complete", "completed", "done", "exited"}:
        return "closed"

    if closed_at not in (None, "") or exit_price not in (None, ""):
        return "closed"

    return "open"


def parse_ts(value: Any) -> str | None:
    if value in (None, ""):
        return None

    if isinstance(value, (int, float)):
        epoch = float(value)

        if epoch > 1_000_000_000_000:
            epoch /= 1000.0

        return datetime.fromtimestamp(epoch, tz=UTC).isoformat()

    text = str(value).strip()

    if text.isdigit():
        epoch = float(text)

        if epoch > 1_000_000_000_000:
            epoch /= 1000.0

        return datetime.fromtimestamp(epoch, tz=UTC).isoformat()

    try:
        normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
        parsed = datetime.fromisoformat(normalized)

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)

        return parsed.astimezone(UTC).isoformat()

    except Exception:
        return text


class RiskProjectionEngine:
    """
    Read-only live risk projection engine.

    It reads the same paper-trader DB and projects the exact same trades across:

        account sizes:
            1000, 5000, 10000, 25000, 100000

        risk levels:
            1.25%, 2.50%, 5.00%, 10.00%, 25.00%

    It never writes to the DB.
    It never places trades.
    It never exposes controls.

    Closed trades:
        compounded sequentially by estimated R-multiple.

    Open trades:
        projected live using current_price / unrealized_pnl and recalculated
        every API/frontend refresh.
    """

    def __init__(
        self,
        db_path: str | Path,
        account_sizes: list[float] | None = None,
        risk_levels: list[float] | None = None,
        fallback_stop_pct: float = 0.01,
    ) -> None:
        self.db_path = Path(db_path)
        self.account_sizes = account_sizes or DEFAULT_ACCOUNT_SIZES
        self.risk_levels = risk_levels or DEFAULT_RISK_LEVELS
        self.fallback_stop_pct = float(fallback_stop_pct)

    def _connect_readonly(self) -> sqlite3.Connection:
        uri = f"file:{self.db_path.resolve().as_posix()}?mode=ro"
        con = sqlite3.connect(uri, uri=True, timeout=10.0)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA query_only = 1")
        con.execute("PRAGMA busy_timeout = 10000")
        return con

    def _table_exists(self, con: sqlite3.Connection, table_name: str) -> bool:
        row = con.execute(
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

    def _columns(self, con: sqlite3.Connection, table_name: str) -> set[str]:
        if not self._table_exists(con, table_name):
            return set()

        return {
            str(row["name"])
            for row in con.execute(f"PRAGMA table_info({table_name})").fetchall()
        }

    def _fetch_trades(self, limit: int) -> list[dict[str, Any]]:
        if not self.db_path.exists():
            return []

        with self._connect_readonly() as con:
            if not self._table_exists(con, "trades"):
                return []

            cols = self._columns(con, "trades")
            id_order = "id" if "id" in cols else "rowid"

            rows = con.execute(
                f"""
                SELECT *
                FROM trades
                ORDER BY COALESCE(opened_at, closed_at, '') ASC, {id_order} ASC
                LIMIT ?
                """,
                (int(limit),),
            ).fetchall()

        return [dict(row) for row in rows]

    def _trade_id(self, row: dict[str, Any]) -> str:
        for key in ("trade_id", "id", "client_order_id", "order_id"):
            if row.get(key) not in (None, ""):
                return str(row[key])

        return "unknown"

    def _base_trade(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "trade_id": self._trade_id(row),
            "symbol": safe_str(row.get("symbol") or row.get("product_id"), "unknown"),
            "side": normalize_side(row.get("side")),
            "status": normalize_status(row),
            "opened_at": parse_ts(row.get("opened_at") or row.get("created_at") or row.get("ts")),
            "closed_at": parse_ts(row.get("closed_at") or row.get("closed_ts")),
            "entry_price": safe_float(row.get("entry_price") or row.get("entry")),
            "current_price": safe_float(
                row.get("current_price") or row.get("mark_price") or row.get("last_price")
            ),
            "exit_price": safe_float(row.get("exit_price") or row.get("exit")),
            "original_qty": safe_float(row.get("qty") or row.get("quantity") or row.get("size"), 0.0),
            "original_realized_pnl": safe_float(
                row.get("realized_pnl") or row.get("pnl") or row.get("profit"),
                0.0,
            ),
            "original_unrealized_pnl": safe_float(row.get("unrealized_pnl"), 0.0),
            "stop_loss": safe_float(row.get("stop_loss")),
            "bucket_key": row.get("bucket_key"),
        }

    def _closed_r_multiple(self, trade: dict[str, Any]) -> tuple[float | None, str, str]:
        symbol = trade["symbol"]
        side = trade["side"]
        qty = float(trade["original_qty"] or 0.0)
        entry_price = trade["entry_price"]
        exit_price = trade["exit_price"]
        stop_loss = trade["stop_loss"]
        realized_pnl = trade["original_realized_pnl"]

        if realized_pnl is not None and entry_price is not None and stop_loss is not None and qty > 0:
            original_risk = abs(entry_price - stop_loss) * qty

            if original_risk > 0:
                return (
                    realized_pnl / original_risk,
                    "exact_stop_loss",
                    f"{symbol}: realized PnL / original stop-risk dollars.",
                )

        if entry_price is not None and exit_price is not None and entry_price > 0:
            direction = -1.0 if side == "short" else 1.0
            side_adjusted_return = ((exit_price - entry_price) / entry_price) * direction

            if self.fallback_stop_pct > 0:
                return (
                    side_adjusted_return / self.fallback_stop_pct,
                    "fallback_assumed_1pct_stop",
                    f"{symbol}: stop_loss missing; estimated R using {self.fallback_stop_pct * 100:.2f}% stop.",
                )

        if realized_pnl is not None and realized_pnl != 0:
            return (
                1.0 if realized_pnl > 0 else -1.0,
                "fallback_directional_result",
                f"{symbol}: insufficient stop/price data; treated result as +/-1R.",
            )

        return None, "skipped", f"{symbol}: insufficient data to compute closed R."

    def _open_r_multiple(self, trade: dict[str, Any]) -> tuple[float | None, str, str]:
        symbol = trade["symbol"]
        side = trade["side"]
        qty = float(trade["original_qty"] or 0.0)
        entry_price = trade["entry_price"]
        current_price = trade["current_price"]
        stop_loss = trade["stop_loss"]
        original_unrealized_pnl = trade["original_unrealized_pnl"]

        if original_unrealized_pnl is not None and entry_price is not None and stop_loss is not None and qty > 0:
            original_risk = abs(entry_price - stop_loss) * qty

            if original_risk > 0:
                return (
                    original_unrealized_pnl / original_risk,
                    "live_exact_stop_loss",
                    f"{symbol}: live unrealized PnL / original stop-risk dollars.",
                )

        if entry_price is not None and current_price is not None and entry_price > 0:
            direction = -1.0 if side == "short" else 1.0
            side_adjusted_return = ((current_price - entry_price) / entry_price) * direction

            if self.fallback_stop_pct > 0:
                return (
                    side_adjusted_return / self.fallback_stop_pct,
                    "live_fallback_assumed_1pct_stop",
                    f"{symbol}: live R estimated using {self.fallback_stop_pct * 100:.2f}% assumed stop.",
                )

        return None, "live_skipped", f"{symbol}: insufficient data to compute live open R."

    def _risk_key(self, risk_pct: float) -> str:
        return f"risk_{str(risk_pct).replace('.', '_')}pct"

    def _normalize_trades(self, rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
        closed: list[dict[str, Any]] = []
        open_live: list[dict[str, Any]] = []

        quality = {
            "closed_exact_count": 0,
            "closed_fallback_count": 0,
            "closed_skipped_count": 0,
            "open_exact_count": 0,
            "open_fallback_count": 0,
            "open_skipped_count": 0,
        }

        for row in rows:
            trade = self._base_trade(row)

            if trade["status"] == "closed":
                r_multiple, source, note = self._closed_r_multiple(trade)

                if r_multiple is None:
                    quality["closed_skipped_count"] += 1
                    continue

                if source == "exact_stop_loss":
                    quality["closed_exact_count"] += 1
                else:
                    quality["closed_fallback_count"] += 1

                trade["r_multiple"] = round(float(r_multiple), 6)
                trade["r_source"] = source
                trade["projection_note"] = note
                closed.append(trade)

            else:
                r_multiple, source, note = self._open_r_multiple(trade)

                if r_multiple is None:
                    quality["open_skipped_count"] += 1
                    continue

                if source == "live_exact_stop_loss":
                    quality["open_exact_count"] += 1
                else:
                    quality["open_fallback_count"] += 1

                trade["live_r_multiple"] = round(float(r_multiple), 6)
                trade["r_source"] = source
                trade["projection_note"] = note
                open_live.append(trade)

        return closed, open_live, quality

    def _build_scenario(
        self,
        *,
        account_size: float,
        risk_pct: float,
        closed_trades: list[dict[str, Any]],
        open_trades: list[dict[str, Any]],
        row_limit: int,
    ) -> dict[str, Any]:
        equity = float(account_size)
        peak_equity = equity
        max_drawdown_pct = 0.0
        wins = 0
        losses = 0
        best_trade = 0.0
        worst_trade = 0.0
        account_blown = False

        closed_rows: list[dict[str, Any]] = []

        for index, trade in enumerate(closed_trades, start=1):
            before_equity = max(equity, 0.0)
            risk_amount = before_equity * (risk_pct / 100.0)
            projected_pnl = risk_amount * float(trade["r_multiple"])
            after_equity_raw = before_equity + projected_pnl
            after_equity = max(after_equity_raw, 0.0)

            if projected_pnl > 0:
                wins += 1
            elif projected_pnl < 0:
                losses += 1

            best_trade = max(best_trade, projected_pnl)
            worst_trade = min(worst_trade, projected_pnl)

            peak_equity = max(peak_equity, after_equity)
            drawdown_pct = 0.0

            if peak_equity > 0:
                drawdown_pct = ((peak_equity - after_equity) / peak_equity) * 100.0

            max_drawdown_pct = max(max_drawdown_pct, drawdown_pct)

            if after_equity_raw <= 0:
                account_blown = True

            closed_rows.append(
                {
                    "n": index,
                    "trade_id": trade["trade_id"],
                    "symbol": trade["symbol"],
                    "side": trade["side"],
                    "closed_at": trade["closed_at"],
                    "bucket_key": trade["bucket_key"],
                    "r_multiple": trade["r_multiple"],
                    "r_source": trade["r_source"],
                    "before_equity": round(before_equity, 2),
                    "risk_amount": round(risk_amount, 2),
                    "projected_pnl": round(projected_pnl, 2),
                    "after_equity": round(after_equity, 2),
                    "drawdown_pct": round(drawdown_pct, 2),
                }
            )

            equity = after_equity

            if account_blown:
                break

        live_unrealized_pnl = 0.0
        open_rows: list[dict[str, Any]] = []

        for index, trade in enumerate(open_trades, start=1):
            live_r = float(trade["live_r_multiple"])
            live_risk_amount = max(equity, 0.0) * (risk_pct / 100.0)
            live_projected_pnl = live_risk_amount * live_r
            live_unrealized_pnl += live_projected_pnl

            open_rows.append(
                {
                    "n": index,
                    "trade_id": trade["trade_id"],
                    "symbol": trade["symbol"],
                    "side": trade["side"],
                    "opened_at": trade["opened_at"],
                    "entry_price": trade["entry_price"],
                    "current_price": trade["current_price"],
                    "bucket_key": trade["bucket_key"],
                    "live_r_multiple": trade["live_r_multiple"],
                    "r_source": trade["r_source"],
                    "risk_amount": round(live_risk_amount, 2),
                    "live_projected_pnl": round(live_projected_pnl, 2),
                }
            )

        closed_pnl = equity - account_size
        live_equity = equity + live_unrealized_pnl
        total_live_pnl = live_equity - account_size

        summary = {
            "account_size": round(account_size, 2),
            "risk_pct": risk_pct,
            "risk_key": self._risk_key(risk_pct),
            "starting_equity": round(account_size, 2),
            "closed_equity": round(equity, 2),
            "live_equity": round(live_equity, 2),
            "closed_pnl": round(closed_pnl, 2),
            "live_unrealized_pnl": round(live_unrealized_pnl, 2),
            "total_live_pnl": round(total_live_pnl, 2),
            "closed_return_pct": round((closed_pnl / account_size) * 100.0, 2) if account_size else 0.0,
            "live_return_pct": round((total_live_pnl / account_size) * 100.0, 2) if account_size else 0.0,
            "max_drawdown_pct": round(max_drawdown_pct, 2),
            "wins": wins,
            "losses": losses,
            "win_rate": round((wins / max(wins + losses, 1)) * 100.0, 2),
            "best_trade": round(best_trade, 2),
            "worst_trade": round(worst_trade, 2),
            "closed_trades_used": len(closed_rows),
            "open_trades_used": len(open_rows),
            "account_blown": account_blown,
        }

        return {
            "risk_pct": risk_pct,
            "risk_key": self._risk_key(risk_pct),
            "summary": summary,
            "closed_rows": closed_rows[-row_limit:],
            "open_rows": open_rows,
        }

    def build_projection(
        self,
        trade_limit: int = 10_000,
        row_limit: int = 50,
    ) -> dict[str, Any]:
        rows = self._fetch_trades(limit=trade_limit)
        closed_trades, open_trades, quality = self._normalize_trades(rows)

        accounts: list[dict[str, Any]] = []

        for account_size in self.account_sizes:
            scenarios = [
                self._build_scenario(
                    account_size=float(account_size),
                    risk_pct=float(risk_pct),
                    closed_trades=closed_trades,
                    open_trades=open_trades,
                    row_limit=row_limit,
                )
                for risk_pct in self.risk_levels
            ]

            accounts.append(
                {
                    "account_size": round(float(account_size), 2),
                    "scenarios": scenarios,
                }
            )

        overview: list[dict[str, Any]] = []

        for account in accounts:
            for scenario in account["scenarios"]:
                overview.append(scenario["summary"])

        return {
            "generated_at": utc_now_iso(),
            "db_path": str(self.db_path),
            "risk_levels": self.risk_levels,
            "account_sizes": [round(float(value), 2) for value in self.account_sizes],
            "accounts": accounts,
            "overview": overview,
            "meta": {
                "trade_rows_seen": len(rows),
                "closed_trades_projected": len(closed_trades),
                "open_trades_projected": len(open_trades),
                "fallback_stop_pct": self.fallback_stop_pct,
                **quality,
                "disclaimer": (
                    "Read-only hypothetical projection. This does not place trades. "
                    "Projected PnL is derived from the same paper-trader DB and does not guarantee future results."
                ),
            },
        }