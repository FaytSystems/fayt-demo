(function () {
  "use strict";

  const DEFAULT_SYMBOLS = [
    "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "ZEC/USD", "DOGE/USD",
    "PAXG/USD", "ONDO/USD", "ADA/USD", "LINK/USD", "HBAR/USD", "NEAR/USD",
    "DOT/USD", "BCH/USD", "AAVE/USD", "AVAX/USD", "LTC/USD", "ENA/USD",
    "SHIB/USD", "PEPE/USD", "WLD/USD", "XLM/USD"
  ];

  const TAKE_PROFIT_BPS = 35;
  const POLL_MS = 5000;
  const params = new URLSearchParams(window.location.search);
  const API_BASE = (params.get("api") || (
    ["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? "http://127.0.0.1:8100"
      : "https://demo-api.faytsystems.com"
  )).replace(/\/$/, "");

  const state = {
    activeSymbol: params.get("symbol") || "BTC/USD",
    userPickedSymbol: Boolean(params.get("symbol")),
    symbols: DEFAULT_SYMBOLS.slice(),
    trades: [],
    candles: [],
    equity: [],
    summary: {},
    fetchCount: 0,
    firstRender: true,
    previousMetrics: new Map(),
    previousTradeResults: new Map(),
    previousTradePnl: new Map()
  };

  function $(id) {
    return document.getElementById(id);
  }

  function number(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : (fallback || 0);
  }

  function money(value) {
    const n = number(value, 0);
    const sign = n > 0 ? "+" : n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function price(value) {
    if (value === null || value === undefined || value === "") return "-";
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "-";
    return n.toLocaleString(undefined, {
      minimumFractionDigits: n < 1 ? 4 : 2,
      maximumFractionDigits: n < 1 ? 7 : 2
    });
  }

  function timeLabel(value) {
    const d = new Date(value || 0);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function baseFromSymbol(symbol) {
    let raw = String(symbol || "").trim().toUpperCase();
    if (!raw) return "";
    raw = raw.replace("-PERP-INTX", "");
    if (raw.includes("/")) raw = raw.split("/")[0];
    if (raw.includes("-")) raw = raw.split("-")[0];
    if (raw === "1000SHIB") return "SHIB";
    if (raw === "1000PEPE") return "PEPE";
    return raw;
  }

  function displaySymbol(symbol) {
    const base = baseFromSymbol(symbol);
    return base ? base + "/USD" : "BTC/USD";
  }

  function sideLabel(value) {
    const s = String(value || "").toLowerCase();
    if (s.includes("short") || s === "sell") return "Short";
    if (s.includes("long") || s === "buy") return "Long";
    return value ? String(value) : "-";
  }

  function statusLabel(value) {
    return String(value || "OPEN").toUpperCase();
  }

  function resultLabel(trade) {
    const raw = String(trade.result || "").toUpperCase();
    if (raw === "WIN" || raw === "LOSS" || raw === "FLAT" || raw === "OPEN") return raw;
    const pnl = number(trade.pnl_usd || trade.pnl || 0, 0);
    const status = statusLabel(trade.status);
    if (status === "OPEN") return pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "OPEN";
    return pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "FLAT";
  }

  function targetExitPrice(trade) {
    const explicit = trade.target_exit_price || trade.target_price || trade.take_profit_price;
    if (explicit) return number(explicit, null);
    const entry = number(trade.entry_price, 0);
    if (!entry) return null;
    const closeReason = String(trade.close_reason || "");
    const match = closeReason.match(/take_profit_([0-9.]+)_bps/i);
    const bps = match ? number(match[1], TAKE_PROFIT_BPS) : TAKE_PROFIT_BPS;
    const direction = String(trade.direction || trade.side || "").toLowerCase();
    const factor = bps / 10000;
    return direction.includes("short") ? entry * (1 - factor) : entry * (1 + factor);
  }

  function normalizeTrade(raw) {
    const display = displaySymbol(raw.symbol || raw.product_id || raw.base_symbol);
    const status = statusLabel(raw.status);
    const pnl = number(raw.pnl_usd ?? raw.pnl ?? raw.realized_pnl_usd ?? raw.unrealized_pnl_usd, 0);
    const closePrice = number(raw.close_price ?? raw.exit_price, 0);
    const markPrice = number(raw.mark_price ?? raw.current_price, 0);
    const exitOrMark = closePrice || markPrice || null;
    return {
      id: String(raw.trade_id || raw.id || raw.client_order_id || display + "-" + (raw.opened_at || raw.updated_at || "")),
      symbol: display,
      productId: raw.product_id || raw.symbol || display,
      side: sideLabel(raw.side || raw.direction),
      status,
      result: resultLabel(raw),
      entryPrice: number(raw.entry_price, 0) || null,
      targetExitPrice: targetExitPrice(raw),
      exitPrice: closePrice || null,
      markPrice: markPrice || null,
      exitOrMark,
      pnl,
      pnlPct: number(raw.pnl_pct, 0),
      notional: number(raw.notional_usd, 0),
      leverage: number(raw.leverage, 1),
      openedAt: raw.opened_at || raw.opened_ts_utc || raw.created_ts_utc,
      updatedAt: raw.updated_at || raw.updated_ts_utc || raw.closed_at || raw.closed_ts_utc || raw.opened_at,
      closedAt: raw.closed_at || raw.closed_ts_utc,
      raw
    };
  }

  async function getJson(path) {
    const response = await fetch(API_BASE + path, { cache: "no-store" });
    if (!response.ok) throw new Error(path + " returned " + response.status);
    return response.json();
  }

  function setStatus(label, ok) {
    const el = $("statusPill");
    el.textContent = label;
    el.classList.toggle("live", Boolean(ok));
    el.classList.toggle("warn", !ok);
  }

  function animateMetric(id, nextValue, formatter, kind) {
    const el = $(id);
    const previous = state.previousMetrics.get(id);
    const changed = previous !== undefined && Math.abs(previous - nextValue) > 0.000001;
    el.textContent = formatter(nextValue);
    el.classList.toggle("positive", nextValue > 0);
    el.classList.toggle("negative", nextValue < 0);
    if (changed) {
      const cls = kind === "loss" || nextValue < previous ? "metricPopLoss" : "metricPopWin";
      el.classList.remove("metricPopWin", "metricPopLoss");
      void el.offsetWidth;
      el.classList.add(cls);
      window.setTimeout(() => el.classList.remove(cls), 950);
      if (kind === "win" || (id === "runningPnl" && nextValue > previous)) burstAt(el, "win");
      if (kind === "loss" || (id === "runningPnl" && nextValue < previous)) burstAt(el, "loss");
    }
    state.previousMetrics.set(id, nextValue);
  }

  function burstAt(target, type) {
    if (!target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = target.getBoundingClientRect();
    const host = document.createElement("div");
    host.className = "tradeEffect " + type;
    host.style.left = rect.left + rect.width / 2 + "px";
    host.style.top = rect.top + rect.height / 2 + "px";
    const count = type === "win" ? 22 : 14;
    for (let i = 0; i < count; i += 1) {
      const particle = document.createElement("span");
      particle.className = "particle";
      const angle = type === "win" ? (360 / count) * i : 80 + Math.random() * 110;
      const distance = type === "win" ? 48 + Math.random() * 74 : 42 + Math.random() * 62;
      particle.style.setProperty("--angle", angle + "deg");
      particle.style.setProperty("--distance", distance + "px");
      particle.style.setProperty("--drift", (Math.random() * 60 - 30) + "px");
      particle.style.animationDelay = (Math.random() * 90) + "ms";
      host.appendChild(particle);
    }
    document.body.appendChild(host);
    window.setTimeout(() => host.remove(), 1200);
  }

  function deriveSummary(trades) {
    const wins = trades.filter((t) => t.status !== "OPEN" && t.result === "WIN").length;
    const losses = trades.filter((t) => t.status !== "OPEN" && t.result === "LOSS").length;
    const realized = trades.filter((t) => t.status !== "OPEN").reduce((sum, t) => sum + t.pnl, 0);
    const unrealized = trades.filter((t) => t.status === "OPEN").reduce((sum, t) => sum + t.pnl, 0);
    return {
      wins,
      losses,
      realized_pnl_usd: realized,
      unrealized_pnl_usd: unrealized,
      total_pnl_usd: realized + unrealized,
      closed_trades: wins + losses
    };
  }

  function normalizeCandles(payload) {
    const rows = payload && (payload.candles || payload.data || []);
    return rows.map((c) => ({
      ts: c.ts || c.timestamp || c.time,
      open: number(c.open ?? c.o, 0),
      high: number(c.high ?? c.h, 0),
      low: number(c.low ?? c.l, 0),
      close: number(c.close ?? c.c, 0),
      volume: number(c.volume ?? c.v, 0)
    })).filter((c) => c.open && c.high && c.low && c.close);
  }

  function normalizeEquity(payload) {
    const rows = payload && (payload.equity || payload.data || []);
    return rows.map((r) => ({
      ts: r.ts_utc || r.generated_ts_utc || r.ts,
      pnl: number(r.total_pnl_usd, 0),
      wins: number(r.wins, 0),
      losses: number(r.losses, 0)
    }));
  }

  function updateSummaryUi() {
    const s = state.summary;
    const total = number(s.total_pnl_usd, 0);
    const realized = number(s.realized_pnl_usd, 0);
    const unrealized = number(s.unrealized_pnl_usd, 0);
    const wins = number(s.wins, 0);
    const losses = number(s.losses, 0);

    animateMetric("runningPnl", total, money, total >= 0 ? "win" : "loss");
    animateMetric("winsCount", wins, (v) => String(Math.round(v)), "win");
    animateMetric("lossesCount", losses, (v) => String(Math.round(v)), "loss");
    $("pnlBreakdown").textContent = "Realized " + money(realized) + " / Floating " + money(unrealized);
    $("equityCaption").textContent = state.equity.length ? state.equity.length + " snapshots" : "Awaiting snapshots";
  }

  function renderSymbols() {
    const host = $("symbolDock");
    host.innerHTML = "";
    const bySymbol = new Map();
    state.trades.forEach((trade) => {
      const bucket = bySymbol.get(trade.symbol) || { open: 0, win: 0, loss: 0 };
      if (trade.status === "OPEN") bucket.open += 1;
      if (trade.result === "WIN") bucket.win += 1;
      if (trade.result === "LOSS") bucket.loss += 1;
      bySymbol.set(trade.symbol, bucket);
    });

    state.symbols.forEach((symbol) => {
      const button = document.createElement("button");
      const meta = bySymbol.get(symbol) || {};
      button.type = "button";
      button.className = "symbolBtn";
      if (symbol === state.activeSymbol) button.classList.add("active");
      if (meta.open) button.classList.add("hasOpen");
      else if (meta.win) button.classList.add("hasWin");
      else if (meta.loss) button.classList.add("hasLoss");
      button.textContent = symbol;
      button.addEventListener("click", () => {
        state.userPickedSymbol = true;
        state.activeSymbol = symbol;
        renderAll();
        loadCandles().catch(handleError);
      });
      host.appendChild(button);
    });
  }

  function renderPositions() {
    $("positionTitle").textContent = state.activeSymbol;
    const host = $("selectedPositions");
    host.innerHTML = "";
    const selected = state.trades.filter((t) => t.symbol === state.activeSymbol && t.status === "OPEN");
    $("positionCount").textContent = String(selected.length);
    if (!selected.length) {
      const empty = document.createElement("div");
      empty.className = "emptyState";
      empty.textContent = "No open position for " + state.activeSymbol + ".";
      host.appendChild(empty);
      return;
    }

    selected.forEach((trade) => {
      const card = document.createElement("article");
      card.className = "positionCard";

      const top = document.createElement("div");
      top.className = "positionTop";
      const left = document.createElement("span");
      left.textContent = trade.side + " " + trade.symbol;
      left.className = trade.side === "Short" ? "sideShort" : "sideLong";
      const pnl = document.createElement("strong");
      pnl.textContent = money(trade.pnl);
      pnl.className = trade.pnl > 0 ? "resultWin" : trade.pnl < 0 ? "resultLoss" : "";
      top.append(left, pnl);

      const grid = document.createElement("div");
      grid.className = "positionGrid";
      [
        ["Entry", price(trade.entryPrice)],
        ["Target", price(trade.targetExitPrice)],
        ["Mark", price(trade.markPrice)],
        ["Notional", money(trade.notional)]
      ].forEach(([label, value]) => {
        const item = document.createElement("div");
        const span = document.createElement("span");
        const strong = document.createElement("strong");
        span.textContent = label;
        strong.textContent = value;
        item.append(span, strong);
        grid.appendChild(item);
      });

      card.append(top, grid);
      host.appendChild(card);
    });
  }

  function renderLedger() {
    const host = $("tradeLedgerBody");
    host.innerHTML = "";
    const sorted = state.trades.slice().sort((a, b) => {
      if (a.status === "OPEN" && b.status !== "OPEN") return -1;
      if (a.status !== "OPEN" && b.status === "OPEN") return 1;
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });
    $("tradeCount").textContent = sorted.length + (sorted.length === 1 ? " trade" : " trades");

    if (!sorted.length) {
      const empty = document.createElement("div");
      empty.className = "emptyState";
      empty.textContent = "No trades returned by the shadow paper feed yet.";
      host.appendChild(empty);
      return;
    }

    sorted.slice(0, 80).forEach((trade) => {
      const row = document.createElement("div");
      row.className = "ledgerRow tradeLine";
      if (trade.symbol === state.activeSymbol) row.classList.add("active");
      row.setAttribute("role", "row");
      row.addEventListener("click", () => {
        state.userPickedSymbol = true;
        state.activeSymbol = trade.symbol;
        renderAll();
        loadCandles().catch(handleError);
      });

      const cells = [
        trade.symbol,
        trade.side,
        trade.status,
        price(trade.entryPrice),
        price(trade.targetExitPrice),
        price(trade.exitOrMark),
        money(trade.pnl),
        trade.result
      ];

      cells.forEach((value, index) => {
        const span = document.createElement("span");
        span.textContent = value;
        if (index === 1) span.className = trade.side === "Short" ? "sideShort" : "sideLong";
        if (index === 2) span.className = trade.status === "OPEN" ? "statusOpen" : "statusClosed";
        if (index === 6) {
          span.className = "pnlChip " + (trade.pnl > 0 ? "positive" : trade.pnl < 0 ? "negative" : "");
        }
        if (index === 7) {
          span.className = "resultChip " + (trade.result === "WIN" ? "win" : trade.result === "LOSS" ? "loss" : "");
        }
        row.appendChild(span);
      });

      host.appendChild(row);

      const prevResult = state.previousTradeResults.get(trade.id);
      const prevPnl = state.previousTradePnl.get(trade.id);
      const resultChanged = prevResult !== undefined && prevResult !== trade.result;
      const pnlChanged = prevPnl !== undefined && Math.abs(prevPnl - trade.pnl) > 0.000001;
      if (!state.firstRender && (resultChanged || pnlChanged)) {
        const effectTarget = row.children[6] || row;
        if (trade.result === "WIN" || (pnlChanged && trade.pnl > prevPnl)) {
          row.classList.add("rowGlowWin");
          burstAt(effectTarget, "win");
        } else if (trade.result === "LOSS" || (pnlChanged && trade.pnl < prevPnl)) {
          row.classList.add("rowGlowLoss", "lossShake");
          burstAt(effectTarget, "loss");
        }
        window.setTimeout(() => row.classList.remove("rowGlowWin", "rowGlowLoss", "lossShake"), 1300);
      }

      state.previousTradeResults.set(trade.id, trade.result);
      state.previousTradePnl.set(trade.id, trade.pnl);
    });
  }

  function updateHeroPulse() {
    const newest = state.trades.slice().sort((a, b) => {
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    })[0];
    if (!newest) {
      $("tradePulse").textContent = "Idle";
      $("tradePulseDetail").textContent = "No recent trade update";
      return;
    }
    $("tradePulse").textContent = newest.result === "OPEN" ? newest.status : newest.result;
    $("tradePulseDetail").textContent = newest.symbol + " " + money(newest.pnl) + " updated " + timeLabel(newest.updatedAt);
  }

  function renderAll() {
    if (!state.symbols.includes(state.activeSymbol)) state.activeSymbol = state.symbols[0] || "BTC/USD";
    $("activeSymbolTitle").textContent = state.activeSymbol;
    updateSummaryUi();
    renderSymbols();
    renderPositions();
    renderLedger();
    updateHeroPulse();
    drawCandleChart();
    drawEquityChart();
  }

  function handleError(err) {
    console.warn("[FAYT demo feed]", err && err.message ? err.message : String(err));
    setStatus("Feed waiting", false);
    $("feedMessage").textContent = "Live feed warming up. Telemetry will populate as soon as the API responds.";
  }

  async function loadTrades() {
    const [summaryResult, tradesResult, equityResult] = await Promise.allSettled([
      getJson("/demo/shadow-summary"),
      getJson("/demo/shadow-trades?limit=200"),
      getJson("/demo/shadow-equity?limit=180")
    ]);

    if (tradesResult.status !== "fulfilled") throw tradesResult.reason;

    const rawTrades = tradesResult.value.trades || tradesResult.value.shadow_trades || tradesResult.value.data || [];
    state.trades = rawTrades.map(normalizeTrade);
    state.summary = summaryResult.status === "fulfilled" && summaryResult.value.summary
      ? summaryResult.value.summary
      : deriveSummary(state.trades);
    state.equity = equityResult.status === "fulfilled" ? normalizeEquity(equityResult.value) : [];

    if (!state.userPickedSymbol) {
      const firstOpen = state.trades.find((t) => t.status === "OPEN");
      if (firstOpen) state.activeSymbol = firstOpen.symbol;
    }
    state.fetchCount += 1;
    $("pollPill").textContent = "Fetch " + state.fetchCount;
    $("feedMessage").textContent = tradesResult.value.public_notice || "Shadow paper execution feed connected.";
  }

  async function loadCandles() {
    const path = "/demo/live-candles?symbol=" + encodeURIComponent(state.activeSymbol) + "&timeframe=60m&limit=96";
    const payload = await getJson(path);
    state.candles = normalizeCandles(payload);
    $("chartMeta").textContent = "60m candles / " + state.candles.length;
    const last = state.candles[state.candles.length - 1];
    $("lastPrice").textContent = last ? "Last " + price(last.close) : "Last -";
    drawCandleChart();
  }

  async function tick() {
    try {
      setStatus("Syncing", true);
      await loadTrades();
      renderAll();
      await loadCandles();
      setStatus("Live", true);
      state.firstRender = false;
    } catch (err) {
      handleError(err);
    }
  }

  function drawEquityChart() {
    const canvas = $("equityCanvas");
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(220, rect.width || 260);
    const h = Math.max(92, rect.height || 104);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const points = state.equity.length ? state.equity.map((r) => r.pnl) : [number(state.summary.total_pnl_usd, 0)];
    const min = Math.min(...points, 0);
    const max = Math.max(...points, 0);
    const span = Math.max(0.01, max - min);
    const xAt = (i) => points.length === 1 ? w - 8 : 8 + (i / (points.length - 1)) * (w - 16);
    const yAt = (v) => 8 + ((max - v) / span) * (h - 16);

    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = points[points.length - 1] >= points[0] ? "#30f28a" : "#ff465e";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 14;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const zeroY = yAt(0);
    ctx.strokeStyle = "rgba(243,201,105,0.28)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCandleChart() {
    const canvas = $("candleCanvas");
    const frame = canvas.parentElement;
    if (!frame) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(320, frame.clientWidth);
    const h = Math.max(300, frame.clientHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0b1114");
    bg.addColorStop(1, "#050607");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (!state.candles.length) {
      ctx.fillStyle = "rgba(238,246,247,0.78)";
      ctx.font = "800 17px system-ui";
      ctx.fillText("Waiting for candle feed", 24, 42);
      return;
    }

    const pad = { left: 62, right: 26, top: 24, bottom: 42 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const highs = state.candles.map((c) => c.high).filter(Number.isFinite);
    const lows = state.candles.map((c) => c.low).filter(Number.isFinite);
    const selectedTrades = state.trades.filter((t) => t.symbol === state.activeSymbol);
    selectedTrades.forEach((t) => {
      if (t.entryPrice) {
        highs.push(t.entryPrice);
        lows.push(t.entryPrice);
      }
      if (t.targetExitPrice) {
        highs.push(t.targetExitPrice);
        lows.push(t.targetExitPrice);
      }
      if (t.exitOrMark) {
        highs.push(t.exitOrMark);
        lows.push(t.exitOrMark);
      }
    });
    const maxP = Math.max(...highs);
    const minP = Math.min(...lows);
    const span = Math.max(0.0000001, maxP - minP);
    const y = (p) => pad.top + ((maxP - Number(p)) / span) * plotH;
    const xAt = (i) => pad.left + (plotW / Math.max(1, state.candles.length - 1)) * i;

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.font = "750 10px system-ui";
    for (let i = 0; i <= 5; i += 1) {
      const yy = pad.top + (plotH / 5) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, yy);
      ctx.lineTo(w - pad.right, yy);
      ctx.stroke();
      ctx.fillStyle = "rgba(155,169,174,0.72)";
      ctx.fillText(price(maxP - (span / 5) * i), 8, yy + 3);
    }

    const gap = plotW / Math.max(1, state.candles.length);
    const bodyW = Math.max(3, Math.min(11, gap * 0.56));
    state.candles.forEach((c, i) => {
      const x = xAt(i);
      const up = c.close >= c.open;
      const wick = up ? "#3fe0d0" : "#ff6a7e";
      const fill = up ? "rgba(63,224,208,0.92)" : "rgba(255,106,126,0.9)";
      const yo = y(c.open);
      const yc = y(c.close);
      const yh = y(c.high);
      const yl = y(c.low);
      ctx.strokeStyle = wick;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, yh);
      ctx.lineTo(x, yl);
      ctx.stroke();
      ctx.fillStyle = fill;
      ctx.fillRect(x - bodyW / 2, Math.min(yo, yc), bodyW, Math.max(2, Math.abs(yc - yo)));
    });

    function priceLine(value, label, color) {
      if (!value) return;
      const yy = y(value);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(pad.left, yy);
      ctx.lineTo(w - pad.right, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = "850 11px system-ui";
      ctx.fillText(label + " " + price(value), pad.left + 8, yy - 6);
    }

    const openForSymbol = selectedTrades.filter((t) => t.status === "OPEN");
    const focus = openForSymbol[0] || selectedTrades[0];
    if (focus) {
      priceLine(focus.entryPrice, "ENTRY", "#30f28a");
      priceLine(focus.targetExitPrice, "TARGET", "#f3c969");
      priceLine(focus.exitOrMark, focus.status === "OPEN" ? "MARK" : "EXIT", focus.pnl >= 0 ? "#65a7ff" : "#ff465e");
    }

    const last = state.candles[state.candles.length - 1];
    ctx.fillStyle = "rgba(238,246,247,0.82)";
    ctx.font = "850 12px system-ui";
    ctx.fillText(state.activeSymbol, pad.left, h - 16);
    ctx.fillText("Last " + price(last.close), Math.max(pad.left, w - 140), h - 16);
  }

  function drawBackdropFrame(canvas, tick) {
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(320, window.innerHeight);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#02030a");
    bg.addColorStop(0.42, "#071016");
    bg.addColorStop(1, "#03040a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = "rgba(127, 236, 219, 0.15)";
    ctx.lineWidth = 1;
    const spacing = 58;
    const offset = (tick * 0.022) % spacing;
    for (let x = -spacing; x < w + spacing; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x + offset, 0);
      ctx.lineTo(x + offset - h * 0.22, h);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(142, 177, 255, 0.11)";
    for (let y = -spacing; y < h + spacing; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y + offset);
      ctx.lineTo(w, y + offset - w * 0.08);
      ctx.stroke();
    }
    ctx.restore();

    const nodes = 28;
    for (let i = 0; i < nodes; i += 1) {
      const phase = tick * 0.00038 + i * 1.713;
      const x = (Math.sin(phase * 1.7) * 0.5 + 0.5) * w;
      const y = (Math.cos(phase * 1.13) * 0.5 + 0.5) * h;
      const x2 = (Math.sin(phase * 1.7 + 0.62) * 0.5 + 0.5) * w;
      const y2 = (Math.cos(phase * 1.13 + 0.48) * 0.5 + 0.5) * h;
      const grad = ctx.createLinearGradient(x, y, x2, y2);
      grad.addColorStop(0, "rgba(48, 242, 138, 0)");
      grad.addColorStop(0.5, "rgba(63, 224, 208, 0.16)");
      grad.addColorStop(1, "rgba(101, 167, 255, 0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    const sweepX = (tick * 0.055) % (w + 320) - 160;
    const sweep = ctx.createLinearGradient(sweepX - 80, 0, sweepX + 80, h);
    sweep.addColorStop(0, "rgba(63, 224, 208, 0)");
    sweep.addColorStop(0.5, "rgba(63, 224, 208, 0.10)");
    sweep.addColorStop(1, "rgba(63, 224, 208, 0)");
    ctx.fillStyle = sweep;
    ctx.fillRect(sweepX - 100, 0, 220, h);
  }

  function startBackdrop() {
    const canvas = $("systemBackdrop");
    if (!canvas) return;
    let frame = 0;
    function loop(tick) {
      if (frame % 2 === 0) drawBackdropFrame(canvas, tick);
      frame += 1;
      window.requestAnimationFrame(loop);
    }
    window.requestAnimationFrame(loop);
  }

  function boot() {
    $("apiPill").textContent = API_BASE.replace(/^https?:\/\//, "");
    startBackdrop();
    renderSymbols();
    renderAll();
    window.addEventListener("resize", () => {
      drawCandleChart();
      drawEquityChart();
    });
    tick();
    window.setInterval(tick, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
