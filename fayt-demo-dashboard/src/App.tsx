import { FormEvent, useEffect, useMemo, useState } from "react";
import "./styles.css";

type DemoStatus = {
  ok?: boolean;
  mode?: string;
  db_exists?: boolean;
  broker_name?: string;
  starting_equity?: number;
  total_equity?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  open_trade_count?: number;
  closed_trade_count?: number;
  win_rate?: number;
  winners?: number;
  losers?: number;
  last_trade_ts?: string | null;
  last_event_ts?: string | null;
  market_data_mode?: string;
  execution_mode?: string;
  orders_allowed?: boolean;
};

type DemoTrade = {
  id?: number;
  symbol?: string;
  side?: string;
  qty?: number;
  entry_price?: number;
  current_price?: number;
  opened_at?: string;
  status?: string;
  closed_at?: string | null;
  exit_price?: number | null;
  realized_pnl?: number | null;
  unrealized_pnl?: number | null;
  stop_loss?: number | null;
};

type DemoEvent = {
  id?: number;
  event_ts?: string;
  ts?: string;
  event_type?: string;
  kind?: string;
  message?: string;
  symbol?: string | null;
  payload_json?: string | null;
};

type BetaUser = {
  id: string;
  status: string;
  trial_type: string;
  trial_starts_at_ms?: number | null;
  trial_ends_at_ms?: number | null;
  real_money_ack: boolean;
  api_keys_local_ack: boolean;
  no_fayt_custody_ack: boolean;
  free_beta_ack: boolean;
  payments_enabled: boolean;
};

type BetaDashboardResponse = {
  ok: boolean;
  beta: {
    name: string;
    trial_type: string;
    payments_enabled: boolean;
    subscription_required_now: boolean;
    subscription_phase: string;
    trial_starts_at_ms?: number | null;
    trial_ends_at_ms?: number | null;
  };
  safety: Record<string, boolean>;
  launch_day_checklist: string[];
  local_env_template: {
    file_name: string;
    values: string[];
  };
};

type BetaStep = "signup" | "verify" | "dashboard";

const API_BASE = String(
  import.meta.env.VITE_DEMO_API_BASE || "https://demo-api.faytsystems.com",
).replace(/\/$/, "");

const TERMS_VERSION = "real_money_beta_v1_2026_05";

const PUBLIC_DEMO_WORDING =
  "Live Coinbase Advanced market data with simulated paper execution.";

const PUBLIC_MODE_WORDING =
  "Temporary paper activity mode is enabled for non-certified current-bucket testing.";

const RISK_CHECKPOINT = {
  currentOpenTradeRiskPct: "0.0273%",
  notionalPerTradePct: "about 1.25%",
  fiveTradeStopRiskPct: "about 0.1365%",
};

const proofMetrics = [
  { label: "Validated Paper Trades", value: "350" },
  { label: "Closed Paper Trades", value: "349" },
  { label: "Winning Trades", value: "345" },
  { label: "Simulated Closed PnL", value: "+$4,691.65" },
  { label: "Closed Win Rate", value: "98.85%" },
  { label: "Paper Return", value: "15.64%" },
];

const navItems = [
  ["Home", "#home"],
  ["Live Demo", "#live-demo"],
  ["Proof", "#proof"],
  ["Risk", "#risk"],
  ["Technology", "#technology"],
  ["Investor", "#investor"],
  ["Beta Users", "#beta"],
  ["Contact", "#contact"],
];

function numberOr(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function formatCurrency(value: unknown): string {
  const numeric = numberOr(value, 0);
  return numeric.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: unknown): string {
  const numeric = numberOr(value, 0);
  return `${numeric.toFixed(2)}%`;
}

function formatDate(ms?: number | null): string {
  if (!ms) return "Pending";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function cleanSymbol(symbol?: string | null): string {
  return symbol ? symbol.replace("/", "-") : "—";
}

async function apiJson<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: init?.credentials || "include",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

async function betaRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof data?.detail === "string"
        ? data.detail
        : data?.detail?.message || `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

function ScrollLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a className={className} href={href}>
      {children}
    </a>
  );
}

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "blue" | "green" | "gold" | "red";
}) {
  return (
    <div className={`metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="section-header">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function DemoKpiPanel({ status }: { status: DemoStatus | null }) {
  return (
    <div className="demo-kpi-grid">
      <MetricCard
        label="Public Demo/API"
        value={status?.db_exists ? "Live" : "Checking"}
        tone={status?.db_exists ? "green" : "blue"}
      />
      <MetricCard
        label="Execution"
        value={status?.broker_name || "paper_sim"}
        tone="gold"
      />
      <MetricCard
        label="Open Paper Trades"
        value={String(status?.open_trade_count ?? 0)}
        tone="blue"
      />
      <MetricCard
        label="Closed Paper Trades"
        value={String(status?.closed_trade_count ?? 0)}
        tone="blue"
      />
      <MetricCard
        label="Realized Paper PnL"
        value={formatCurrency(status?.realized_pnl)}
        tone={numberOr(status?.realized_pnl) >= 0 ? "green" : "red"}
      />
      <MetricCard
        label="Win Rate"
        value={formatPercent(status?.win_rate)}
        tone="gold"
      />
    </div>
  );
}

function TickerChart() {
  return (
    <div className="terminal-chart" aria-label="decorative terminal chart">
      <div className="chart-topline">
        <span>FAYT MARKET BOARD</span>
        <strong>BTC-USD / ETH-USD / SOL-USD / XRP-USD</strong>
      </div>
      <svg viewBox="0 0 900 330" role="img">
        <defs>
          <linearGradient id="lineA" x1="0" x2="1">
            <stop offset="0%" stopColor="#58d8ff" />
            <stop offset="50%" stopColor="#7caaff" />
            <stop offset="100%" stopColor="#ffd66e" />
          </linearGradient>
          <linearGradient id="areaA" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(88,216,255,.34)" />
            <stop offset="100%" stopColor="rgba(88,216,255,0)" />
          </linearGradient>
        </defs>

        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`h-${i}`} x1="30" x2="870" y1={40 + i * 48} y2={40 + i * 48} className="grid-line" />
        ))}
        {Array.from({ length: 7 }).map((_, i) => (
          <line key={`v-${i}`} y1="30" y2="300" x1={60 + i * 125} x2={60 + i * 125} className="grid-line faint" />
        ))}

        <path
          className="chart-area"
          d="M 40 252 C 110 224, 145 210, 210 218 C 280 228, 310 152, 390 160 C 465 166, 490 94, 560 116 C 650 144, 680 62, 760 86 C 812 102, 836 74, 860 58 L 860 300 L 40 300 Z"
        />
        <path
          className="chart-line"
          d="M 40 252 C 110 224, 145 210, 210 218 C 280 228, 310 152, 390 160 C 465 166, 490 94, 560 116 C 650 144, 680 62, 760 86 C 812 102, 836 74, 860 58"
        />
        <circle cx="860" cy="58" r="7" className="chart-pulse" />
      </svg>
    </div>
  );
}

function LiveEventList({ events }: { events: DemoEvent[] }) {
  const visible = events.slice(0, 5);

  return (
    <div className="event-list">
      {visible.length ? (
        visible.map((event, index) => (
          <div className="event-row" key={`${event.id || index}-${event.event_ts || event.ts}`}>
            <span>{event.event_ts || event.ts || "live"}</span>
            <strong>{cleanSymbol(event.symbol)}</strong>
            <p>{event.message || event.event_type || event.kind || "Runner event received"}</p>
          </div>
        ))
      ) : (
        <div className="event-empty">Waiting for live runner events from the demo API.</div>
      )}
    </div>
  );
}

function TradePreview({ trades }: { trades: DemoTrade[] }) {
  const visible = trades.slice(0, 4);

  return (
    <div className="trade-preview">
      {visible.length ? (
        visible.map((trade, index) => (
          <div className="trade-row" key={`${trade.id || index}-${trade.symbol}`}>
            <span>{cleanSymbol(trade.symbol)}</span>
            <strong className={String(trade.side || "").toLowerCase().includes("sell") ? "red-text" : "green-text"}>
              {String(trade.side || "paper").toUpperCase()}
            </strong>
            <em>{trade.entry_price ? formatCurrency(trade.entry_price) : "—"}</em>
            <small>{trade.status || "open"}</small>
          </div>
        ))
      ) : (
        <div className="event-empty">No open paper trades returned yet.</div>
      )}
    </div>
  );
}

function BetaSignupPortal() {
  const [step, setStep] = useState<BetaStep>("signup");
  const [email, setEmail] = useState(() => localStorage.getItem("fayt_beta_email") || "");
  const [code, setCode] = useState("");
  const [realMoneyAck, setRealMoneyAck] = useState(false);
  const [localKeysAck, setLocalKeysAck] = useState(false);
  const [custodyAck, setCustodyAck] = useState(false);
  const [freeAck, setFreeAck] = useState(false);
  const [message, setMessage] = useState("");
  const [devCode, setDevCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<BetaUser | null>(null);
  const [dashboard, setDashboard] = useState<BetaDashboardResponse | null>(null);

  useEffect(() => {
    if (email) localStorage.setItem("fayt_beta_email", email);
  }, [email]);

  useEffect(() => {
    betaRequest<{ ok: boolean; authenticated: boolean; user: BetaUser }>("/beta/session")
      .then((session) => {
        setUser(session.user);
        setStep("dashboard");
        return betaRequest<BetaDashboardResponse>("/beta/dashboard");
      })
      .then(setDashboard)
      .catch(() => {
        setStep(email ? "verify" : "signup");
      });
  }, []);

  async function submitSignup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setDevCode("");

    try {
      const response = await betaRequest<Record<string, unknown>>("/beta/signup", {
        method: "POST",
        body: JSON.stringify({
          email,
          real_money_ack: realMoneyAck,
          api_keys_local_ack: localKeysAck,
          no_fayt_custody_ack: custodyAck,
          free_beta_ack: freeAck,
          terms_version: TERMS_VERSION,
        }),
      });

      setMessage(String(response.message || "Verification code sent."));
      if (typeof response.dev_code === "string") setDevCode(response.dev_code);
      setStep("verify");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send verification code.");
    } finally {
      setBusy(false);
    }
  }

  async function submitVerify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const response = await betaRequest<{ ok: boolean; user: BetaUser }>("/beta/verify", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });

      const betaDash = await betaRequest<BetaDashboardResponse>("/beta/dashboard");
      setUser(response.user);
      setDashboard(betaDash);
      setStep("dashboard");
      setMessage("Email verified. Beta dashboard unlocked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to verify code.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await betaRequest<{ ok: boolean }>("/beta/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => null);

    setUser(null);
    setDashboard(null);
    setCode("");
    setStep("signup");
  }

  const canSignup = email && realMoneyAck && localKeysAck && custodyAck && freeAck && !busy;
  const envValues =
    dashboard?.local_env_template?.values || [
      "COINBASE_ADVANCED_API_KEY=your_key_here",
      "COINBASE_ADVANCED_API_SECRET=your_secret_here",
      "COINBASE_ADVANCED_PASSPHRASE=your_passphrase_here",
      "COINBASE_ADVANCED_ORDERS_ALLOWED=false",
      "FAYT_BETA_MAX_OPEN_TRADES=1",
      "FAYT_BETA_MAX_NOTIONAL_PCT=5",
      "FAYT_BETA_DAILY_LOSS_LIMIT_PCT=2",
    ];

  return (
    <div className="beta-portal">
      {step === "signup" ? (
        <form className="beta-panel" onSubmit={submitSignup}>
          <p className="eyebrow">Beta User Access / 30-Day Free Trial</p>
          <h3>Verify email access before the real-money beta dashboard opens.</h3>
          <p>
            Beta users trade with their own Coinbase Advanced account and their own funds.
            Fayt does not custody funds, does not collect payment for the first beta, and does not
            ask users to upload Coinbase API secrets.
          </p>

          <label className="field">
            Email address
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={realMoneyAck}
              onChange={(event) => setRealMoneyAck(event.target.checked)}
            />
            <span>I understand this real-money beta may trade with my own funds and losses are possible.</span>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={localKeysAck}
              onChange={(event) => setLocalKeysAck(event.target.checked)}
            />
            <span>I understand Coinbase API secrets must stay local on my own computer and must not be uploaded.</span>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={custodyAck}
              onChange={(event) => setCustodyAck(event.target.checked)}
            />
            <span>I understand Fayt does not custody my funds. My assets stay in my Coinbase account.</span>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={freeAck}
              onChange={(event) => setFreeAck(event.target.checked)}
            />
            <span>I understand the first beta is free for 30 days and no payment is required now.</span>
          </label>

          <button className="primary-btn" disabled={!canSignup}>
            {busy ? "Sending Verification Code..." : "Send Verification Code"}
          </button>

          {message ? <p className="form-message">{message}</p> : null}
          {devCode ? <p className="dev-code">Local dev code: {devCode}</p> : null}
        </form>
      ) : null}

      {step === "verify" ? (
        <form className="beta-panel" onSubmit={submitVerify}>
          <p className="eyebrow">Email Verification</p>
          <h3>Enter the 6-digit verification code.</h3>
          <p>
            A verification code was sent to <strong>{email}</strong>. Enter it below to unlock the
            protected beta dashboard page.
          </p>

          <label className="field">
            Verification code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            />
          </label>

          <button className="primary-btn" disabled={busy || code.length !== 6}>
            {busy ? "Verifying..." : "Verify Email"}
          </button>

          <button type="button" className="secondary-btn" onClick={() => setStep("signup")}>
            Change Email / Resend Code
          </button>

          {message ? <p className="form-message">{message}</p> : null}
        </form>
      ) : null}

      {step === "dashboard" ? (
        <div className="beta-dashboard">
          <div className="beta-panel wide">
            <p className="eyebrow">Protected Beta Dashboard</p>
            <h3>Real-money beta access verified.</h3>
            <p>
              This beta dashboard confirms email access only. It does not collect or store Coinbase
              API secrets. Launch-day credentials stay local on the user’s own computer.
            </p>

            <div className="mini-stat-grid">
              <MetricCard label="Status" value={user?.status || "verified"} tone="green" />
              <MetricCard label="Trial" value="Free 30 Days" tone="gold" />
              <MetricCard label="Payments" value="Disabled" tone="blue" />
              <MetricCard label="API Secrets" value="Not Collected" tone="green" />
              <MetricCard label="Trial Start" value={formatDate(user?.trial_starts_at_ms)} tone="blue" />
              <MetricCard label="Trial Ends" value={formatDate(user?.trial_ends_at_ms)} tone="gold" />
            </div>

            <button className="secondary-btn" onClick={logout}>
              Log Out
            </button>
          </div>

          <div className="beta-panel">
            <p className="eyebrow">Launch-Day Checklist</p>
            <ol className="launch-list">
              {(dashboard?.launch_day_checklist || [
                "Confirm your Coinbase Advanced account.",
                "Enable two-factor authentication.",
                "Create the API key only when beta launch instructions are provided.",
                "Do not upload your API secret to Fayt’s website.",
                "Store credentials locally on your own computer.",
                "Keep live orders disabled until launch-day checks pass.",
              ]).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>

          <div className="beta-panel">
            <p className="eyebrow">Local Credential File</p>
            <h3>Do not upload this file.</h3>
            <pre className="code-box">{envValues.join("\n")}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}



// FAYT_DEMO_LIVE_RUNNER_SIG300_COMPONENT_BEGIN
type Sig300PublicDecision = {
  symbol: string;
  approved: boolean;
  denied: boolean;
};

type Sig300PublicPayload = {
  ok?: boolean;
  count?: number;
  approved_count?: number;
  denied_count?: number;
  decisions?: Sig300PublicDecision[];
};

function LiveRunnerSig300Panel() {
  const [rows, setRows] = useState<Sig300PublicDecision[]>([]);
  const [loadedAt, setLoadedAt] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function loadLiveRunner() {
      try {
        const payload = await apiJson<Sig300PublicPayload>("/demo/live-runner", { decisions: [] });
        if (cancelled) return;
        setRows(Array.isArray(payload.decisions) ? payload.decisions : []);
        setLoadedAt(new Date().toLocaleTimeString());
        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    loadLiveRunner();
    const timer = window.setInterval(loadLiveRunner, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const approvedCount = rows.filter((row) => row.approved).length;
  const deniedCount = rows.filter((row) => row.denied).length;

  return (
    <section className="liveRunnerSig300Panel" aria-label="Live runner SIG300 approvals">
      <div className="liveRunnerSig300Header">
        <div>
          <p className="eyebrow">Live Runner Gate</p>
          <h2>Symbol approval board</h2>
          <p className="mutedText">Public pass/fail view from the active paper live-runner.</p>
        </div>
        <div className="liveRunnerSig300Stats" aria-label="Live runner approval counts">
          <span><strong>{approvedCount}</strong> Approved</span>
          <span><strong>{deniedCount}</strong> Denied</span>
        </div>
      </div>

      {error ? <div className="liveRunnerSig300Error">Live-runner feed unavailable.</div> : null}

      <div className="liveRunnerSig300Grid">
        {rows.map((row) => (
          <div className="liveRunnerSig300Row" key={row.symbol}>
            <span className="liveRunnerSig300Symbol">{row.symbol}</span>
            <span className={row.approved ? "liveRunnerSig300Badge approved" : "liveRunnerSig300Badge muted"}>
              {row.approved ? "Approved" : ""}
            </span>
            <span className={row.denied ? "liveRunnerSig300Badge denied" : "liveRunnerSig300Badge muted"}>
              {row.denied ? "Denied" : ""}
            </span>
          </div>
        ))}
      </div>

      <p className="liveRunnerSig300Updated">Updated {loadedAt || "checking"}</p>
    </section>
  );
}
// FAYT_DEMO_LIVE_RUNNER_SIG300_COMPONENT_END

function App() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [openTrades, setOpenTrades] = useState<DemoTrade[]>([]);
  const [apiError, setApiError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [statusResponse, eventResponse, tradeResponse] = await Promise.all([
          apiJson<DemoStatus>("/demo/status", {}),
          apiJson<DemoEvent[]>("/demo/events?limit=12", []),
          apiJson<DemoTrade[]>("/demo/open-trades?limit=8", []),
        ]);

        if (!active) return;

        setStatus(statusResponse);
        setEvents(Array.isArray(eventResponse) ? eventResponse : []);
        setOpenTrades(Array.isArray(tradeResponse) ? tradeResponse : []);
        setApiError("");
      } catch (error) {
        if (!active) return;
        setApiError(error instanceof Error ? error.message : "Unable to reach public demo API.");
      }
    }

    load();
    const timer = window.setInterval(load, 6000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const systemState = useMemo(() => {
    const live = Boolean(status?.db_exists || status?.ok);
    const ordersAllowed = Boolean(status?.orders_allowed);

    return {
      live,
      ordersAllowed,
      totalEquity: formatCurrency(status?.total_equity),
      realizedPnl: formatCurrency(status?.realized_pnl),
      winRate: formatPercent(status?.win_rate),
      openTradeCount: String(status?.open_trade_count ?? 0),
      closedTradeCount: String(status?.closed_trade_count ?? 0),
    };
  }, [status]);

  return (
    <main className="site-shell">
      <div className="ambient-glow one" />
      <div className="ambient-glow two" />

      <header className="top-nav">
        <a className="brand-mark" href="#home" aria-label="Fayt Systems home">
          <span className="crest">FS</span>
          <span>
            <strong>FAYT SYSTEMS</strong>
            <small>Execution Intelligence</small>
          </span>
        </a>

        <nav className="desktop-nav" aria-label="Primary navigation">
          {navItems.map(([label, href]) => (
            <ScrollLink key={href} href={href}>
              {label}
            </ScrollLink>
          ))}
        </nav>

        <div className="nav-actions">
          <ScrollLink href="#live-demo" className="nav-demo">
            View Live Demo
          </ScrollLink>
          <ScrollLink href="#beta" className="nav-beta">
            Join Beta
          </ScrollLink>
        </div>
      </header>

      <section className="hero-section" id="home">
        <div className="hero-copy">
          <p className="eyebrow">Fayt Systems / Certified Execution Intelligence</p>
          <h1>Digital asset execution infrastructure built for proof, discipline, and real-time transparency.</h1>
          <p className="hero-lede">
            Fayt Systems is building a high-integrity execution intelligence platform for digital
            asset markets — combining live market data, risk controls, paper-sim validation, audit
            trails, and boardroom-ready telemetry into one disciplined operating layer.
          </p>

          <div className="compliance-banner">
            <strong>{PUBLIC_DEMO_WORDING}</strong>
            <span>{PUBLIC_MODE_WORDING}</span>
          </div>

          <div className="hero-actions">
            <ScrollLink href="#live-demo" className="primary-btn">
              View Live Demo
            </ScrollLink>
            <ScrollLink href="#beta" className="secondary-btn">
              Join Beta Launch
            </ScrollLink>
            <ScrollLink href="#investor" className="ghost-btn">
              Investor Snapshot
            </ScrollLink>
          </div>
        </div>

        <div className="hero-visual">
          <TickerChart />
          <div className="live-status-card">
            <span className={systemState.live ? "status-dot green" : "status-dot blue"} />
            <div>
              <strong>{systemState.live ? "Public demo/API live" : "Checking public API"}</strong>
              <p>Cloudflare-delivered live dashboard telemetry.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="trust-strip">
        <div>Read-only public dashboard</div>
        <div>Live market data feed</div>
        <div>Simulated paper execution</div>
        <div>Real Coinbase orders disabled</div>
        <div>Risk checkpoint visible</div>
        <div>Cloudflare-powered access</div>
      </section>

      <section className="content-section" id="live-demo">
        <SectionHeader
          eyebrow="Live Demo / Public Read-Only Telemetry"
          title="Watch Fayt Systems operate in real time."
          body="The public demo displays live dashboard telemetry from the Fayt paper-sim environment: account status, open paper trades, closed paper trades, equity movement, runner events, market-board activity, and risk projections."
        />

        {apiError ? <div className="api-warning">{apiError}</div> : null}

        <DemoKpiPanel status={status} />

        <div className="dashboard-layout">
          <div className="panel large-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Equity / Paper Telemetry</p>
                <h3>{systemState.totalEquity}</h3>
              </div>
              <span>{status?.mode || "paper"}</span>
            </div>
            <TickerChart />
          </div>

          <div className="panel">
            <p className="eyebrow">Risk Checkpoint</p>
            <div className="risk-list">
              <div>
                <span>Current open trade risk</span>
                <strong>{RISK_CHECKPOINT.currentOpenTradeRiskPct}</strong>
              </div>
              <div>
                <span>Notional per trade</span>
                <strong>{RISK_CHECKPOINT.notionalPerTradePct}</strong>
              </div>
              <div>
                <span>Estimated 5-trade total stop-risk</span>
                <strong>{RISK_CHECKPOINT.fiveTradeStopRiskPct}</strong>
              </div>
            </div>
          </div>

          <div className="panel">
            <p className="eyebrow">Open Paper Trades</p>
            <TradePreview trades={openTrades} />
          </div>

          <div className="panel">
            <p className="eyebrow">Runner Events</p>
            <LiveEventList events={events} />
          </div>
        </div>
      </section>

      <section className="content-section" id="proof">
        <SectionHeader
          eyebrow="Proof Layer / Auditable Validation"
          title="Performance claims should be inspectable."
          body="Fayt’s proof layer is designed to show what happened, where it came from, and which guardrails were active. The goal is not to hide behind a black box. The goal is to build execution infrastructure that can be reviewed."
        />

        <div className="proof-grid">
          <div className="proof-visual">
            <img src="/og-fayt-demo.png" alt="Fayt Systems proof dashboard preview" />
          </div>

          <div className="proof-copy">
            <div className="proof-metrics">
              {proofMetrics.map((metric) => (
                <MetricCard key={metric.label} label={metric.label} value={metric.value} tone="gold" />
              ))}
            </div>

            <div className="panel proof-note">
              <p className="eyebrow">Guardrail Context</p>
              <p>
                All trades came from one certified bucket. No trades opened outside the certified
                allowlist. Audit result: ok=True. Bucket: side=short | tf=60m | trend=up | vol=high
                | mom=flat.
              </p>
              <small>
                Paper-sim architecture validation only. Not live broker performance. Not financial
                advice. Automated trading involves risk.
              </small>
            </div>
          </div>
        </div>
      </section>

      <section className="content-section" id="risk">
        <SectionHeader
          eyebrow="Risk Architecture / Control Before Scale"
          title="The system is built around risk first."
          body="Fayt is designed to make risk visible before execution. Position sizing, open-trade limits, stop-risk estimates, symbol tracking, and order-permission boundaries are displayed as part of the product experience."
        />

        <div className="card-grid four">
          {[
            ["Position Sizing", "Trade size is controlled before the system enters a position."],
            ["Open Trade Limit", "The public demo target is capped at 5 open paper trades."],
            ["Stop-Risk Visibility", "Current open trade risk and estimated multi-trade risk are displayed."],
            ["Execution Boundary", "The public demo is read-only and paper-simulated."],
            ["Kill-Switch Philosophy", "Fayt prioritizes shutdown conditions, daily loss controls, and supervision before scale."],
            ["No Public Trade Controls", "The website should not expose broker execution or customer API secret collection."],
          ].map(([title, body]) => (
            <div className="feature-card" key={title}>
              <span>◇</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="content-section" id="technology">
        <SectionHeader
          eyebrow="Technology / Execution Intelligence Stack"
          title="From market data to decision evidence."
          body="Fayt Systems is building an execution intelligence stack that connects market data, signal evaluation, risk gating, paper execution, audit logging, and live dashboard telemetry."
        />

        <div className="architecture-flow">
          {[
            ["01", "Market Data", "Coinbase Advanced live market data feeds the public demo environment."],
            ["02", "Signal Layer", "The engine evaluates market behavior, symbol context, and event conditions."],
            ["03", "Bucket Intelligence", "Validated conditions are organized into structured buckets for deployment review."],
            ["04", "Risk Gate", "Position sizing, allowlists, limits, and constraints are checked before action."],
            ["05", "Paper Execution", "The public demo uses simulated paper execution only."],
            ["06", "Audit + Telemetry", "Trades, events, equity, and market-board data are surfaced through read-only APIs."],
          ].map(([num, title, body]) => (
            <div className="flow-node" key={num}>
              <span>{num}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="content-section investor-section" id="investor">
        <SectionHeader
          eyebrow="Investor Snapshot / Boardroom Brief"
          title="A disciplined execution intelligence company for digital asset markets."
          body="Fayt Systems is building infrastructure for transparent digital asset execution: live market observation, structured signal processing, risk-controlled paper simulation, proof-oriented dashboards, and beta-ready user workflows."
        />

        <div className="investor-grid">
          <div className="panel">
            <p className="eyebrow">Problem</p>
            <h3>Fragmented tools create weak evidence.</h3>
            <p>
              Digital asset traders and early-stage funds often rely on exchange dashboards,
              spreadsheets, screenshots, and opaque bots. The result is limited visibility,
              inconsistent risk governance, and weak proof.
            </p>
          </div>

          <div className="panel">
            <p className="eyebrow">Solution</p>
            <h3>Unify intelligence, controls, and proof.</h3>
            <p>
              Fayt unifies signal intelligence, risk controls, paper execution, public telemetry,
              and proof reporting into a single operating layer.
            </p>
          </div>

          <div className="panel">
            <p className="eyebrow">Traction Signals</p>
            <ul className="clean-list">
              <li>Public demo/API live</li>
              <li>Cloudflare-powered public dashboard</li>
              <li>25-symbol runner target</li>
              <li>Max 5 open paper trades</li>
              <li>Risk checkpoint visible</li>
              <li>Beta launch workflow in progress</li>
            </ul>
          </div>

          <div className="panel">
            <p className="eyebrow">Roadmap</p>
            <ul className="clean-list">
              <li>Public demo and proof dashboard</li>
              <li>Beta user onboarding and local agent workflow</li>
              <li>Expanded risk analytics and reporting</li>
              <li>Certified strategy cohorts</li>
              <li>Institutional reporting and audit exports</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="content-section beta-section" id="beta">
        <SectionHeader
          eyebrow="Beta User Launch / Verified Access"
          title="Join the Fayt beta and prepare for launch day."
          body="The initial beta is a free 30-day real-money trial. Users fund and control their own Coinbase Advanced account. Fayt does not custody funds and the website does not collect Coinbase API secrets."
        />

        <BetaSignupPortal />
      </section>

      <section className="content-section contact-section" id="contact">
        <div className="contact-card">
          <div>
            <p className="eyebrow">Contact / Access</p>
            <h2>Build the beta carefully. Scale only after proof.</h2>
            <p>
              Fayt’s public demo remains paper-simulated. Real-money beta access should be gated,
              verified, documented, and controlled through local customer-side execution agents.
            </p>
          </div>

          <div className="contact-actions">
            <a className="primary-btn" href="mailto:gopackgo4ever2022@gmail.com?subject=Fayt%20Systems%20Beta%20Access">
              Request Beta Access
            </a>
            <ScrollLink href="#live-demo" className="secondary-btn">
              Review Live Demo
            </ScrollLink>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div>
          <strong>Fayt Systems</strong>
          <span>Institutional framework. Disciplined execution. Transparent outcomes.</span>
        </div>
        <p>
          Public demo uses live Coinbase Advanced market data with simulated paper execution.
          Real Coinbase orders are disabled in the public demo. Beta trading involves real risk and
          should be reviewed with appropriate legal/compliance guidance before launch.
        </p>
      </footer>
    
        <LiveRunnerSig300Panel />
</main>
  );
}

export default App;