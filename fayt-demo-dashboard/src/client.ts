// D:\CryptoTrader\fayt-demo-dashboard\src\client.ts

export type DemoTrade = {
  trade_id: string;
  symbol: string;
  side: "long" | "short" | "buy" | "sell" | "unknown";
  status: "open" | "closed" | "unknown";
  quantity: number;
  entry_price: number | null;
  current_price: number | null;
  exit_price: number | null;
  unrealized_pnl: number | null;
  realized_pnl: number | null;
  opened_at: string | null;
  closed_at: string | null;
  bucket_key: string | null;
  broker_name: string | null;
  notes: string | null;
};

export type DemoEquityPoint = {
  ts: string;
  equity: number;
  label: string | null;
};

export type DemoEvent = {
  ts: string;
  kind: string;
  message: string;
  payload: Record<string, unknown>;
};

export type DemoStatus = {
  mode: "paper" | "demo";
  db_path: string;
  db_exists: boolean;
  broker_name: string;
  starting_equity: number;
  open_trade_count: number;
  closed_trade_count: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_equity: number;
  win_rate: number;
  winners: number;
  losers: number;
  last_trade_ts: string | null;
  last_event_ts: string | null;
  db_mtime: string | null;
};

export type DemoSnapshot = {
  generated_at: string;
  status: DemoStatus;
  open_trades: DemoTrade[];
  closed_trades: DemoTrade[];
  equity: DemoEquityPoint[];
  events: DemoEvent[];
};

export type RiskProjectedClosedRow = {
  n: number;
  trade_id: string;
  symbol: string;
  side: string;
  closed_at: string | null;
  bucket_key: string | null;
  r_multiple: number;
  r_source: string;
  before_equity: number;
  risk_amount: number;
  projected_pnl: number;
  after_equity: number;
  drawdown_pct: number;
};

export type RiskProjectedOpenRow = {
  n: number;
  trade_id: string;
  symbol: string;
  side: string;
  opened_at: string | null;
  entry_price: number | null;
  current_price: number | null;
  bucket_key: string | null;
  live_r_multiple: number;
  r_source: string;
  risk_amount: number;
  live_projected_pnl: number;
};

export type RiskScenarioSummary = {
  account_size: number;
  risk_pct: number;
  risk_key: string;
  starting_equity: number;
  closed_equity: number;
  live_equity: number;
  closed_pnl: number;
  live_unrealized_pnl: number;
  total_live_pnl: number;
  closed_return_pct: number;
  live_return_pct: number;
  max_drawdown_pct: number;
  wins: number;
  losses: number;
  win_rate: number;
  best_trade: number;
  worst_trade: number;
  closed_trades_used: number;
  open_trades_used: number;
  account_blown: boolean;
};

export type RiskScenario = {
  risk_pct: number;
  risk_key: string;
  summary: RiskScenarioSummary;
  closed_rows: RiskProjectedClosedRow[];
  open_rows: RiskProjectedOpenRow[];
};

export type RiskAccountProjection = {
  account_size: number;
  scenarios: RiskScenario[];
};

export type RiskProjectionResponse = {
  generated_at: string;
  db_path: string;
  risk_levels: number[];
  account_sizes: number[];
  accounts: RiskAccountProjection[];
  overview: RiskScenarioSummary[];
  meta: {
    trade_rows_seen: number;
    closed_trades_projected: number;
    open_trades_projected: number;
    fallback_stop_pct: number;
    closed_exact_count: number;
    closed_fallback_count: number;
    closed_skipped_count: number;
    open_exact_count: number;
    open_fallback_count: number;
    open_skipped_count: number;
    disclaimer: string;
  };
};

const DEFAULT_API_BASE = "http://127.0.0.1:8111";

const RAW_API_BASE = String(import.meta.env.VITE_DEMO_API_BASE ?? DEFAULT_API_BASE).trim();

const API_BASE = RAW_API_BASE.replace(/\/+$/, "");

export function apiBase(): string {
  return API_BASE;
}

function buildUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export function getHealth(): Promise<{
  status: string;
  mode: string;
  db_exists: boolean;
  db_path: string;
}> {
  return fetchJson("/health");
}

export function getSnapshot(): Promise<DemoSnapshot> {
  return fetchJson("/demo/snapshot");
}

export function getStatus(): Promise<DemoStatus> {
  return fetchJson("/demo/status");
}

export function getRiskProjection(): Promise<RiskProjectionResponse> {
  return fetchJson("/demo/risk-projection?trade_limit=10000&row_limit=75");
}