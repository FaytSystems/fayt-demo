# D:\CryptoTrader\src\cryptotrader\demo\demo_api.py

from __future__ import annotations

import asyncio
import json
import os
from functools import lru_cache
from typing import Any, Callable

from fastapi import FastAPI, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .demo_models import (
    DemoEquityPoint,
    DemoEvent,
    DemoSnapshot,
    DemoStatus,
    DemoTrade,
    DemoWsMessage,
)
from .demo_repo import DemoRepo
from .demo_risk_projection import RiskProjectionEngine


def _env_bool(key: str, default: bool = False) -> bool:
    raw = os.getenv(key)

    if raw is None:
        return default

    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _split_origins(value: str | None) -> list[str]:
    if value is None or not value.strip():
        return ["http://127.0.0.1:5173", "http://localhost:5173"]

    if value.strip() == "*":
        return ["*"]

    return [item.strip() for item in value.split(",") if item.strip()]


def _parse_float_list(raw: str | None, default: list[float]) -> list[float]:
    if raw is None or not raw.strip():
        return default

    values: list[float] = []

    for item in raw.replace(";", ",").split(","):
        try:
            values.append(float(item.strip()))
        except Exception:
            continue

    return values or default


@lru_cache(maxsize=1)
def get_repo() -> DemoRepo:
    return DemoRepo(
        db_path=os.getenv(
            "DEMO_DB_PATH",
            r"D:\CryptoTrader\data\cryptotrader.db",
        ),
        starting_equity=float(os.getenv("DEMO_STARTING_EQUITY", "30000")),
        broker_name=os.getenv("DEMO_BROKER_NAME", "paper_sim"),
    )


def get_risk_projection_engine() -> RiskProjectionEngine:
    repo = get_repo()

    return RiskProjectionEngine(
        db_path=repo.db_path,
        account_sizes=_parse_float_list(
            os.getenv("DEMO_PROJECTION_ACCOUNT_SIZES"),
            [1000.0, 5000.0, 10000.0, 25000.0, 100000.0],
        ),
        risk_levels=_parse_float_list(
            os.getenv("DEMO_PROJECTION_RISK_LEVELS"),
            [1.25, 2.5, 5.0, 10.0, 25.0],
        ),
        fallback_stop_pct=float(os.getenv("DEMO_PROJECTION_FALLBACK_STOP_PCT", "0.01")),
    )


DOCS_ENABLED = _env_bool("DEMO_ENABLE_DOCS", False)

app = FastAPI(
    title="Fayt Systems Public Demo API",
    version="1.1.0",
    docs_url="/docs" if DOCS_ENABLED else None,
    redoc_url="/redoc" if DOCS_ENABLED else None,
    openapi_url="/openapi.json" if DOCS_ENABLED else None,
)

origins = _split_origins(os.getenv("DEMO_ALLOWED_ORIGINS"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def read_only_guard(request: Request, call_next: Callable):
    if request.method.upper() not in {"GET", "HEAD", "OPTIONS"}:
        return JSONResponse(
            status_code=405,
            content={
                "ok": False,
                "error": "read_only_demo_api",
                "message": "This public demo API only allows GET, HEAD, and OPTIONS.",
            },
        )

    response = await call_next(request)

    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"

    return response


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


@app.get("/health")
def health(response: Response) -> dict[str, object]:
    _no_store(response)

    repo = get_repo()

    return {
        "status": "ok" if repo.db_exists() else "degraded",
        "mode": "read_only_demo",
        "db_exists": repo.db_exists(),
        "db_path": str(repo.db_path),
    }


@app.get("/demo/status", response_model=DemoStatus)
def demo_status(response: Response) -> DemoStatus:
    _no_store(response)
    return get_repo().get_status()


@app.get("/demo/open-trades", response_model=list[DemoTrade])
def demo_open_trades(
    response: Response,
    limit: int = Query(default=25, ge=1, le=250),
) -> list[DemoTrade]:
    _no_store(response)
    return get_repo().get_open_trades(limit=limit)


@app.get("/demo/closed-trades", response_model=list[DemoTrade])
def demo_closed_trades(
    response: Response,
    limit: int = Query(default=50, ge=1, le=500),
) -> list[DemoTrade]:
    _no_store(response)
    return get_repo().get_closed_trades(limit=limit)


@app.get("/demo/equity", response_model=list[DemoEquityPoint])
def demo_equity(
    response: Response,
    limit: int = Query(default=250, ge=1, le=5000),
) -> list[DemoEquityPoint]:
    _no_store(response)
    return get_repo().get_equity(limit=limit)


@app.get("/demo/events", response_model=list[DemoEvent])
def demo_events(
    response: Response,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[DemoEvent]:
    _no_store(response)
    return get_repo().get_events(limit=limit)


@app.get("/demo/snapshot", response_model=DemoSnapshot)
def demo_snapshot(
    response: Response,
    open_trade_limit: int = Query(default=25, ge=1, le=250),
    closed_trade_limit: int = Query(default=50, ge=1, le=500),
    event_limit: int = Query(default=100, ge=1, le=500),
    equity_limit: int = Query(default=250, ge=1, le=5000),
) -> DemoSnapshot:
    _no_store(response)

    return get_repo().get_snapshot(
        open_trade_limit=open_trade_limit,
        closed_trade_limit=closed_trade_limit,
        event_limit=event_limit,
        equity_limit=equity_limit,
    )


@app.get("/demo/risk-projection")
def demo_risk_projection(
    response: Response,
    trade_limit: int = Query(default=10_000, ge=1, le=100_000),
    row_limit: int = Query(default=50, ge=1, le=500),
) -> dict[str, Any]:
    _no_store(response)

    return get_risk_projection_engine().build_projection(
        trade_limit=trade_limit,
        row_limit=row_limit,
    )


@app.websocket("/demo/ws")
async def demo_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    push_seconds = float(os.getenv("DEMO_WS_PUSH_SECONDS", "2.0"))
    push_seconds = max(0.5, min(push_seconds, 30.0))

    last_serialized: str | None = None

    try:
        while True:
            snapshot = get_repo().get_snapshot(
                open_trade_limit=25,
                closed_trade_limit=50,
                event_limit=100,
                equity_limit=250,
            )

            envelope = DemoWsMessage(type="snapshot", data=snapshot).model_dump(mode="json")
            serialized = json.dumps(envelope, separators=(",", ":"), sort_keys=True)

            if serialized != last_serialized:
                await websocket.send_text(serialized)
                last_serialized = serialized

            await asyncio.sleep(push_seconds)

    except WebSocketDisconnect:
        return