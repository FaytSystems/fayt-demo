import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

type Candle = {
  i?: number;
  ts?: string;
  time?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  direction?: string;
};

type CandlePayload = {
  ok?: boolean;
  source?: string;
  symbol?: string;
  timeframe?: string;
  count?: number;
  generated_at?: string;
  latest_ts?: string;
  candles?: Candle[];
};

type Decision = {
  symbol: string;
  approved: boolean;
  denied: boolean;
};

type LiveRunnerPayload = {
  ok?: boolean;
  source?: string;
  count?: number;
  approved_count?: number;
  denied_count?: number;
  decisions?: Decision[];
};

type TradeMarker = {
  symbol: string;
  kind: "entry" | "exit" | string;
  side?: "long" | "short" | string;
  price: number;
  ts?: string;
  time?: string;
  label?: string;
};

type LiveTrade = {
  id?: string | number;
  symbol: string;
  side: "long" | "short" | string;
  target_exit_price?: number | null;
  current_price?: number | null;
  entry_price?: number | null;
  exit_price?: number | null;
  qty?: number | null;
  pnl?: number | null;
  status?: string;
  opened_at?: string;
  closed_at?: string;
};

type LiveTradesPayload = {
  ok?: boolean;
  source?: string;
  generated_at?: string;
  running_pnl?: number;
  trades?: LiveTrade[];
  markers?: TradeMarker[];
};

const API_BASE =
  (window as any).FAYT_DEMO_API_BASE ||
  (import.meta as any).env?.VITE_DEMO_API_BASE ||
  "https://demo-api.faytsystems.com";

const DEFAULT_SYMBOLS = ["AAVE/USD", "ARB/USD", "BTC/USD", "ETH/USD", "SOL/USD", "ADA/USD"];
const TIMEFRAME = "60m";
const CANDLE_LIMIT = 128;

function endpoint(path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(path, API_BASE);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

function fmtPrice(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: Math.abs(n) < 10 ? 4 : 2,
    maximumFractionDigits: Math.abs(n) < 10 ? 6 : 2,
  });
}

function fmtMoney(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return "$0.00";
  const n = Number(value);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizeSide(side?: string) {
  const s = String(side || "").toLowerCase();
  if (s.includes("short") || s === "sell") return "short";
  return "long";
}

function niceTime(ts?: string) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function CandleCanvas({
  candles,
  markers,
  symbol,
}: {
  candles: Candle[];
  markers: TradeMarker[];
  symbol: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent || !candles.length) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = { l: 54, r: 30, t: 28, b: 44 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const highs = candles.map((c) => Number(c.high));
    const lows = candles.map((c) => Number(c.low));
    let max = Math.max(...highs);
    let min = Math.min(...lows);
    const extra = Math.max((max - min) * 0.12, Math.abs(max) * 0.002, 0.0001);
    max += extra;
    min -= extra;
    const span = Math.max(max - min, 0.000001);
    const y = (price: number) => pad.t + ((max - price) / span) * plotH;
    const x = (idx: number) => pad.l + (candles.length <= 1 ? 0 : (idx / (candles.length - 1)) * plotW);

    const grid = ctx.createLinearGradient(0, 0, width, height);
    grid.addColorStop(0, "rgba(14, 165, 233, 0.14)");
    grid.addColorStop(1, "rgba(34, 197, 94, 0.04)");
    ctx.fillStyle = grid;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.13)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i += 1) {
      const gy = pad.t + (plotH / 6) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(width - pad.r, gy - 28);
      ctx.stroke();
    }
    for (let i = 0; i <= 12; i += 1) {
      const gx = pad.l + (plotW / 12) * i;
      ctx.beginPath();
      ctx.moveTo(gx, pad.t + plotH);
      ctx.lineTo(gx + 34, pad.t);
      ctx.stroke();
    }
    ctx.restore();

    const line = ctx.createLinearGradient(pad.l, 0, width - pad.r, 0);
    line.addColorStop(0, "rgba(125, 211, 252, 0.15)");
    line.addColorStop(0.5, "rgba(125, 211, 252, 0.72)");
    line.addColorStop(1, "rgba(52, 211, 153, 0.16)");
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    candles.forEach((c, i) => {
      const px = x(i);
      const py = y(Number(c.close));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    const candleW = Math.max(4, Math.min(13, plotW / candles.length * 0.48));
    candles.forEach((c, i) => {
      const cx = x(i);
      const open = Number(c.open);
      const close = Number(c.close);
      const high = Number(c.high);
      const low = Number(c.low);
      const up = close >= open;
      const top = Math.min(y(open), y(close));
      const bottom = Math.max(y(open), y(close));
      const bodyH = Math.max(2, bottom - top);
      const main = up ? "rgba(52, 211, 153, 0.96)" : "rgba(251, 113, 133, 0.96)";
      const face = up ? "rgba(5, 150, 105, 0.48)" : "rgba(190, 18, 60, 0.48)";
      const glow = up ? "rgba(52, 211, 153, 0.22)" : "rgba(251, 113, 133, 0.22)";

      ctx.strokeStyle = main;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, y(high));
      ctx.lineTo(cx, y(low));
      ctx.stroke();

      ctx.fillStyle = glow;
      ctx.fillRect(cx - candleW / 2 - 2, top - 2, candleW + 4, bodyH + 4);
      ctx.fillStyle = main;
      ctx.fillRect(cx - candleW / 2, top, candleW, bodyH);
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.moveTo(cx + candleW / 2, top);
      ctx.lineTo(cx + candleW / 2 + 7, top + 7);
      ctx.lineTo(cx + candleW / 2 + 7, bottom + 7);
      ctx.lineTo(cx + candleW / 2, bottom);
      ctx.closePath();
      ctx.fill();
    });

    const symbolMarkers = markers.filter((marker) => marker.symbol === symbol && Number.isFinite(Number(marker.price)));
    symbolMarkers.forEach((marker, i) => {
      const price = Number(marker.price);
      let idx = candles.findIndex((c) => (c.ts || c.time) === (marker.ts || marker.time));
      if (idx < 0) idx = marker.kind === "exit" ? candles.length - 1 : Math.max(0, Math.floor(candles.length * 0.72) + i);
      const mx = x(Math.min(candles.length - 1, idx));
      const my = y(price);
      const isEntry = marker.kind === "entry";
      const color = isEntry ? "rgba(59, 130, 246, 0.98)" : "rgba(250, 204, 21, 0.98)";
      const label = isEntry ? "ENTRY" : "EXIT";

      ctx.save();
      ctx.shadowBlur = 22;
      ctx.shadowColor = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (isEntry) {
        ctx.moveTo(mx, my - 15);
        ctx.lineTo(mx + 14, my + 10);
        ctx.lineTo(mx - 14, my + 10);
      } else {
        ctx.moveTo(mx, my + 15);
        ctx.lineTo(mx + 14, my - 10);
        ctx.lineTo(mx - 14, my - 10);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "rgba(226, 232, 240, 0.94)";
      ctx.font = "800 11px Inter, system-ui, sans-serif";
      ctx.fillText(label, mx + 16, my + (isEntry ? 8 : -8));
    });

    const last = candles[candles.length - 1];
    const lastY = y(Number(last.close));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(pad.l, lastY);
    ctx.lineTo(width - pad.r, lastY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(226, 232, 240, 0.72)";
    ctx.font = "700 11px Inter, system-ui, sans-serif";
    ctx.fillText(`${symbol} · ${TIMEFRAME}`, pad.l, height - 16);
    ctx.fillText(`Latest ${niceTime(last.ts || last.time)}`, Math.max(pad.l, width - 160), height - 16);
  }, [candles, markers, symbol]);

  useEffect(() => {
    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  return <canvas ref={canvasRef} className="tradeCanvas" aria-label="Live candle trade chart" />;
}

function App() {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOLS[0]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [markers, setMarkers] = useState<TradeMarker[]>([]);
  const [runningPnl, setRunningPnl] = useState(0);
  const [apiOk, setApiOk] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("checking");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [runner, tradePayload] = await Promise.allSettled([
        fetchJson<LiveRunnerPayload>(endpoint("/demo/live-runner")),
        fetchJson<LiveTradesPayload>(endpoint("/demo/live-trades", { timeframe: TIMEFRAME })),
      ]);

      const nextDecisions = runner.status === "fulfilled" && Array.isArray(runner.value.decisions) ? runner.value.decisions : [];
      const nextTrades = tradePayload.status === "fulfilled" && Array.isArray(tradePayload.value.trades) ? tradePayload.value.trades : [];
      const nextMarkers = tradePayload.status === "fulfilled" && Array.isArray(tradePayload.value.markers) ? tradePayload.value.markers : [];
      const pnl = tradePayload.status === "fulfilled" && Number.isFinite(Number(tradePayload.value.running_pnl)) ? Number(tradePayload.value.running_pnl) : 0;

      setDecisions(nextDecisions);
      setTrades(nextTrades);
      setMarkers(nextMarkers);
      setRunningPnl(pnl);

      const preferred =
        nextTrades.find((t) => String(t.status || "open").toLowerCase() !== "closed")?.symbol ||
        nextDecisions.find((d) => d.approved)?.symbol ||
        symbol;
      if (preferred && preferred !== symbol) setSymbol(preferred);
    } catch {
      // Do not blank the page if one feed is temporarily unavailable.
    }
  }, [symbol]);

  const loadCandles = useCallback(async (activeSymbol: string) => {
    try {
      const payload = await fetchJson<CandlePayload>(
        endpoint("/demo/live-candles", { symbol: activeSymbol, timeframe: TIMEFRAME, limit: CANDLE_LIMIT })
      );
      const nextCandles = Array.isArray(payload.candles) ? payload.candles : [];
      if (!nextCandles.length) throw new Error("No candles returned");
      setCandles(nextCandles);
      setApiOk(true);
      setError("");
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setApiOk(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    loadCandles(symbol);
    const timer = window.setInterval(() => loadCandles(symbol), 8000);
    return () => window.clearInterval(timer);
  }, [loadCandles, symbol]);

  const symbols = useMemo(() => {
    const fromTrades = trades.map((trade) => trade.symbol).filter(Boolean);
    const fromDecisions = decisions.map((decision) => decision.symbol).filter(Boolean);
    return Array.from(new Set([...fromTrades, ...fromDecisions, ...DEFAULT_SYMBOLS])).slice(0, 12);
  }, [decisions, trades]);

  const activeTrade = trades.find((trade) => trade.symbol === symbol) || trades[0];
  const lastCandle = candles[candles.length - 1];
  const high = candles.length ? Math.max(...candles.map((c) => Number(c.high))) : null;
  const low = candles.length ? Math.min(...candles.map((c) => Number(c.low))) : null;
  const openTrades = trades.filter((trade) => String(trade.status || "open").toLowerCase() !== "closed");

  return (
    <main className="demoPage">
      <section className="heroStrip">
        <div>
          <p className="eyebrow">Fayt Systems</p>
          <h1>Live Execution Demo</h1>
        </div>
        <div className="statusPills">
          <span className={apiOk ? "pill good" : "pill warn"}>{apiOk ? "DB LIVE" : "CONNECTING"}</span>
          <span className="pill">Updated {lastUpdated}</span>
        </div>
      </section>

      <section className="boardGrid">
        <div className="chartCard">
          <div className="chartHeader">
            <div>
              <p className="eyebrow">Live 3D Trade Chart</p>
              <h2>Candle flow with entry and exit markers</h2>
            </div>
            <div className="symbolTabs" aria-label="Symbols">
              {symbols.map((s) => (
                <button key={s} className={s === symbol ? "active" : ""} onClick={() => setSymbol(s)} type="button">
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="statGrid">
            <div className="stat"><span>Symbol</span><strong>{symbol}</strong></div>
            <div className="stat"><span>Last</span><strong>{fmtPrice(lastCandle?.close)}</strong></div>
            <div className="stat"><span>High</span><strong>{fmtPrice(high)}</strong></div>
            <div className="stat"><span>Low</span><strong>{fmtPrice(low)}</strong></div>
          </div>

          <div className="canvasShell">
            {candles.length ? <CandleCanvas candles={candles} markers={markers} symbol={symbol} /> : null}
            {!candles.length ? <div className="emptyOverlay">Waiting for candle feed…</div> : null}
            {error ? <div className="errorOverlay">{error}</div> : null}
          </div>
        </div>

        <aside className="sideStack">
          <section className="pnlCard">
            <span>Running PnL</span>
            <strong className={runningPnl >= 0 ? "positive" : "negative"}>{fmtMoney(runningPnl)}</strong>
            <small>{openTrades.length} active trade{openTrades.length === 1 ? "" : "s"}</small>
          </section>

          <section className="liveTradesCard">
            <div className="panelTitle">
              <span>Live Trades</span>
              <strong>{openTrades.length || trades.length}</strong>
            </div>
            <div className="tradeTable">
              <div className="tradeRow head">
                <span>Symbol</span><span>Side</span><span>Target Exit</span><span>Current</span>
              </div>
              {(openTrades.length ? openTrades : trades).slice(0, 8).map((trade, idx) => (
                <div className="tradeRow" key={`${trade.symbol}-${trade.id ?? idx}`}>
                  <span className="symbolCell">{trade.symbol}</span>
                  <span className={`sideBadge ${normalizeSide(trade.side)}`}>{normalizeSide(trade.side).toUpperCase()}</span>
                  <span>{fmtPrice(trade.target_exit_price)}</span>
                  <span>{fmtPrice(trade.current_price)}</span>
                </div>
              ))}
              {!trades.length ? <div className="noTrades">No active public trade rows yet.</div> : null}
            </div>
          </section>

          <section className="activeTradeCard">
            <span>Focused Trade</span>
            <strong>{activeTrade?.symbol || symbol}</strong>
            <div className="miniRows">
              <div><span>Side</span><b>{activeTrade ? normalizeSide(activeTrade.side).toUpperCase() : "—"}</b></div>
              <div><span>Entry</span><b>{fmtPrice(activeTrade?.entry_price)}</b></div>
              <div><span>Target Exit</span><b>{fmtPrice(activeTrade?.target_exit_price)}</b></div>
              <div><span>Current</span><b>{fmtPrice(activeTrade?.current_price ?? lastCandle?.close)}</b></div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

export default App;
