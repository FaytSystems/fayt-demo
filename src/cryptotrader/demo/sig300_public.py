# D:\CryptoTrader\src\cryptotrader\demo\sig300_public.py
"""
Public-safe SIG300 live-runner demo helpers.

This module intentionally exposes only sanitized pass/fail rows:
    symbol, approved, denied

It must not expose policy reasons, feature atoms, raw feature values, db paths,
policy scores, targets/stops, or internal candidate JSON.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_AUDIT_DB = Path(r"D:\CryptoTrader\data\w_master_300_live_signal_policy_audit_v1.db")
DEFAULT_DEMO_DB = Path(r"D:\CryptoTrader\data\fayt_public_demo_live.db")

PUBLIC_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS public_sig300_decisions (
    symbol TEXT PRIMARY KEY,
    approved INTEGER NOT NULL DEFAULT 0,
    denied INTEGER NOT NULL DEFAULT 0,
    updated_utc TEXT NOT NULL
)
"""


def _env_path(*names: str, default: Path) -> Path:
    for name in names:
        value = os.getenv(name)
        if value:
            return Path(value)
    return default


def resolve_demo_db_path(db_path: str | os.PathLike[str] | None = None) -> Path:
    if db_path:
        return Path(db_path)
    return _env_path("PUBLIC_DEMO_DB_PATH", "DEMO_DB_PATH", "LIVE_DB_PATH", "DB_PATH", default=DEFAULT_DEMO_DB)


def resolve_audit_db_path() -> Path:
    return _env_path("W_MASTER_300_AUDIT_DB", "SIG300_AUDIT_DB", default=DEFAULT_AUDIT_DB)


def _connect_readonly(path: Path) -> sqlite3.Connection:
    uri = f"file:{path.resolve().as_posix()}?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA query_only = 1")
    return con


def ensure_public_sig300_table(demo_db_path: str | os.PathLike[str] | None = None) -> None:
    demo_db = resolve_demo_db_path(demo_db_path)
    demo_db.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(demo_db), timeout=30)
    try:
        con.execute(PUBLIC_TABLE_SQL)
        con.commit()
    finally:
        con.close()


def sync_public_sig300_decisions(
    *,
    audit_db_path: str | os.PathLike[str] | None = None,
    demo_db_path: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    """Mirror private SIG300 audit rows into the public demo DB.

    The public mirror is sanitized. It contains only symbol/approved/denied.
    """
    audit_db = Path(audit_db_path) if audit_db_path else resolve_audit_db_path()
    demo_db = resolve_demo_db_path(demo_db_path)

    demo_db.parent.mkdir(parents=True, exist_ok=True)

    if not audit_db.exists():
        ensure_public_sig300_table(demo_db)
        return {"ok": False, "rows_synced": 0, "error": f"audit db missing: {audit_db}"}

    try:
        src = _connect_readonly(audit_db)
        rows = list(src.execute("""
            WITH latest AS (
                SELECT
                    symbol,
                    approved,
                    ROW_NUMBER() OVER (
                        PARTITION BY symbol
                        ORDER BY id DESC
                    ) AS rn
                FROM runtime_sig300_runner_hook_events
            )
            SELECT
                symbol,
                CASE WHEN approved = 1 THEN 1 ELSE 0 END AS approved,
                CASE WHEN approved = 0 THEN 1 ELSE 0 END AS denied
            FROM latest
            WHERE rn = 1
            ORDER BY symbol
        """))
        src.close()
    except Exception as exc:
        ensure_public_sig300_table(demo_db)
        return {"ok": False, "rows_synced": 0, "error": f"audit read failed: {exc}"}

    dst = sqlite3.connect(str(demo_db), timeout=30)
    try:
        dst.execute(PUBLIC_TABLE_SQL)
        now = datetime.now(timezone.utc).isoformat()
        for r in rows:
            dst.execute(
                """
                INSERT INTO public_sig300_decisions(symbol, approved, denied, updated_utc)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    approved=excluded.approved,
                    denied=excluded.denied,
                    updated_utc=excluded.updated_utc
                """,
                (str(r["symbol"]), int(r["approved"]), int(r["denied"]), now),
            )
        dst.commit()
    finally:
        dst.close()

    return {"ok": True, "rows_synced": len(rows), "demo_db_path": str(demo_db), "audit_db_path": str(audit_db)}


def get_public_sig300_decisions(db_path: str | os.PathLike[str] | None = None) -> list[dict[str, Any]]:
    """Return public-safe SIG300 rows from the demo DB."""
    demo_db = resolve_demo_db_path(db_path)
    if not demo_db.exists():
        return []

    try:
        con = _connect_readonly(demo_db)
        rows = list(con.execute("""
            SELECT symbol, approved, denied
            FROM public_sig300_decisions
            ORDER BY symbol
        """))
        con.close()
    except Exception:
        return []

    return [
        {
            "symbol": str(r["symbol"]),
            "approved": bool(int(r["approved"])),
            "denied": bool(int(r["denied"])),
        }
        for r in rows
    ]


def public_sig300_summary(db_path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    rows = get_public_sig300_decisions(db_path)
    return {
        "ok": True,
        "source": "live_runner_sig300_public_mirror",
        "count": len(rows),
        "approved_count": sum(1 for r in rows if r["approved"]),
        "denied_count": sum(1 for r in rows if r["denied"]),
        "decisions": rows,
    }
