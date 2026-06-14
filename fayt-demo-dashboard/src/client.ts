// D:\CryptoTrader\fayt-demo-dashboard\src\client.ts

export function apiBase(): string {
  return String(import.meta.env.VITE_DEMO_API_BASE || "").replace(/\/$/, "");
}

export type DemoStatus = {
  mode: string;
  db_path?: string;
  db_exists: boolean;
  broker_name: string;
  starting_equity: number;
  total_equity: number;
  realized_pnl: number;
  unrealized_pnl: number;
  open_trade_count: number;
  closed_trade_count: number;
  win_rate: number;
  winners?: number;
  losers?: number;
  last_trade_ts?: string | null;
  last_event_ts?: string | null;
  db_mtime?: string | null;
  account_name?: string;
  execution_mode?: string;
  market_data_mode?: string;
  orders_allowed?: boolean;
};

export type DemoTrade = {
  id?: number;
  trade_id?: string;
  symbol: string;
  side: string;
  qty?: number;
  quantity?: number;
  entry_price: number;
  current_price?: number | null;
  opened_at: string;
  status: string;
  closed_at?: string | null;
  exit_price?: number | null;
  realized_pnl?: number | null;
  unrealized_pnl?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  learned_bucket_id?: number | null;
  bucket_key?: string | null;
  broker_name?: string | null;
  notes?: string | null;
};

export type EquityPoint = {
  ts: string;
  equity: number;
  label?: string | null;
};

export type DemoEvent = {
  id?: number;
  event_ts?: string;
  ts?: string;
  event_type?: string;
  kind?: string;
  message?: string;
  symbol?: string | null;
  payload_json?: string | null;
  payload?: Record<string, unknown>;
};

export type MarketCandle = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketTradeMarker = {
  id: number;
  symbol: string;
  side: string;
  qty: number;
  status: string;
  entry_price: number;
  exit_price?: number | null;
  target_exit_price?: number | null;
  stop_loss?: number | null;
  entry_ts: string;
  exit_ts?: string | null;
};

export type MarketBoardSymbol = {
  symbol: string;
  last_price: number;
  change: number;
  pct_change: number;
  high: number;
  low: number;
  volume: number;
  candles: MarketCandle[];
  markers: MarketTradeMarker[];
};

export type MarketBoardResponse = {
  as_of: string;
  timeframe: string;
  symbols: MarketBoardSymbol[];
};

export type DemoSnapshot = {
  generated_at?: string;
  status: DemoStatus;
  open_trades: DemoTrade[];
  closed_trades: DemoTrade[];
  equity: EquityPoint[];
  events: DemoEvent[];
  market_board?: MarketBoardResponse;
};

export type DashboardBundle = {
  status: DemoStatus;
  openTrades: DemoTrade[];
  closedTrades: DemoTrade[];
  equity: EquityPoint[];
  events: DemoEvent[];
  marketBoard: MarketBoardResponse;
};

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export function emptyMarketBoard(): MarketBoardResponse {
  return {
    as_of: new Date().toISOString(),
    timeframe: "1m",
    symbols: [],
  };
}

export function emptyStatus(): DemoStatus {
  return {
    mode: "paper",
    broker_name: "paper_sim",
    db_exists: false,
    starting_equity: 1000,
    total_equity: 1000,
    realized_pnl: 0,
    unrealized_pnl: 0,
    open_trade_count: 0,
    closed_trade_count: 0,
    win_rate: 0,
    winners: 0,
    losers: 0,
  };
}

export function normalizeSnapshot(snapshot: DemoSnapshot): DashboardBundle {
  return {
    status: snapshot.status ?? emptyStatus(),
    openTrades: snapshot.open_trades ?? [],
    closedTrades: snapshot.closed_trades ?? [],
    equity: snapshot.equity ?? [],
    events: snapshot.events ?? [],
    marketBoard: snapshot.market_board ?? emptyMarketBoard(),
  };
}

export async function fetchStatus(): Promise<DemoStatus> {
  return fetchJson<DemoStatus>("/demo/status", emptyStatus());
}

export async function fetchOpenTrades(): Promise<DemoTrade[]> {
  return fetchJson<DemoTrade[]>("/demo/open-trades", []);
}

export async function fetchClosedTrades(): Promise<DemoTrade[]> {
  return fetchJson<DemoTrade[]>("/demo/closed-trades", []);
}

export async function fetchEquity(): Promise<EquityPoint[]> {
  return fetchJson<EquityPoint[]>("/demo/equity", []);
}

export async function fetchEvents(): Promise<DemoEvent[]> {
  return fetchJson<DemoEvent[]>("/demo/events", []);
}

export async function fetchMarketBoard(): Promise<MarketBoardResponse> {
  return fetchJson<MarketBoardResponse>("/demo/market-board", emptyMarketBoard());
}

export async function fetchSnapshot(): Promise<DemoSnapshot> {
  return fetchJson<DemoSnapshot>("/demo/snapshot", {
    generated_at: new Date().toISOString(),
    status: emptyStatus(),
    open_trades: [],
    closed_trades: [],
    equity: [],
    events: [],
    market_board: emptyMarketBoard(),
  });
}

export async function fetchDashboardBundle(): Promise<DashboardBundle> {
  const snapshot = await fetchSnapshot();

  if (snapshot?.status) {
    return normalizeSnapshot(snapshot);
  }

  const [status, openTrades, closedTrades, equity, events, marketBoard] = await Promise.all([
    fetchStatus(),
    fetchOpenTrades(),
    fetchClosedTrades(),
    fetchEquity(),
    fetchEvents(),
    fetchMarketBoard(),
  ]);

  return {
    status,
    openTrades,
    closedTrades,
    equity,
    events,
    marketBoard,
  };
}

// FAYT_DEMO_LIVE_RUNNER_SIG300_TYPES_BEGIN
export type Sig300PublicDecision = { symbol: string; approved: boolean; denied: boolean; };
export type Sig300PublicStatus = { ok?: boolean; source?: string; count?: number; approved_count?: number; denied_count?: number; decisions?: Sig300PublicDecision[]; };
// FAYT_DEMO_LIVE_RUNNER_SIG300_TYPES_END

