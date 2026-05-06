# D:\CryptoTrader\src\cryptotrader\demo\demo_api.py

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from cryptotrader.demo.demo_repo import DemoRepo
from cryptotrader.demo.demo_risk_projection import RiskProjectionEngine
from cryptotrader.demo.demo_status_overlay import (
    get_public_demo_status,
    install_demo_status_overlay,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_demo_db_path() -> str:
    return (
        os.getenv("DEMO_DB_PATH")
        or os.getenv("LIVE_DB_PATH")
        or os.getenv("DB_PATH")
        or r"D:\CryptoTrader\data\fayt_public_demo_live.db"
    )


repo = DemoRepo(_resolve_demo_db_path())

app = FastAPI(
    title="Fayt Systems Demo API",
    version="2.1.0",
    description="Read-only public demo API for FaytSystems boardroom dashboard telemetry.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "HEAD", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def read_only_guard(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        return JSONResponse(
            status_code=405,
            content={"detail": "Read-only demo API. Only GET/HEAD/OPTIONS are allowed."},
        )

    return await call_next(request)


def _snapshot() -> dict[str, Any]:
    snapshot = repo.get_snapshot()
    snapshot["generated_at"] = _utc_now_iso()
    snapshot["status"] = get_public_demo_status()

    if "market_board" not in snapshot or snapshot["market_board"] is None:
        snapshot["market_board"] = repo.get_market_board(limit=60)

    return snapshot


def _fallback_risk_projection() -> dict[str, Any]:
    status = get_public_demo_status()
    risk_levels = [1.25, 2.5, 5.0, 10.0, 25.0]
    account_sizes = [1000, 5000, 10000, 25000, 100000]
    open_count = max(int(status.get("open_trade_count", 0)), 1)

    accounts = []

    for account_size in account_sizes:
        scenarios = []

        for risk_pct in risk_levels:
            risk_dollars = float(account_size) * (float(risk_pct) / 100.0)

            scenarios.append(
                {
                    "risk_pct": risk_pct,
                    "risk_key": f"risk_{str(risk_pct).replace('.', '_')}pct",
                    "summary": {
                        "account_size": account_size,
                        "risk_pct": risk_pct,
                        "starting_equity": account_size,
                        "closed_equity": account_size,
                        "live_equity": account_size,
                        "closed_pnl": 0.0,
                        "live_unrealized_pnl": 0.0,
                        "total_live_pnl": 0.0,
                        "closed_return_pct": 0.0,
                        "live_return_pct": 0.0,
                        "max_drawdown_pct": 0.0,
                        "wins": int(status.get("winners", 0)),
                        "losses": int(status.get("losers", 0)),
                        "win_rate": float(status.get("win_rate", 0.0)),
                        "best_trade": 0.0,
                        "worst_trade": 0.0,
                        "closed_trades_used": int(status.get("closed_trade_count", 0)),
                        "open_trades_used": int(status.get("open_trade_count", 0)),
                        "risk_dollars": round(risk_dollars, 2),
                        "per_open_trade_risk": round(risk_dollars / open_count, 2),
                        "account_blown": False,
                    },
                    "closed_rows": [],
                    "open_rows": [],
                }
            )

        accounts.append(
            {
                "account_size": account_size,
                "scenarios": scenarios,
            }
        )

    return {
        "generated_at": _utc_now_iso(),
        "db_path": repo.db_path,
        "risk_levels": risk_levels,
        "account_sizes": account_sizes,
        "accounts": accounts,
        "overview": [scenario["summary"] for account in accounts for scenario in account["scenarios"]],
        "meta": {
            "trade_rows_seen": 0,
            "closed_trades_projected": int(status.get("closed_trade_count", 0)),
            "open_trades_projected": int(status.get("open_trade_count", 0)),
            "fallback": True,
            "disclaimer": (
                "Read-only hypothetical projection. This does not place trades. "
                "Projected PnL does not guarantee future results."
            ),
        },
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    status = get_public_demo_status()

    return {
        "ok": True,
        "db_path": repo.db_path,
        "db_exists": status["db_exists"],
        "mode": status["mode"],
        "broker_name": status["broker_name"],
        "orders_allowed": False,
    }


@app.get("/demo/status")
async def demo_status() -> dict[str, Any]:
    return get_public_demo_status()


@app.get("/demo/open-trades")
async def demo_open_trades(limit: int = 25) -> list[dict[str, Any]]:
    return repo.get_open_trades(limit=limit)


@app.get("/demo/closed-trades")
async def demo_closed_trades(limit: int = 100) -> list[dict[str, Any]]:
    return repo.get_closed_trades(limit=limit)


@app.get("/demo/equity")
async def demo_equity(limit: int = 240) -> list[dict[str, Any]]:
    return repo.get_equity(limit=limit)


@app.get("/demo/events")
async def demo_events(limit: int = 100) -> list[dict[str, Any]]:
    return repo.get_events(limit=limit)


@app.get("/demo/market-board")
async def demo_market_board(timeframe: str = "1m", limit: int = 60) -> dict[str, Any]:
    return repo.get_market_board(timeframe=timeframe, limit=limit)


@app.get("/demo/risk-projection")
async def demo_risk_projection(trade_limit: int = 10_000, row_limit: int = 50) -> dict[str, Any]:
    try:
        return RiskProjectionEngine(repo.db_path).build_projection(
            trade_limit=trade_limit,
            row_limit=row_limit,
        )
    except Exception as exc:
        projection = _fallback_risk_projection()
        projection["meta"]["fallback_reason"] = str(exc)
        return projection


@app.get("/demo/snapshot")
async def demo_snapshot() -> dict[str, Any]:
    return _snapshot()


@app.websocket("/demo/ws")
async def demo_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        while True:
            await websocket.send_json(
                {
                    "type": "snapshot",
                    "data": _snapshot(),
                }
            )
            await asyncio.sleep(2.0)
    except WebSocketDisconnect:
        return


install_demo_status_overlay(app)