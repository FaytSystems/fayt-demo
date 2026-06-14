(() => {
  const API_BASE =
    window.FAYT_DEMO_API_BASE ||
    window.__FAYT_DEMO_API_BASE__ ||
    "https://demo-api.faytsystems.com";

  const DEFAULT_SYMBOLS = ["ARB/USD", "AAVE/USD", "BTC/USD", "ETH/USD", "SOL/USD"];
  let activeSymbol = "ARB/USD";
  let activeTimeframe = "60m";
  let latestCandles = [];
  let latestDecisions = [];

  function fmt(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: Number(n) < 10 ? 4 : 2,
      maximumFractionDigits: Number(n) < 10 ? 6 : 2,
    });
  }

  function qs(path, params = {}) {
    const u = new URL(path, API_BASE);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  async function getJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }

  function ensureStage() {
    let stage = document.getElementById("fayt-live-3d-candle-stage");
    if (stage) return stage;

    stage = document.createElement("section");
    stage.id = "fayt-live-3d-candle-stage";
    stage.innerHTML = `
      <div class="fayt3d-shell">
        <div class="fayt3d-top">
          <div>
            <div class="fayt3d-kicker">Live 3D Trade Chart</div>
            <h2>Trade Entry / Exit Markers · Candle Colors From Live DB</h2>
          </div>
          <div class="fayt3d-status" id="fayt3d-status">Connecting…</div>
        </div>

        <div class="fayt3d-toolbar">
          <div id="fayt3d-symbols" class="fayt3d-symbols"></div>
          <div class="fayt3d-badge" id="fayt3d-source">DB LIVE</div>
        </div>

        <div class="fayt3d-stats">
          <div><span>Symbol</span><strong id="fayt3d-symbol">—</strong></div>
          <div><span>Last</span><strong id="fayt3d-last">—</strong></div>
          <div><span>High</span><strong id="fayt3d-high">—</strong></div>
          <div><span>Low</span><strong id="fayt3d-low">—</strong></div>
        </div>

        <div class="fayt3d-canvas-wrap">
          <canvas id="fayt3d-canvas"></canvas>
          <div class="fayt3d-overlay" id="fayt3d-overlay">Waiting for candles…</div>
        </div>
      </div>
    `;

    const css = document.createElement("style");
    css.textContent = `
      #fayt-live-3d-candle-stage {
        width: min(1180px, calc(100vw - 32px));
        margin: 24px auto;
        color: #eef5ff;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .fayt3d-shell {
        border: 1px solid rgba(125, 211, 252, 0.22);
        background:
          radial-gradient(circle at 20% 0%, rgba(34, 211, 238, 0.18), transparent 34%),
          radial-gradient(circle at 80% 10%, rgba(168, 85, 247, 0.14), transparent 30%),
          linear-gradient(145deg, rgba(8, 13, 30, 0.96), rgba(3, 7, 18, 0.94));
        border-radius: 28px;
        padding: 22px;
        box-shadow: 0 26px 80px rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(255,255,255,0.05);
        overflow: hidden;
      }
      .fayt3d-top, .fayt3d-toolbar, .fayt3d-stats {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      .fayt3d-kicker {
        color: #67e8f9;
        font-size: 12px;
        letter-spacing: .18em;
        text-transform: uppercase;
        font-weight: 800;
      }
      .fayt3d-top h2 {
        margin: 4px 0 0;
        font-size: clamp(20px, 3vw, 34px);
        line-height: 1.05;
      }
      .fayt3d-status, .fayt3d-badge {
        border: 1px solid rgba(103, 232, 249, 0.28);
        background: rgba(8, 47, 73, 0.42);
        color: #bae6fd;
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 800;
      }
      .fayt3d-toolbar { margin-top: 18px; }
      .fayt3d-symbols { display: flex; gap: 8px; flex-wrap: wrap; }
      .fayt3d-symbols button {
        cursor: pointer;
        color: #dbeafe;
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 999px;
        padding: 8px 11px;
        font-weight: 800;
      }
      .fayt3d-symbols button.active {
        color: #06111f;
        background: linear-gradient(135deg, #67e8f9, #a7f3d0);
        border-color: transparent;
      }
      .fayt3d-stats {
        margin-top: 18px;
        display: grid;
        grid-template-columns: repeat(4, minmax(130px, 1fr));
      }
      .fayt3d-stats div {
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(15, 23, 42, 0.56);
        border-radius: 18px;
        padding: 12px 14px;
      }
      .fayt3d-stats span {
        display: block;
        color: #94a3b8;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .12em;
        font-weight: 900;
      }
      .fayt3d-stats strong {
        display: block;
        margin-top: 4px;
        font-size: 20px;
      }
      .fayt3d-canvas-wrap {
        position: relative;
        margin-top: 20px;
        height: 430px;
        border-radius: 24px;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.16);
        background:
          linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
          radial-gradient(circle at 50% 10%, rgba(14, 165, 233, 0.12), transparent 40%),
          rgba(2, 6, 23, 0.82);
        background-size: 100% 48px, 56px 100%, auto, auto;
      }
      #fayt3d-canvas { width: 100%; height: 100%; display: block; }
      .fayt3d-overlay {
        position: absolute;
        left: 16px;
        bottom: 14px;
        color: #93c5fd;
        font-size: 12px;
        font-weight: 800;
        background: rgba(2, 6, 23, 0.68);
        border: 1px solid rgba(147, 197, 253, 0.18);
        border-radius: 999px;
        padding: 8px 10px;
      }
      @media (max-width: 760px) {
        .fayt3d-stats { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
        .fayt3d-canvas-wrap { height: 330px; }
      }
    `;
    document.head.appendChild(css);

    const root = document.getElementById("root") || document.body;
    root.prepend(stage);
    return stage;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function decisionFor(symbol) {
    return latestDecisions.find(d => d.symbol === symbol);
  }

  function renderButtons(symbols) {
    const host = document.getElementById("fayt3d-symbols");
    if (!host) return;
    host.innerHTML = "";
    symbols.forEach(sym => {
      const btn = document.createElement("button");
      btn.textContent = sym;
      btn.className = sym === activeSymbol ? "active" : "";
      btn.onclick = () => {
        activeSymbol = sym;
        renderButtons(symbols);
        loadCandles();
      };
      host.appendChild(btn);
    });
  }

  function draw(candles) {
    const canvas = document.getElementById("fayt3d-canvas");
    if (!canvas || !candles.length) return;

    const wrap = canvas.parentElement;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.floor(wrap.clientWidth * dpr);
    const h = Math.floor(wrap.clientHeight * dpr);
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.scale(dpr, dpr);

    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const padL = 44;
    const padR = 26;
    const padT = 30;
    const padB = 48;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const highs = candles.map(c => Number(c.high));
    const lows = candles.map(c => Number(c.low));
    const maxP = Math.max(...highs);
    const minP = Math.min(...lows);
    const span = Math.max(0.000001, maxP - minP);
    const y = p => padT + ((maxP - p) / span) * plotH;

    // 3D floor
    ctx.save();
    ctx.translate(0.5, 0.5);
    ctx.strokeStyle = "rgba(103,232,249,0.10)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const yy = padT + (plotH / 6) * i;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(W - padR, yy - 26);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const xx = padL + (plotW / 11) * i;
      ctx.beginPath();
      ctx.moveTo(xx, padT + plotH);
      ctx.lineTo(xx + 28, padT);
      ctx.stroke();
    }
    ctx.restore();

    const n = candles.length;
    const gap = plotW / Math.max(1, n);
    const bodyW = Math.max(4, Math.min(12, gap * 0.58));

    candles.forEach((c, i) => {
      const open = Number(c.open);
      const close = Number(c.close);
      const high = Number(c.high);
      const low = Number(c.low);
      const up = close >= open;

      const x = padL + gap * i + gap / 2;
      const yo = y(open);
      const yc = y(close);
      const yh = y(high);
      const yl = y(low);
      const top = Math.min(yo, yc);
      const bot = Math.max(yo, yc);
      const bh = Math.max(2, bot - top);

      const side = up ? "rgba(52, 211, 153, 0.95)" : "rgba(251, 113, 133, 0.95)";
      const glow = up ? "rgba(52, 211, 153, 0.24)" : "rgba(251, 113, 133, 0.24)";

      // shadow extrusion
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x - bodyW / 2 + 6, top + 7, bodyW, bh);

      // wick
      ctx.strokeStyle = side;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, yh);
      ctx.lineTo(x, yl);
      ctx.stroke();

      // glow
      ctx.fillStyle = glow;
      ctx.fillRect(x - bodyW / 2 - 2, top - 2, bodyW + 4, bh + 4);

      // body
      const grad = ctx.createLinearGradient(x - bodyW / 2, top, x + bodyW / 2, bot);
      grad.addColorStop(0, side);
      grad.addColorStop(1, up ? "rgba(16, 185, 129, 0.78)" : "rgba(225, 29, 72, 0.78)");
      ctx.fillStyle = grad;
      ctx.fillRect(x - bodyW / 2, top, bodyW, bh);

      // right face for pseudo 3D
      ctx.fillStyle = up ? "rgba(5, 150, 105, 0.40)" : "rgba(159, 18, 57, 0.40)";
      ctx.beginPath();
      ctx.moveTo(x + bodyW / 2, top);
      ctx.lineTo(x + bodyW / 2 + 6, top + 6);
      ctx.lineTo(x + bodyW / 2 + 6, bot + 6);
      ctx.lineTo(x + bodyW / 2, bot);
      ctx.closePath();
      ctx.fill();
    });

    const last = candles[candles.length - 1];
    const d = decisionFor(activeSymbol);
    const markerX = padL + gap * (n - 1) + gap / 2;
    const markerY = y(Number(last.close));

    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = d && d.approved ? "rgba(34, 197, 94, 0.9)" : "rgba(251, 191, 36, 0.75)";
    ctx.fillStyle = d && d.approved ? "rgba(34, 197, 94, 0.98)" : "rgba(251, 191, 36, 0.98)";
    ctx.beginPath();
    ctx.moveTo(markerX, markerY - 12);
    ctx.lineTo(markerX + 12, markerY);
    ctx.lineTo(markerX, markerY + 12);
    ctx.lineTo(markerX - 12, markerY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(226, 232, 240, 0.72)";
    ctx.font = "700 11px Inter, system-ui, sans-serif";
    ctx.fillText(`${activeSymbol} · ${activeTimeframe}`, padL, H - 18);
    ctx.fillText(`Latest ${last.ts || last.time || ""}`, Math.max(padL, W - 270), H - 18);
  }

  async function loadDecisions() {
    try {
      const data = await getJson(qs("/demo/live-runner"));
      latestDecisions = Array.isArray(data.decisions) ? data.decisions : [];
      const syms = latestDecisions.length ? latestDecisions.map(d => d.symbol) : DEFAULT_SYMBOLS;
      if (!syms.includes(activeSymbol)) activeSymbol = syms[0] || activeSymbol;
      renderButtons(syms);
    } catch {
      renderButtons(DEFAULT_SYMBOLS);
    }
  }

  async function loadCandles() {
    ensureStage();
    setText("fayt3d-symbol", activeSymbol);
    setText("fayt3d-status", "Loading candles…");

    try {
      const data = await getJson(qs("/demo/live-candles", {
        symbol: activeSymbol,
        timeframe: activeTimeframe,
        limit: 88,
      }));

      latestCandles = Array.isArray(data.candles) ? data.candles : [];
      if (!latestCandles.length) throw new Error("No candles returned");

      const last = latestCandles[latestCandles.length - 1];
      const high = Math.max(...latestCandles.map(c => Number(c.high)));
      const low = Math.min(...latestCandles.map(c => Number(c.low)));

      setText("fayt3d-symbol", activeSymbol);
      setText("fayt3d-last", fmt(last.close));
      setText("fayt3d-high", fmt(high));
      setText("fayt3d-low", fmt(low));
      setText("fayt3d-status", "DB LIVE");
      setText("fayt3d-source", `${data.source || "live_runner_candles"} · ${data.count || latestCandles.length} candles`);

      const overlay = document.getElementById("fayt3d-overlay");
      if (overlay) overlay.textContent = `Fed by demo-api.faytsystems.com · latest ${data.latest_ts || last.ts || last.time}`;

      draw(latestCandles);
    } catch (err) {
      setText("fayt3d-status", "Candle feed offline");
      const overlay = document.getElementById("fayt3d-overlay");
      if (overlay) overlay.textContent = `No candle feed: ${err.message}`;
      console.error("[Fayt candles]", err);
    }
  }

  async function start() {
    ensureStage();
    await loadDecisions();
    await loadCandles();
    window.addEventListener("resize", () => draw(latestCandles));
    setInterval(loadCandles, 12000);
    setInterval(loadDecisions, 30000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
