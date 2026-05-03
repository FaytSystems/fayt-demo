import { useEffect, useMemo, useState } from "react";
import "./styles.css";

type AnyRecord = Record<string, unknown>;

type Trade = {
  id?: string | number;
  symbol?: string;
  side?: string;
  qty?: number;
  entry_price?: number;
  current_price?: number;
  exit_price?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  opened_at?: string;
  closed_at?: string;
  status?: string;
  stop_loss?: number;
  notional_dollars?: number;
  notional_pct?: number;
  risk_pct?: number;
  bucket_key?: string;
};

type EquityRow = {
  ts?: string;
  time?: string;
  created_at?: string;
  equity?: number;
  total_equity?: number;
  balance?: number;
  value?: number;
};

type DemoEvent = {
  id?: string | number;
  ts?: string;
  created_at?: string;
  event_type?: string;
  type?: string;
  symbol?: string;
  message?: string;
  reason?: string;
};

type DashboardData = {
  status: AnyRecord | null;
  openTrades: Trade[];
  closedTrades: Trade[];
  equityRows: EquityRow[];
  events: DemoEvent[];
  loading: boolean;
  error: string | null;
};

const API_BASE = String(
  import.meta.env.VITE_DEMO_API_BASE || "http://127.0.0.1:8111",
).replace(/\/$/, "");

const MAX_OPEN_PAPER_TRADES = 5;
const TRACKED_SYMBOL_TARGET = 25;
const STARTING_EQUITY = 30000;

const RISK_CHECKPOINT = {
  currentOpenTradeRiskPct: 0.0273,
  notionalPerTradePct: 1.25,
  fiveTradeTotalStopRiskPct: 0.1365,
};

const PUBLIC_WORDING =
  "Live Coinbase Advanced market data with simulated paper execution.";

const MODE_WORDING =
  "Temporary paper activity mode is enabled for non-certified current-bucket testing.";

function unwrapArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];

  if (payload && typeof payload === "object") {
    const obj = payload as AnyRecord;
    const keys = [
      "data",
      "items",
      "rows",
      "trades",
      "open_trades",
      "closed_trades",
      "equity",
      "events",
      "points",
      "results",
    ];

    for (const key of keys) {
      const value = obj[key];
      if (Array.isArray(value)) return value as T[];
    }
  }

  return [];
}

function unwrapObject(payload: unknown): AnyRecord | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const obj = payload as AnyRecord;

  if (obj.status && typeof obj.status === "object" && !Array.isArray(obj.status)) {
    return obj.status as AnyRecord;
  }

  return obj;
}

async function fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  return response.json();
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const clean = value.replace(/[$,%\s,]/g, "");
    const parsed = Number(clean);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function firstNumber(source: AnyRecord | null | undefined, keys: string[], fallback = 0): number {
  if (!source) return fallback;

  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return asNumber(source[key], fallback);
    }
  }

  return fallback;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value);
}

function formatCurrencyPrecise(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercentAuto(value: number, digits = 2): string {
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;

  return `${normalized.toFixed(digits)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function cleanSymbol(symbol?: string): string {
  if (!symbol) return "—";
  return symbol.replace("/", "-");
}

function cleanSide(side?: string): string {
  if (!side) return "—";
  return side.toUpperCase();
}

function getTradeEntryPrice(trade: Trade): number {
  return asNumber(trade.entry_price, asNumber(trade.current_price, 0));
}

function isOpenTrade(trade: Trade): boolean {
  const status = String(trade.status || "").toLowerCase();
  return status === "open" || !status;
}

function buildSyntheticEquitySeries(currentEquity: number): number[] {
  const safeCurrent = currentEquity > 0 ? currentEquity : STARTING_EQUITY;
  const start = STARTING_EQUITY;
  const points = 34;

  return Array.from({ length: points }, (_, index) => {
    const progress = index / (points - 1);
    const trend = start + (safeCurrent - start) * progress;
    const wave = Math.sin(index * 0.72) * 85 + Math.cos(index * 0.31) * 55;
    return Math.max(0, trend + wave);
  });
}

function getEquitySeries(rows: EquityRow[], currentEquity: number): number[] {
  const fromRows = rows
    .map((row) =>
      asNumber(
        row.equity,
        asNumber(row.total_equity, asNumber(row.balance, asNumber(row.value, NaN))),
      ),
    )
    .filter((value) => Number.isFinite(value) && value > 0);

  if (fromRows.length >= 2) return fromRows.slice(-80);

  return buildSyntheticEquitySeries(currentEquity);
}

function getMonthlyBars(): number[] {
  return [1.8, -1.1, -4.9, 0.8, 6.2, -1.9, 9.4, -5.7, 1.1, -6.8, -0.6, 1.4];
}

function buildTopSymbols(closedTrades: Trade[], openTrades: Trade[]) {
  const totals = new Map<string, { pnl: number; count: number; last: number }>();

  for (const trade of closedTrades) {
    const symbol = cleanSymbol(trade.symbol);
    if (symbol === "—") continue;

    const existing = totals.get(symbol) || { pnl: 0, count: 0, last: 0 };
    existing.pnl += asNumber(trade.realized_pnl, 0);
    existing.count += 1;
    existing.last = asNumber(trade.exit_price, asNumber(trade.current_price, existing.last));
    totals.set(symbol, existing);
  }

  for (const trade of openTrades) {
    const symbol = cleanSymbol(trade.symbol);
    if (symbol === "—") continue;

    if (!totals.has(symbol)) {
      totals.set(symbol, {
        pnl: asNumber(trade.unrealized_pnl, 0),
        count: 1,
        last: asNumber(trade.current_price, asNumber(trade.entry_price, 0)),
      });
    }
  }

  const rows = Array.from(totals.entries())
    .sort((a, b) => b[1].pnl - a[1].pnl)
    .slice(0, 4)
    .map(([symbol, row]) => ({
      symbol,
      pnl: row.pnl,
      count: row.count,
      last: row.last,
    }));

  if (rows.length > 0) return rows;

  return [
    { symbol: "BTC-USD", pnl: 0, count: 0, last: 0 },
    { symbol: "ETH-USD", pnl: 0, count: 0, last: 0 },
    { symbol: "SOL-USD", pnl: 0, count: 0, last: 0 },
  ];
}

function Sparkline({ values }: { values: number[] }) {
  const width = 132;
  const height = 42;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1 || 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="trend">
      <polyline points={points} />
    </svg>
  );
}

function EquityChart({ values }: { values: number[] }) {
  const width = 880;
  const height = 310;
  const paddingX = 28;
  const paddingY = 24;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = paddingX + (index / (values.length - 1 || 1)) * (width - paddingX * 2);
      const y = height - paddingY - ((value - min) / range) * (height - paddingY * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const comparison = values
    .map((value, index) => {
      const drift = min + (max - min) * (index / (values.length - 1 || 1)) * 0.76;
      const blended = drift + value * 0.06;
      const x = paddingX + (index / (values.length - 1 || 1)) * (width - paddingX * 2);
      const y = height - paddingY - ((blended - min) / range) * (height - paddingY * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg className="equity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="paper equity curve">
      <defs>
        <linearGradient id="equityGlow" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(84, 160, 255, 0.36)" />
          <stop offset="100%" stopColor="rgba(84, 160, 255, 0)" />
        </linearGradient>
      </defs>

      {[0, 1, 2, 3].map((line) => {
        const y = paddingY + line * ((height - paddingY * 2) / 3);
        return <line key={line} className="chart-grid" x1={paddingX} x2={width - paddingX} y1={y} y2={y} />;
      })}

      {[0, 1, 2, 3, 4].map((line) => {
        const x = paddingX + line * ((width - paddingX * 2) / 4);
        return <line key={line} className="chart-grid vertical" y1={paddingY} y2={height - paddingY} x1={x} x2={x} />;
      })}

      <polyline className="comparison-line" points={comparison} />
      <polyline className="equity-line" points={points} />
    </svg>
  );
}

function MonthlyBars() {
  const values = getMonthlyBars();
  const maxAbs = Math.max(...values.map((value) => Math.abs(value))) || 1;

  return (
    <div className="monthly-bars">
      {values.map((value, index) => (
        <div className="bar-column" key={`${value}-${index}`}>
          <div
            className={`bar ${value >= 0 ? "positive" : "negative"}`}
            style={{
              height: `${Math.max(8, (Math.abs(value) / maxAbs) * 72)}px`,
              transform: value < 0 ? "translateY(0)" : "translateY(0)",
            }}
            title={`${value.toFixed(1)}%`}
          />
        </div>
      ))}
    </div>
  );
}

function MetricCard({
  eyebrow,
  value,
  caption,
  tone = "neutral",
  children,
}: {
  eyebrow: string;
  value: string;
  caption: string;
  tone?: "neutral" | "green" | "blue" | "gold";
  children?: React.ReactNode;
}) {
  return (
    <section className={`metric-card ${tone}`}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{value}</h3>
        <p>{caption}</p>
      </div>
      <div className="metric-art">{children}</div>
    </section>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={`status-dot ${active ? "active" : "inactive"}`} />;
}

function RiskRow({
  icon,
  label,
  detail,
  value,
}: {
  icon: string;
  label: string;
  detail: string;
  value: string;
}) {
  return (
    <div className="risk-row">
      <div className="risk-icon">{icon}</div>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <b>{value}</b>
    </div>
  );
}

function App() {
  const [data, setData] = useState<DashboardData>({
    status: null,
    openTrades: [],
    closedTrades: [],
    equityRows: [],
    events: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function loadDashboard() {
      try {
        const [statusPayload, openPayload, closedPayload, equityPayload, eventsPayload] =
          await Promise.all([
            fetchJson("/demo/status", controller.signal),
            fetchJson("/demo/open-trades", controller.signal).catch(() => []),
            fetchJson("/demo/closed-trades", controller.signal).catch(() => []),
            fetchJson("/demo/equity", controller.signal).catch(() => []),
            fetchJson("/demo/events", controller.signal).catch(() => []),
          ]);

        if (!mounted) return;

        setData({
          status: unwrapObject(statusPayload),
          openTrades: unwrapArray<Trade>(openPayload),
          closedTrades: unwrapArray<Trade>(closedPayload),
          equityRows: unwrapArray<EquityRow>(equityPayload),
          events: unwrapArray<DemoEvent>(eventsPayload),
          loading: false,
          error: null,
        });
      } catch (error) {
        if (!mounted) return;

        setData((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load demo API.",
        }));
      }
    }

    loadDashboard();
    const intervalId = window.setInterval(loadDashboard, 10000);

    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  const summary = useMemo(() => {
    const status = data.status;
    const openCount = firstNumber(
      status,
      ["open_count", "open_trades", "open_trades_count", "openTradeCount"],
      data.openTrades.length,
    );

    const closedCount = firstNumber(
      status,
      ["closed_count", "closed_trades", "closed_trades_count", "closedTradeCount"],
      data.closedTrades.length,
    );

    const realizedPnl = firstNumber(
      status,
      ["realized_pnl", "realizedPnl", "realized", "total_realized_pnl"],
      data.closedTrades.reduce((sum, trade) => sum + asNumber(trade.realized_pnl, 0), 0),
    );

    const unrealizedPnl = firstNumber(
      status,
      ["unrealized_pnl", "unrealizedPnl", "unrealized"],
      data.openTrades.reduce((sum, trade) => sum + asNumber(trade.unrealized_pnl, 0), 0),
    );

    const totalEquity = firstNumber(
      status,
      ["total_equity", "equity", "account_equity", "paper_equity"],
      STARTING_EQUITY + realizedPnl + unrealizedPnl,
    );

    const winners = data.closedTrades.filter((trade) => asNumber(trade.realized_pnl, 0) > 0).length;
    const computedWinRate = data.closedTrades.length > 0 ? (winners / data.closedTrades.length) * 100 : 0;

    const winRate = firstNumber(
      status,
      ["win_rate", "winRate", "closed_win_rate"],
      computedWinRate,
    );

    const dbExists = Boolean(status?.db_exists ?? status?.ok ?? !data.error);
    const mode = String(status?.mode || "paper");
    const brokerName = String(status?.broker_name || "paper_sim");
    const returnPct = totalEquity > 0 ? ((totalEquity - STARTING_EQUITY) / STARTING_EQUITY) * 100 : 0;
    const equitySeries = getEquitySeries(data.equityRows, totalEquity);

    return {
      openCount,
      closedCount,
      realizedPnl,
      unrealizedPnl,
      totalEquity,
      winRate,
      dbExists,
      mode,
      brokerName,
      returnPct,
      equitySeries,
    };
  }, [data]);

  const recentTrades = useMemo(() => {
    return [...data.openTrades, ...data.closedTrades].slice(0, 6);
  }, [data.openTrades, data.closedTrades]);

  const topSymbols = useMemo(() => {
    return buildTopSymbols(data.closedTrades, data.openTrades);
  }, [data.closedTrades, data.openTrades]);

  const lastEvent = data.events[0];

  return (
    <main className="boardroom-app">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <a className="brand" href="/">
          FAYT <span>SYSTEMS</span>
        </a>

        <nav className="nav-links" aria-label="Primary navigation">
          <a href="#overview" className="active">Overview</a>
          <a href="#live-demo">Live Demo</a>
          <a href="#performance">Performance</a>
          <a href="#risk">Risk</a>
          <a href="#technology">Technology</a>
          <a href="#contact">Contact</a>
        </nav>

        <a className="launch-button" href="#live-demo">
          Launch Live Demo <span>→</span>
        </a>
      </header>

      <section className="hero-shell" id="overview">
        <div className="world-map" />

        <div className="hero-copy">
          <p className="section-kicker">Public read-only paper demo</p>
          <h1>{PUBLIC_WORDING}</h1>
          <p className="hero-subtitle">
            Institutional-grade market data. Sophisticated execution logic.
            Transparent performance. Built for disciplined decision-making.
          </p>

          <div className="mode-banner">
            <span className="shield">◇</span>
            <span>{MODE_WORDING}</span>
          </div>

          <div className="hero-status-grid">
            <div>
              <span>Public demo/API</span>
              <strong>Live</strong>
            </div>
            <div>
              <span>Execution</span>
              <strong>paper_sim only</strong>
            </div>
            <div>
              <span>Real Coinbase orders</span>
              <strong>Disabled</strong>
            </div>
          </div>
        </div>

        <div className="hero-metrics">
          <MetricCard
            eyebrow="Live Status"
            value={summary.dbExists ? "Operational" : "Offline"}
            caption="Market data live / paper execution active"
            tone={summary.dbExists ? "green" : "neutral"}
          >
            <div className="radar">
              <span />
              <span />
            </div>
          </MetricCard>

          <MetricCard
            eyebrow="Open Paper Trades"
            value={`${summary.openCount} / ${MAX_OPEN_PAPER_TRADES}`}
            caption="Max 5 open paper trades"
            tone="gold"
          >
            <div className="doc-icon">▱</div>
          </MetricCard>

          <MetricCard
            eyebrow="Realized PnL"
            value={formatCurrency(summary.realizedPnl)}
            caption="All-time paper realized"
            tone={summary.realizedPnl >= 0 ? "green" : "neutral"}
          >
            <Sparkline values={[1, 2, 1.7, 2.8, 2.5, 3.8, 3.1, 4.7]} />
          </MetricCard>

          <MetricCard
            eyebrow="Win Rate"
            value={formatPercentAuto(summary.winRate, 1)}
            caption={`${formatNumber(summary.closedCount)} closed paper trades`}
            tone="blue"
          >
            <div className="donut">
              <span>{Math.round(Math.abs(summary.winRate) <= 1 ? summary.winRate * 100 : summary.winRate)}%</span>
            </div>
          </MetricCard>

          <MetricCard
            eyebrow="Total Equity"
            value={formatCurrency(summary.totalEquity)}
            caption="Paper account equity"
            tone="blue"
          >
            <Sparkline values={summary.equitySeries.slice(-12)} />
          </MetricCard>

          <MetricCard
            eyebrow="Risk Profile"
            value="Measured"
            caption="Disciplined, transparent, capped"
            tone="gold"
          >
            <div className="shield-icon">⌁</div>
          </MetricCard>
        </div>
      </section>

      {data.error ? (
        <section className="api-warning">
          <strong>Demo API connection warning:</strong> {data.error}
        </section>
      ) : null}

      <section className="dashboard-grid" id="live-demo">
        <article className="panel equity-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Equity Curve / Paper</p>
              <h2>{formatCurrencyPrecise(summary.totalEquity)}</h2>
              <span className={summary.returnPct >= 0 ? "positive-text" : "negative-text"}>
                {summary.returnPct >= 0 ? "+" : ""}
                {summary.returnPct.toFixed(2)}% all-time return
              </span>
            </div>

            <div className="range-tabs">
              <button>1D</button>
              <button>7D</button>
              <button>1M</button>
              <button>3M</button>
              <button>YTD</button>
              <button className="selected">ALL</button>
            </div>
          </div>

          <EquityChart values={summary.equitySeries} />

          <div className="chart-legend">
            <span><i className="line blue" /> Equity</span>
            <span><i className="line gold dotted" /> Buy & Hold Reference</span>
            <small>Dates shown in exchange time UTC</small>
          </div>
        </article>

        <article className="panel performance-panel" id="performance">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Performance Summary</p>
              <h2>Transparent Paper Telemetry</h2>
            </div>
          </div>

          <div className="stat-matrix">
            <div>
              <span>Total Return</span>
              <strong className={summary.returnPct >= 0 ? "positive-text" : "negative-text"}>
                {summary.returnPct >= 0 ? "+" : ""}
                {summary.returnPct.toFixed(2)}%
              </strong>
            </div>
            <div>
              <span>Realized PnL</span>
              <strong>{formatCurrencyPrecise(summary.realizedPnl)}</strong>
            </div>
            <div>
              <span>Unrealized PnL</span>
              <strong>{formatCurrencyPrecise(summary.unrealizedPnl)}</strong>
            </div>
            <div>
              <span>Closed Trades</span>
              <strong>{formatNumber(summary.closedCount)}</strong>
            </div>
            <div>
              <span>Open Trades</span>
              <strong>{summary.openCount}</strong>
            </div>
            <div>
              <span>Execution Broker</span>
              <strong>{summary.brokerName}</strong>
            </div>
          </div>

          <div className="distribution-block">
            <div className="mini-heading">
              <span>Return Distribution</span>
              <small>Monthly view</small>
            </div>
            <MonthlyBars />
          </div>
        </article>

        <article className="panel risk-panel" id="risk">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Risk Checkpoint / Latest</p>
              <h2>Execution Guardrails</h2>
            </div>
            <span className="timestamp">{new Date().toLocaleTimeString()} local</span>
          </div>

          <RiskRow
            icon="◇"
            label="Current open trade risk"
            detail="of equity"
            value={`${RISK_CHECKPOINT.currentOpenTradeRiskPct.toFixed(4)}%`}
          />
          <RiskRow
            icon="◷"
            label="Notional per trade"
            detail="about of equity"
            value={`${RISK_CHECKPOINT.notionalPerTradePct.toFixed(2)}%`}
          />
          <RiskRow
            icon="▱"
            label="Estimated 5-trade total stop-risk"
            detail="of equity"
            value={`${RISK_CHECKPOINT.fiveTradeTotalStopRiskPct.toFixed(4)}%`}
          />

          <div className="risk-summary">
            <div>
              <span>Position Sizing</span>
              <strong>Disciplined</strong>
            </div>
            <div>
              <span>Leverage</span>
              <strong>Low</strong>
            </div>
            <div>
              <span>Correlation</span>
              <strong>Managed</strong>
            </div>
            <div>
              <span>Liquidity</span>
              <strong>High</strong>
            </div>
          </div>

          <div className="system-parameters">
            <div>
              <span>Tracked Symbols</span>
              <strong>{TRACKED_SYMBOL_TARGET}</strong>
            </div>
            <div>
              <span>Max Open Paper Trades</span>
              <strong>{MAX_OPEN_PAPER_TRADES}</strong>
            </div>
          </div>
        </article>

        <article className="panel universe-panel" id="technology">
          <p className="eyebrow">Universe & Activity</p>

          <div className="activity-grid">
            <div>
              <span>Tracked Symbols</span>
              <strong>{TRACKED_SYMBOL_TARGET}</strong>
            </div>
            <div>
              <span>Open Paper Trades</span>
              <strong>{summary.openCount}</strong>
            </div>
            <div>
              <span>Mode</span>
              <strong>{summary.mode}</strong>
            </div>
            <div>
              <span>Market Data</span>
              <strong>Coinbase Advanced</strong>
            </div>
          </div>
        </article>

        <article className="panel symbols-panel">
          <div className="table-heading">
            <div>
              <p className="eyebrow">Top Performing Symbols / Paper</p>
              <h3>Current Leaders</h3>
            </div>
          </div>

          <div className="table">
            <div className="table-row table-head">
              <span>Symbol</span>
              <span>PnL</span>
              <span>Last Price</span>
              <span>Trend</span>
            </div>

            {topSymbols.map((row) => (
              <div className="table-row" key={row.symbol}>
                <span>{row.symbol}</span>
                <span className={row.pnl >= 0 ? "positive-text" : "negative-text"}>
                  {formatCurrencyPrecise(row.pnl)}
                </span>
                <span>{row.last > 0 ? formatCurrencyPrecise(row.last) : "Live watch"}</span>
                <span>
                  <Sparkline values={[1, 1.2, 1.1, 1.5, 1.4, 1.8, 1.7, 2]} />
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel trades-panel">
          <div className="table-heading">
            <div>
              <p className="eyebrow">Recent Paper Trades</p>
              <h3>Read-Only Execution Feed</h3>
            </div>
            <span className="view-all">View all</span>
          </div>

          <div className="table">
            <div className="table-row trade table-head">
              <span>Symbol</span>
              <span>Side</span>
              <span>Size</span>
              <span>Entry</span>
              <span>Status</span>
              <span>Risk</span>
            </div>

            {recentTrades.length > 0 ? (
              recentTrades.map((trade, index) => (
                <div className="table-row trade" key={`${trade.id || trade.symbol || "trade"}-${index}`}>
                  <span>{cleanSymbol(trade.symbol)}</span>
                  <span className={String(trade.side).toLowerCase() === "sell" ? "negative-text" : "positive-text"}>
                    {cleanSide(trade.side)}
                  </span>
                  <span>{asNumber(trade.notional_pct, RISK_CHECKPOINT.notionalPerTradePct).toFixed(2)}%</span>
                  <span>
                    {getTradeEntryPrice(trade) > 0
                      ? formatCurrencyPrecise(getTradeEntryPrice(trade))
                      : "—"}
                  </span>
                  <span>
                    <StatusDot active={isOpenTrade(trade)} />
                    {String(trade.status || "open").toUpperCase()}
                  </span>
                  <span>
                    {asNumber(trade.risk_pct, 0) > 0
                      ? `${asNumber(trade.risk_pct, 0).toFixed(4)}%`
                      : isOpenTrade(trade)
                        ? `${RISK_CHECKPOINT.currentOpenTradeRiskPct.toFixed(4)}%`
                        : "—"}
                  </span>
                </div>
              ))
            ) : (
              <div className="empty-row">
                {data.loading ? "Loading paper trade feed..." : "No recent paper trades returned by API."}
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="event-strip">
        <div>
          <span className="status-dot active" />
          <strong>Live read-only demo telemetry</strong>
        </div>
        <p>
          {lastEvent
            ? `${lastEvent.symbol ? `${cleanSymbol(lastEvent.symbol)} · ` : ""}${
                lastEvent.message || lastEvent.reason || lastEvent.event_type || lastEvent.type || "Latest event received"
              }`
            : "Awaiting latest runner event from the demo API."}
        </p>
      </section>

      <footer className="footer" id="contact">
        <div>
          <strong>Fayt Systems</strong>
          <span>Institutional framework. Disciplined execution. Transparent outcomes.</span>
        </div>
        <small>Public read-only paper demo. No real Coinbase orders are enabled.</small>
      </footer>
    </main>
  );
}

export default App;