// D:\CryptoTrader\fayt-demo-dashboard\src\App.tsx

import { useEffect, useMemo, useState } from "react";

import {
  getRiskProjection,
  getSnapshot,
  type DemoEquityPoint,
  type DemoSnapshot,
  type DemoTrade,
  type RiskAccountProjection,
  type RiskProjectionResponse,
  type RiskScenario,
} from "./client";
import { connectDemoStream } from "./ws";

type RangeKey = "1d" | "3d" | "7d" | "all";

const ranges: Array<{ key: RangeKey; label: string; days: number | null }> = [
  { key: "1d", label: "Last Day", days: 1 },
  { key: "3d", label: "Last 3 Days", days: 3 },
  { key: "7d", label: "Last 7 Days", days: 7 },
  { key: "all", label: "All", days: null },
];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatMoney(value?: number | null): string {
  return currency.format(value ?? 0);
}

function formatNumber(value?: number | null, digits = 6): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
}

function formatTime(value?: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function pnlClass(value?: number | null): string {
  if ((value ?? 0) > 0) {
    return "pnl-pos";
  }

  if ((value ?? 0) < 0) {
    return "pnl-neg";
  }

  return "";
}

function directionLabel(side: DemoTrade["side"] | string): string {
  if (side === "short" || side === "sell") {
    return "SHORT";
  }

  if (side === "long" || side === "buy") {
    return "LONG";
  }

  return "UNKNOWN";
}

function rangeCutoff(range: RangeKey): number | null {
  const item = ranges.find((entry) => entry.key === range);

  if (!item?.days) {
    return null;
  }

  return Date.now() - item.days * 24 * 60 * 60 * 1000;
}

function filterEquity(points: DemoEquityPoint[], range: RangeKey): DemoEquityPoint[] {
  const cutoff = rangeCutoff(range);

  if (!cutoff) {
    return points;
  }

  const filtered = points.filter((point) => {
    const ts = new Date(point.ts).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });

  if (filtered.length >= 2) {
    return filtered;
  }

  return points.slice(-2);
}

function filterClosedTrades(trades: DemoTrade[], range: RangeKey): DemoTrade[] {
  const cutoff = rangeCutoff(range);

  if (!cutoff) {
    return trades;
  }

  return trades.filter((trade) => {
    const ts = new Date(trade.closed_at ?? trade.opened_at ?? "").getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

function EquityChart({ points }: { points: DemoEquityPoint[] }) {
  if (points.length < 2) {
    return <div className="empty-state">Not enough closed-trade history yet for a curve.</div>;
  }

  const width = 860;
  const height = 260;
  const pad = 18;

  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);

  const polyline = points
    .map((point, index) => {
      const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
      const y = height - pad - ((point.equity - min) / span) * (height - pad * 2);

      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="chart-shell">
      <svg
        aria-label="Equity curve"
        className="line-chart"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line className="chart-grid" x1="0" x2={width} y1={height * 0.25} y2={height * 0.25} />
        <line className="chart-grid" x1="0" x2={width} y1={height * 0.5} y2={height * 0.5} />
        <line className="chart-grid" x1="0" x2={width} y1={height * 0.75} y2={height * 0.75} />

        <polyline className="line-chart-path" fill="none" points={polyline} />
      </svg>

      <div className="chart-meta">
        <span>Low: {formatMoney(min)}</span>
        <span>High: {formatMoney(max)}</span>
        <span>Latest: {formatMoney(points[points.length - 1]?.equity)}</span>
      </div>
    </div>
  );
}

function TradesTable({ trades, closed = false }: { trades: DemoTrade[]; closed?: boolean }) {
  if (!trades.length) {
    return <div className="empty-state">No trades to display.</div>;
  }

  return (
    <div className="table-wrap">
      <table className="grid-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>{closed ? "Exit" : "Current"}</th>
            <th>{closed ? "Realized" : "Unrealized"}</th>
            <th>{closed ? "Closed" : "Opened"}</th>
            <th>Bucket</th>
          </tr>
        </thead>

        <tbody>
          {trades.map((trade) => {
            const pnl = closed ? trade.realized_pnl : trade.unrealized_pnl;

            return (
              <tr key={`${trade.trade_id}-${trade.symbol}-${trade.opened_at}-${trade.closed_at}`}>
                <td>{trade.symbol}</td>
                <td>{directionLabel(trade.side)}</td>
                <td>{formatNumber(trade.quantity)}</td>
                <td>{formatMoney(trade.entry_price)}</td>
                <td>{formatMoney(closed ? trade.exit_price : trade.current_price)}</td>
                <td className={pnlClass(pnl)}>{formatMoney(pnl)}</td>
                <td>{formatTime(closed ? trade.closed_at : trade.opened_at)}</td>
                <td className="bucket-cell" title={trade.bucket_key ?? ""}>
                  {trade.bucket_key ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RiskProjectionPanel({
  projection,
}: {
  projection: RiskProjectionResponse | null;
}) {
  const [selectedAccountSize, setSelectedAccountSize] = useState<number>(1000);

  useEffect(() => {
    if (!projection?.account_sizes.length) {
      return;
    }

    if (!projection.account_sizes.includes(selectedAccountSize)) {
      setSelectedAccountSize(projection.account_sizes[0]);
    }
  }, [projection, selectedAccountSize]);

  const selectedAccount: RiskAccountProjection | null =
    projection?.accounts.find((account) => account.account_size === selectedAccountSize) ??
    projection?.accounts[0] ??
    null;

  const selectedScenario: RiskScenario | null = selectedAccount?.scenarios[0] ?? null;

  if (!projection || !selectedAccount) {
    return (
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Live Risk Projection Matrix</h2>
            <p>Loading $1K / $5K / $10K / $25K / $100K risk projections…</p>
          </div>
        </div>
        <div className="empty-state">Waiting for projection feed…</div>
      </section>
    );
  }

  return (
    <section className="panel risk-panel">
      <div className="panel-head">
        <div>
          <h2>Live Risk Projection Matrix</h2>
          <p>
            Same paper trades projected across $1K, $5K, $10K, $25K, and $100K demo accounts.
            Open-trade PnL updates live from the DB.
          </p>
        </div>

        <span className="muted">Updated: {formatTime(projection.generated_at)}</span>
      </div>

      <div className="account-tabs">
        {projection.account_sizes.map((accountSize) => (
          <button
            className={accountSize === selectedAccount.account_size ? "account-tab active" : "account-tab"}
            key={accountSize}
            onClick={() => setSelectedAccountSize(accountSize)}
            type="button"
          >
            {formatMoney(accountSize)}
          </button>
        ))}
      </div>

      <div className="risk-card-grid">
        {selectedAccount.scenarios.map((scenario) => {
          const summary = scenario.summary;

          return (
            <article className="risk-card" key={`${selectedAccount.account_size}-${scenario.risk_key}`}>
              <div className="risk-card-top">
                <span>{summary.risk_pct.toFixed(2)}% Risk</span>
                <strong className={pnlClass(summary.total_live_pnl)}>
                  {formatMoney(summary.live_equity)}
                </strong>
              </div>

              <div className="risk-card-metrics">
                <div>
                  <span>Total Live PnL</span>
                  <strong className={pnlClass(summary.total_live_pnl)}>
                    {formatMoney(summary.total_live_pnl)}
                  </strong>
                </div>
                <div>
                  <span>Live Unrealized</span>
                  <strong className={pnlClass(summary.live_unrealized_pnl)}>
                    {formatMoney(summary.live_unrealized_pnl)}
                  </strong>
                </div>
                <div>
                  <span>Return</span>
                  <strong className={pnlClass(summary.live_return_pct)}>
                    {summary.live_return_pct.toFixed(2)}%
                  </strong>
                </div>
                <div>
                  <span>Max DD</span>
                  <strong>{summary.max_drawdown_pct.toFixed(2)}%</strong>
                </div>
                <div>
                  <span>Win Rate</span>
                  <strong>{summary.win_rate.toFixed(2)}%</strong>
                </div>
                <div>
                  <span>Trades</span>
                  <strong>
                    {summary.closed_trades_used} closed / {summary.open_trades_used} open
                  </strong>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="matrix-wrap">
        <h3>All Account Sizes Overview</h3>
        <div className="table-wrap">
          <table className="grid-table matrix-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Risk</th>
                <th>Live Equity</th>
                <th>Total Live PnL</th>
                <th>Live Unrealized</th>
                <th>Return</th>
                <th>Max DD</th>
                <th>Win Rate</th>
              </tr>
            </thead>

            <tbody>
              {projection.overview.map((row) => (
                <tr key={`${row.account_size}-${row.risk_key}`}>
                  <td>{formatMoney(row.account_size)}</td>
                  <td>{row.risk_pct.toFixed(2)}%</td>
                  <td>{formatMoney(row.live_equity)}</td>
                  <td className={pnlClass(row.total_live_pnl)}>{formatMoney(row.total_live_pnl)}</td>
                  <td className={pnlClass(row.live_unrealized_pnl)}>
                    {formatMoney(row.live_unrealized_pnl)}
                  </td>
                  <td className={pnlClass(row.live_return_pct)}>{row.live_return_pct.toFixed(2)}%</td>
                  <td>{row.max_drawdown_pct.toFixed(2)}%</td>
                  <td>{row.win_rate.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedScenario ? (
        <div className="matrix-wrap">
          <h3>{formatMoney(selectedAccount.account_size)} Latest Risk Table</h3>
          <p className="muted">
            Showing the first risk profile layout as a sample detail table. Summary cards above show every risk level.
          </p>

          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>R</th>
                  <th>Risk $</th>
                  <th>Projected PnL</th>
                  <th>After Equity</th>
                  <th>Closed</th>
                </tr>
              </thead>

              <tbody>
                {selectedScenario.closed_rows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No projected closed trades yet.</td>
                  </tr>
                ) : (
                  selectedScenario.closed_rows.map((row) => (
                    <tr key={`${row.trade_id}-${row.n}`}>
                      <td>{row.n}</td>
                      <td>{row.symbol}</td>
                      <td>{directionLabel(row.side)}</td>
                      <td>{row.r_multiple.toFixed(3)}R</td>
                      <td>{formatMoney(row.risk_amount)}</td>
                      <td className={pnlClass(row.projected_pnl)}>{formatMoney(row.projected_pnl)}</td>
                      <td>{formatMoney(row.after_equity)}</td>
                      <td>{formatTime(row.closed_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="projection-disclaimer">{projection.meta.disclaimer}</p>
    </section>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [riskProjection, setRiskProjection] = useState<RiskProjectionResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("all");

  useEffect(() => {
    let mounted = true;

    const refreshProjection = () => {
      getRiskProjection()
        .then((data) => {
          if (mounted) {
            setRiskProjection(data);
          }
        })
        .catch((err: Error) => {
          if (mounted) {
            setError(err.message || "Failed to load risk projection.");
          }
        });
    };

    getSnapshot()
      .then((data) => {
        if (!mounted) {
          return;
        }

        setSnapshot(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!mounted) {
          return;
        }

        setError(err.message || "Failed to load snapshot.");
        setLoading(false);
      });

    refreshProjection();

    const projectionTimer = window.setInterval(refreshProjection, 3000);

    const disconnect = connectDemoStream({
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onError: () => setError("Live stream disconnected; retrying automatically."),
      onSnapshot: (next) => {
        setSnapshot(next);
        setError("");
        setLoading(false);
        refreshProjection();
      },
    });

    return () => {
      mounted = false;
      window.clearInterval(projectionTimer);
      disconnect();
    };
  }, []);

  const title = String(import.meta.env.VITE_APP_TITLE ?? "Fayt Systems Demo");

  const status = snapshot?.status;
  const openTrades = snapshot?.open_trades ?? [];
  const allClosedTrades = snapshot?.closed_trades ?? [];
  const rangeClosedTrades = useMemo(
    () => filterClosedTrades(allClosedTrades, range),
    [allClosedTrades, range],
  );
  const recentClosedTrades = rangeClosedTrades.slice(0, 12);
  const events = useMemo(() => snapshot?.events.slice(0, 20) ?? [], [snapshot]);
  const equity = useMemo(() => filterEquity(snapshot?.equity ?? [], range), [snapshot, range]);

  const totalReturnPct =
    status && status.starting_equity > 0
      ? ((status.total_equity - status.starting_equity) / status.starting_equity) * 100
      : 0;

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">FaytSystems</p>
          <h1>{title}</h1>
          <p className="lede">
            Public, read-only paper-trading demo. No login. No controls. Database-backed telemetry only.
          </p>
        </div>

        <div className="hero-meta">
          <span className={`pill ${connected ? "pill-ok" : "pill-warn"}`}>
            {connected ? "Live stream connected" : "Reconnecting"}
          </span>
          <span className="pill">Read-only</span>
          <span className="pill">Paper demo</span>
        </div>
      </header>

      {error ? <div className="banner banner-warn">{error}</div> : null}

      <section className="stats-grid">
        <article className="stat-card">
          <span className="stat-label">Total Equity</span>
          <strong className="stat-value">{formatMoney(status?.total_equity)}</strong>
          <span className={pnlClass(totalReturnPct)}>{totalReturnPct.toFixed(2)}% since start</span>
        </article>

        <article className="stat-card">
          <span className="stat-label">Realized PnL</span>
          <strong className={`stat-value ${pnlClass(status?.realized_pnl)}`}>
            {formatMoney(status?.realized_pnl)}
          </strong>
          <span>{status?.closed_trade_count ?? 0} closed trades</span>
        </article>

        <article className="stat-card">
          <span className="stat-label">Unrealized PnL</span>
          <strong className={`stat-value ${pnlClass(status?.unrealized_pnl)}`}>
            {formatMoney(status?.unrealized_pnl)}
          </strong>
          <span>{status?.open_trade_count ?? 0} open trades</span>
        </article>

        <article className="stat-card">
          <span className="stat-label">Win Rate</span>
          <strong className="stat-value">{(status?.win_rate ?? 0).toFixed(2)}%</strong>
          <span>
            {status?.winners ?? 0} wins / {status?.losers ?? 0} losses
          </span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Equity Curve</h2>
            <p>Rebuilt from read-only database snapshots and closed-trade realized PnL.</p>
          </div>

          <div className="range-tabs">
            {ranges.map((item) => (
              <button
                className={item.key === range ? "range-tab active" : "range-tab"}
                key={item.key}
                onClick={() => setRange(item.key)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {loading && !snapshot ? (
          <div className="empty-state">Loading snapshot…</div>
        ) : (
          <EquityChart points={equity} />
        )}
      </section>

      <RiskProjectionPanel projection={riskProjection} />

      <div className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Open Trades</h2>
              <p>Current paper positions only.</p>
            </div>
          </div>

          <TradesTable trades={openTrades} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Recent Events</h2>
              <p>Latest trade and runner telemetry.</p>
            </div>
          </div>

          <div className="event-feed">
            {!events.length ? (
              <div className="empty-state">No events available.</div>
            ) : (
              <ul className="event-list">
                {events.map((event, index) => (
                  <li key={`${event.ts}-${event.kind}-${index}`}>
                    <div className="event-row">
                      <strong>{event.kind}</strong>
                      <span className="muted">{formatTime(event.ts)}</span>
                    </div>
                    <div>{event.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Recently Closed Trades</h2>
            <p>Most recent exits from the paper-trading database for the selected range.</p>
          </div>

          <span className="muted">Updated: {formatTime(snapshot?.generated_at)}</span>
        </div>

        <TradesTable trades={recentClosedTrades} closed />
      </section>

      <footer className="footer-note">
        <span>Mode: {status?.mode ?? "paper"}</span>
        <span>Broker: {status?.broker_name ?? "paper_sim"}</span>
        <span>Source DB: {status?.db_path ?? "not loaded"}</span>
        <span>Last event: {formatTime(status?.last_event_ts)}</span>
        <span>Not financial advice. Paper/simulated results do not guarantee future results.</span>
      </footer>
    </div>
  );
}