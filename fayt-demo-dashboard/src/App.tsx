import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import type {
  DashboardBundle,
  DemoEvent,
  DemoTrade,
  MarketBoardSymbol,
  MarketCandle,
  MarketTradeMarker,
} from "./client";
import { fetchDashboardBundle } from "./client";

const DISPLAY_STARTING_BALANCE = 1000;
const POLL_MS = 2500;
const SLIPPAGE_BPS = 8;
const FEES_BPS = 12;

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatCompactCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSignedCurrency(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function sideLabel(side?: string | null): "LONG" | "SHORT" {
  const normalized = String(side || "").toLowerCase();
  return normalized.includes("sell") || normalized.includes("short") ? "SHORT" : "LONG";
}

function estimatePnlAfterCosts(trade: DemoTrade): number {
  const direction = sideLabel(trade.side) === "SHORT" ? -1 : 1;
  const current = Number(trade.current_price ?? trade.entry_price ?? 0);
  const entry = Number(trade.entry_price ?? 0);
  const qty = Number(trade.qty ?? 0);
  const gross = direction * (current - entry) * qty;
  const entryNotional = entry * qty;
  const exitNotional = current * qty;
  const totalCostRate = (SLIPPAGE_BPS + FEES_BPS) / 10000;
  const estimatedCosts = (entryNotional + exitNotional) * totalCostRate;
  return gross - estimatedCosts;
}

function useDirectionalFlash(
  value: number,
  classes: { up?: string; down?: string }
): string {
  const prevRef = useRef<number | null>(null);
  const [flash, setFlash] = useState("");

  useEffect(() => {
    if (prevRef.current === null) {
      prevRef.current = value;
      return;
    }

    let next = "";
    if (value > prevRef.current && classes.up) {
      next = classes.up;
    } else if (value < prevRef.current && classes.down) {
      next = classes.down;
    }

    prevRef.current = value;

    if (!next) return;

    setFlash(next);
    const timeout = window.setTimeout(() => setFlash(""), 1700);
    return () => window.clearTimeout(timeout);
  }, [value, classes.down, classes.up]);

  return flash;
}

function useClock(): string {
  const [time, setTime] = useState(
    new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTime(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  return time;
}

function StatCard(props: {
  title: string;
  value: string;
  subValue?: string;
  tone?: "default" | "positive" | "negative" | "gold";
  flashClass?: string;
  footnote?: string;
}) {
  const { title, value, subValue, tone = "default", flashClass = "", footnote } = props;

  return (
    <div className={`panel stat-card tone-${tone}`}>
      <div className="panel-title">{title}</div>
      <div className={`stat-value ${flashClass}`}>{value}</div>
      {subValue ? <div className="stat-subvalue">{subValue}</div> : null}
      {footnote ? <div className="stat-footnote">{footnote}</div> : null}
    </div>
  );
}

function TickerStrip({ items }: { items: MarketBoardSymbol[] }) {
  return (
    <div className="ticker-strip panel">
      {items.map((item) => (
        <div key={item.symbol} className="ticker-chip">
          <div className="ticker-symbol">{item.symbol}</div>
          <div className="ticker-price">{formatCompactCurrency(item.last_price)}</div>
          <div className={`ticker-change ${item.pct_change >= 0 ? "positive" : "negative"}`}>
            {formatPct(item.pct_change)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartLegend() {
  return (
    <div className="chart-legend">
      <span><i className="legend-dot long"></i> Long Entry</span>
      <span><i className="legend-dot short"></i> Short Entry</span>
      <span><i className="legend-dot exit"></i> Exit</span>
    </div>
  );
}

function locateMarkerIndex(candles: MarketCandle[], ts: string): number {
  if (!candles.length || !ts) return -1;
  const target = new Date(ts).getTime();

  let bestIndex = 0;
  let smallestDiff = Number.POSITIVE_INFINITY;

  candles.forEach((candle, index) => {
    const diff = Math.abs(new Date(candle.ts).getTime() - target);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function CandleChart({
  symbolData,
  selectedSymbol,
}: {
  symbolData?: MarketBoardSymbol;
  selectedSymbol: string;
}) {
  const width = 980;
  const height = 380;
  const paddingX = 22;
  const paddingTop = 18;
  const paddingBottom = 36;
  const chartHeight = height - paddingTop - paddingBottom;
  const chartWidth = width - paddingX * 2;

  const candles = symbolData?.candles ?? [];
  const markers = symbolData?.markers ?? [];

  if (!candles.length) {
    return (
      <div className="chart-empty">
        <div className="chart-empty-title">No market candles available</div>
        <div className="chart-empty-subtitle">
          Waiting for live DB bars for <strong>{selectedSymbol}</strong>.
        </div>
      </div>
    );
  }

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const priceRange = Math.max(maxPrice - minPrice, 0.000001);
  const xStep = chartWidth / Math.max(candles.length - 1, 1);
  const bodyWidth = Math.max(6, Math.min(12, xStep * 0.66));

  const yFromPrice = (price: number) =>
    paddingTop + (maxPrice - price) / priceRange * chartHeight;

  const closePath = candles
    .map((candle, index) => {
      const x = paddingX + xStep * index;
      const y = yFromPrice(candle.close);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const gridLines = 5;
  const priceLabels = Array.from({ length: gridLines + 1 }).map((_, i) => {
    const ratio = i / gridLines;
    const price = maxPrice - ratio * priceRange;
    const y = paddingTop + ratio * chartHeight;
    return { price, y };
  });

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={`${selectedSymbol} live chart`}>
        <defs>
          <linearGradient id="chartBg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(19, 45, 92, 0.32)" />
            <stop offset="100%" stopColor="rgba(5, 13, 28, 0.05)" />
          </linearGradient>

          <linearGradient id="lineGlow" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#55d9ff" />
            <stop offset="50%" stopColor="#3c9dff" />
            <stop offset="100%" stopColor="#a36eff" />
          </linearGradient>

          <filter id="lineShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 12 -5"
            />
          </filter>

          <filter id="candleGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.3" />
          </filter>
        </defs>

        <rect x="0" y="0" width={width} height={height} fill="url(#chartBg)" rx="18" />

        {priceLabels.map((label) => (
          <g key={`${label.y}`}>
            <line
              x1={paddingX}
              y1={label.y}
              x2={width - paddingX}
              y2={label.y}
              className="chart-gridline"
            />
            <text x={width - 6} y={label.y - 4} className="chart-axis-label" textAnchor="end">
              {label.price.toFixed(2)}
            </text>
          </g>
        ))}

        {candles.map((candle, index) => {
          const x = paddingX + xStep * index;
          const yOpen = yFromPrice(candle.open);
          const yClose = yFromPrice(candle.close);
          const yHigh = yFromPrice(candle.high);
          const yLow = yFromPrice(candle.low);
          const isUp = candle.close >= candle.open;
          const top = Math.min(yOpen, yClose);
          const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));

          return (
            <g key={`${candle.ts}-${index}`}>
              <line
                x1={x}
                y1={yHigh}
                x2={x}
                y2={yLow}
                className={`chart-wick ${isUp ? "wick-up" : "wick-down"}`}
              />
              <rect
                x={x - bodyWidth / 2}
                y={top}
                width={bodyWidth}
                height={bodyHeight}
                rx="2"
                className={`chart-body ${isUp ? "body-up" : "body-down"}`}
                filter="url(#candleGlow)"
              />
            </g>
          );
        })}

        <path d={closePath} className="chart-close-shadow" filter="url(#lineShadow)" />
        <path d={closePath} className="chart-close-line" />

        {markers.map((marker: MarketTradeMarker) => {
          const entryIndex = locateMarkerIndex(candles, marker.entry_ts);
          const exitIndex = marker.exit_ts ? locateMarkerIndex(candles, marker.exit_ts) : -1;
          const entryX = entryIndex >= 0 ? paddingX + xStep * entryIndex : null;
          const exitX = exitIndex >= 0 ? paddingX + xStep * exitIndex : null;
          const entryY = yFromPrice(marker.entry_price);
          const exitY =
            exitX !== null && marker.exit_price != null ? yFromPrice(marker.exit_price) : null;
          const isShort = sideLabel(marker.side) === "SHORT";

          return (
            <g key={`marker-${marker.id}`}>
              {entryX !== null ? (
                <>
                  <line
                    x1={entryX}
                    y1={paddingTop}
                    x2={entryX}
                    y2={height - paddingBottom}
                    className="marker-line"
                  />
                  <polygon
                    points={
                      isShort
                        ? `${entryX},${entryY + 8} ${entryX - 8},${entryY - 7} ${entryX + 8},${entryY - 7}`
                        : `${entryX},${entryY - 8} ${entryX - 8},${entryY + 7} ${entryX + 8},${entryY + 7}`
                    }
                    className={`marker-entry ${isShort ? "marker-short" : "marker-long"}`}
                  />
                </>
              ) : null}

              {exitX !== null && exitY !== null ? (
                <>
                  <line
                    x1={exitX}
                    y1={paddingTop}
                    x2={exitX}
                    y2={height - paddingBottom}
                    className="marker-line exit-line"
                  />
                  <rect
                    x={exitX - 6}
                    y={exitY - 6}
                    width="12"
                    height="12"
                    rx="3"
                    transform={`rotate(45 ${exitX} ${exitY})`}
                    className="marker-exit"
                  />
                </>
              ) : null}
            </g>
          );
        })}

        {candles.map((candle, index) => {
          if (index % Math.ceil(candles.length / 6) !== 0 && index !== candles.length - 1) {
            return null;
          }

          const x = paddingX + xStep * index;
          return (
            <text key={`label-${candle.ts}`} x={x} y={height - 10} textAnchor="middle" className="chart-axis-label">
              {new Date(candle.ts).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </text>
          );
        })}
      </svg>

      <ChartLegend />
    </div>
  );
}

function RankedMovers({ symbols, onSelect, selectedSymbol }: {
  symbols: MarketBoardSymbol[];
  onSelect: (symbol: string) => void;
  selectedSymbol: string;
}) {
  const sorted = useMemo(
    () => [...symbols].sort((a, b) => b.pct_change - a.pct_change),
    [symbols]
  );

  return (
    <div className="panel panel-scroll">
      <div className="panel-header-row">
        <div className="panel-title">Ranked Movers</div>
        <div className="panel-kicker">Live Ranked Net Change</div>
      </div>
      <div className="movers-list">
        {sorted.map((item) => {
          const pct = Math.max(Math.min(item.pct_change, 10), -10);
          const width = `${Math.max(8, Math.abs(pct) * 9)}%`;

          return (
            <button
              key={item.symbol}
              className={`mover-row ${selectedSymbol === item.symbol ? "selected" : ""}`}
              onClick={() => onSelect(item.symbol)}
            >
              <div className="mover-meta">
                <span className="mover-symbol">{item.symbol}</span>
                <span className={`mover-value ${item.pct_change >= 0 ? "positive" : "negative"}`}>
                  {formatPct(item.pct_change)}
                </span>
              </div>
              <div className="mover-bar-shell">
                <div
                  className={`mover-bar ${item.pct_change >= 0 ? "positive" : "negative"}`}
                  style={{ width }}
                />
              </div>
              <div className="mover-submeta">
                <span>{formatCompactCurrency(item.last_price)}</span>
                <span>H {item.high.toFixed(2)} / L {item.low.toFixed(2)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OpenPositions({ trades }: { trades: DemoTrade[] }) {
  return (
    <div className="panel panel-scroll">
      <div className="panel-header-row">
        <div className="panel-title">Open Positions</div>
        <div className="panel-kicker">Live Est. PnL After Slippage & Fees</div>
      </div>

      <div className="position-list">
        {trades.length === 0 ? (
          <div className="empty-state">No open positions.</div>
        ) : (
          trades.map((trade) => {
            const pnl = estimatePnlAfterCosts(trade);
            const target = trade.take_profit ?? trade.exit_price ?? 0;

            return (
              <div key={trade.id} className="position-card">
                <div className="position-top">
                  <div>
                    <div className="position-symbol">{trade.symbol}</div>
                    <div className={`position-side ${sideLabel(trade.side) === "LONG" ? "long" : "short"}`}>
                      {sideLabel(trade.side)}
                    </div>
                  </div>
                  <div className={`position-pnl ${pnl >= 0 ? "positive" : "negative"}`}>
                    {formatSignedCurrency(pnl)}
                  </div>
                </div>

                <div className="position-grid">
                  <div>
                    <span className="label">Entry</span>
                    <strong>{trade.entry_price.toFixed(4)}</strong>
                  </div>
                  <div>
                    <span className="label">Live</span>
                    <strong>{Number(trade.current_price ?? trade.entry_price).toFixed(4)}</strong>
                  </div>
                  <div>
                    <span className="label">Target</span>
                    <strong>{target ? target.toFixed(4) : "—"}</strong>
                  </div>
                  <div>
                    <span className="label">Stop</span>
                    <strong>{trade.stop_loss ? trade.stop_loss.toFixed(4) : "—"}</strong>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ActivityFeed({ events }: { events: DemoEvent[] }) {
  return (
    <div className="panel panel-scroll">
      <div className="panel-header-row">
        <div className="panel-title">Live Activity</div>
        <div className="panel-kicker">Runner / DB Event Feed</div>
      </div>

      <div className="activity-list">
        {events.length === 0 ? (
          <div className="empty-state">No recent events.</div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="activity-row">
              <div className="activity-time">
                {new Date(event.event_ts).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
              <div className="activity-body">
                <div className="activity-type">{event.event_type}</div>
                <div className="activity-meta">
                  {event.symbol || "SYSTEM"}
                  {event.payload_json ? ` · ${String(event.payload_json).slice(0, 84)}` : ""}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [bundle, setBundle] = useState<DashboardBundle | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState("BTC/USD");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const clock = useClock();

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const next = await fetchDashboardBundle();
        if (!active) return;

        setBundle(next);

        const preferred =
          next.openTrades[0]?.symbol ||
          next.marketBoard.symbols[0]?.symbol ||
          "BTC/USD";

        setSelectedSymbol((current) =>
          next.marketBoard.symbols.some((item) => item.symbol === current)
            ? current
            : preferred
        );

        setError("");
      } catch {
        if (active) {
          setError("Unable to load boardroom data.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, POLL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const status = bundle?.status ?? {
    mode: "paper",
    broker_name: "paper_sim",
    db_exists: false,
    starting_equity: 30000,
    total_equity: 30000,
    realized_pnl: 0,
    unrealized_pnl: 0,
    open_trade_count: 0,
    closed_trade_count: 0,
    win_rate: 0,
  };

  const openTrades = bundle?.openTrades ?? [];
  const closedTrades = bundle?.closedTrades ?? [];
  const marketSymbols = bundle?.marketBoard.symbols ?? [];
  const events = bundle?.events ?? [];

  const selectedData = marketSymbols.find((item) => item.symbol === selectedSymbol);

  const wins = useMemo(
    () => closedTrades.filter((trade) => Number(trade.realized_pnl ?? 0) > 0).length,
    [closedTrades]
  );

  const losses = useMemo(
    () => closedTrades.filter((trade) => Number(trade.realized_pnl ?? 0) <= 0).length,
    [closedTrades]
  );

  const livePnL = useMemo(() => {
    const delta = Number(status.total_equity ?? 0) - Number(status.starting_equity ?? 0);
    if (Number.isFinite(delta) && delta !== 0) return delta;
    return Number(status.realized_pnl ?? 0) + Number(status.unrealized_pnl ?? 0);
  }, [status.realized_pnl, status.starting_equity, status.total_equity, status.unrealized_pnl]);

  const boardroomBalance = DISPLAY_STARTING_BALANCE + livePnL;

  const winFlash = useDirectionalFlash(wins, { up: "flash-win" });
  const lossFlash = useDirectionalFlash(losses, { up: "flash-loss" });
  const pnlFlash = useDirectionalFlash(livePnL, {
    up: "flash-pnl-up",
    down: "flash-pnl-down",
  });

  const topTicker = useMemo(() => marketSymbols.slice(0, 10), [marketSymbols]);

  return (
    <div className="boardroom-app">
      <div className="boardroom-shell">
        <header className="hero-banner panel">
          <div className="hero-crest">
            <div className="hero-crest-inner">FS</div>
          </div>

          <div className="hero-copy">
            <div className="hero-brand">FaytSystems</div>
            <div className="hero-title">Boardroom Dashboard</div>
            <div className="hero-subtitle">
              Certified Execution Intelligence · Live Paper Telemetry · Slippage-Aware PnL
            </div>
          </div>

          <div className="hero-meta">
            <div className="hero-clock">{clock}</div>
            <div className="hero-badges">
              <span className="hero-badge">DB {status.db_exists ? "LIVE" : "OFFLINE"}</span>
              <span className="hero-badge">{status.mode.toUpperCase()}</span>
              <span className="hero-badge">{String(status.broker_name || "paper_sim").toUpperCase()}</span>
            </div>
          </div>

          <div className="hero-sweep"></div>
        </header>

        <TickerStrip items={topTicker} />

        {error ? <div className="error-banner panel">{error}</div> : null}

        <div className="dashboard-grid">
          <section className="panel panel-chart-main">
            <div className="panel-header-row">
              <div>
                <div className="panel-title">Live 3D Trade Chart</div>
                <div className="panel-kicker">
                  Trade Entry / Exit Markers · Candle Colors From Live DB
                </div>
              </div>

              <div className="symbol-pills">
                {marketSymbols.slice(0, 8).map((item) => (
                  <button
                    key={item.symbol}
                    className={`symbol-pill ${item.symbol === selectedSymbol ? "selected" : ""}`}
                    onClick={() => setSelectedSymbol(item.symbol)}
                  >
                    {item.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div className="chart-header-metrics">
              <div className="chart-symbol">{selectedSymbol}</div>
              <div className={`chart-change ${(selectedData?.pct_change ?? 0) >= 0 ? "positive" : "negative"}`}>
                {selectedData ? formatPct(selectedData.pct_change) : "—"}
              </div>
              <div className="chart-mini-stat">
                Last {selectedData ? formatCompactCurrency(selectedData.last_price) : "—"}
              </div>
              <div className="chart-mini-stat">
                High {selectedData ? selectedData.high.toFixed(2) : "—"}
              </div>
              <div className="chart-mini-stat">
                Low {selectedData ? selectedData.low.toFixed(2) : "—"}
              </div>
            </div>

            <CandleChart symbolData={selectedData} selectedSymbol={selectedSymbol} />
          </section>

          <section className="metrics-stack">
            <StatCard
              title="Wins"
              value={formatNumber(wins)}
              subValue={`${status.closed_trade_count} closed trades · ${status.win_rate.toFixed(2)}% win rate`}
              tone="gold"
              flashClass={winFlash}
              footnote="Golden flash on new win, then reverts to theme."
            />

            <StatCard
              title="Losses"
              value={formatNumber(losses)}
              subValue={`${status.open_trade_count} open trades currently`}
              tone="negative"
              flashClass={lossFlash}
              footnote="Red fade / sink effect on new loss, then reverts to theme."
            />

            <StatCard
              title="Boardroom Balance"
              value={formatCurrency(boardroomBalance)}
              subValue={`Starting balance ${formatCurrency(DISPLAY_STARTING_BALANCE)}`}
              tone={livePnL >= 0 ? "positive" : "negative"}
              flashClass={pnlFlash}
              footnote={`Live PnL ${formatSignedCurrency(livePnL)}`}
            />
          </section>

          <section className="panel panel-summary-grid">
            <div className="summary-cell">
              <span className="summary-label">Realized PnL</span>
              <strong className={Number(status.realized_pnl) >= 0 ? "positive" : "negative"}>
                {formatSignedCurrency(Number(status.realized_pnl))}
              </strong>
            </div>
            <div className="summary-cell">
              <span className="summary-label">Unrealized PnL</span>
              <strong className={Number(status.unrealized_pnl) >= 0 ? "positive" : "negative"}>
                {formatSignedCurrency(Number(status.unrealized_pnl))}
              </strong>
            </div>
            <div className="summary-cell">
              <span className="summary-label">Open Positions</span>
              <strong>{formatNumber(status.open_trade_count)}</strong>
            </div>
            <div className="summary-cell">
              <span className="summary-label">Closed Trades</span>
              <strong>{formatNumber(status.closed_trade_count)}</strong>
            </div>
          </section>

          <OpenPositions trades={openTrades} />
          <RankedMovers
            symbols={marketSymbols}
            selectedSymbol={selectedSymbol}
            onSelect={setSelectedSymbol}
          />
          <ActivityFeed events={events} />
        </div>

        {loading ? <div className="loading-overlay">Loading boardroom dashboard…</div> : null}
      </div>
    </div>
  );
}