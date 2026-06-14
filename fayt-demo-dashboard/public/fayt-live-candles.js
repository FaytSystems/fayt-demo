(function () {
  "use strict";

  var API_BASE = window.FAYT_DEMO_API_BASE || (location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "http://127.0.0.1:8111" : "https://demo-api.faytsystems.com");
  var SYMBOLS = ["AAVE/USD", "BTC/USD", "ETH/USD", "SOL/USD", "ADA/USD", "ARB/USD"];
  var symbolIndex = 0;
  var pollMs = 3200;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function css() {
    if (document.getElementById("fayt-live-candles-css")) return;
    var style = el("style");
    style.id = "fayt-live-candles-css";
    style.textContent = `
      .fayt-live-candle-stage{position:relative;margin:18px auto 22px;max-width:1180px;border:1px solid rgba(148,163,184,.22);border-radius:28px;overflow:hidden;background:radial-gradient(circle at 20% 0%,rgba(56,189,248,.22),transparent 32%),radial-gradient(circle at 80% 20%,rgba(34,197,94,.12),transparent 28%),linear-gradient(135deg,rgba(2,6,23,.96),rgba(15,23,42,.94));box-shadow:0 24px 80px rgba(0,0,0,.38);color:#e5edf7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
      .fayt-live-candle-stage:before{content:"";position:absolute;inset:-1px;background:linear-gradient(120deg,transparent,rgba(56,189,248,.13),transparent,rgba(34,197,94,.10),transparent);animation:faytSweep 7s linear infinite;pointer-events:none;}
      .fayt-candle-shell{position:relative;padding:22px 24px 18px;}
      .fayt-candle-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px;}
      .fayt-candle-kicker{text-transform:uppercase;letter-spacing:.18em;font-size:11px;color:#93c5fd;margin-bottom:5px;}
      .fayt-candle-title{font-size:24px;font-weight:800;letter-spacing:-.04em;}
      .fayt-candle-sub{margin-top:5px;color:#94a3b8;font-size:13px;}
      .fayt-candle-badges{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
      .fayt-candle-badge{border:1px solid rgba(148,163,184,.24);border-radius:999px;padding:7px 10px;background:rgba(15,23,42,.62);font-size:12px;color:#cbd5e1;}
      .fayt-candle-badge.good{color:#bbf7d0;border-color:rgba(34,197,94,.32);background:rgba(22,101,52,.20);}
      .fayt-candle-grid{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:18px;align-items:stretch;}
      .fayt-candle-chart{position:relative;height:316px;border:1px solid rgba(148,163,184,.16);border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.72),rgba(2,6,23,.64));overflow:hidden;}
      .fayt-candle-chart svg{position:absolute;inset:0;width:100%;height:100%;}
      .fayt-candle-side{border:1px solid rgba(148,163,184,.16);border-radius:22px;background:rgba(15,23,42,.55);padding:16px;display:grid;gap:12px;align-content:start;}
      .fayt-side-label{font-size:11px;text-transform:uppercase;letter-spacing:.16em;color:#94a3b8;}
      .fayt-side-value{font-size:22px;font-weight:800;letter-spacing:-.04em;}
      .fayt-side-value.up{color:#86efac}.fayt-side-value.down{color:#fca5a5}
      .fayt-symbol-tabs{display:flex;gap:7px;flex-wrap:wrap;margin-top:14px;}
      .fayt-symbol-tab{cursor:pointer;border:1px solid rgba(148,163,184,.20);border-radius:999px;background:rgba(15,23,42,.68);color:#cbd5e1;padding:7px 10px;font-size:12px;transition:.2s ease;}
      .fayt-symbol-tab.active,.fayt-symbol-tab:hover{border-color:rgba(56,189,248,.55);color:#eff6ff;transform:translateY(-1px);box-shadow:0 8px 24px rgba(56,189,248,.10);}
      .fayt-candle-foot{display:flex;justify-content:space-between;gap:12px;margin-top:12px;color:#64748b;font-size:11px;}
      @keyframes faytSweep{0%{transform:translateX(-80%)}100%{transform:translateX(80%)}}
      @media (max-width:880px){.fayt-live-candle-stage{margin:12px}.fayt-candle-grid{grid-template-columns:1fr}.fayt-candle-chart{height:260px}.fayt-candle-head{display:block}.fayt-candle-badges{justify-content:flex-start;margin-top:12px}}
    `;
    document.head.appendChild(style);
  }

  function money(n) {
    if (!Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1000) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (Math.abs(n) >= 1) return "$" + n.toFixed(2);
    return "$" + n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  function pct(n) {
    if (!Number.isFinite(n)) return "—";
    return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
  }

  function pathForLine(points) {
    return points.map(function (p, i) { return (i ? "L" : "M") + p.x.toFixed(2) + " " + p.y.toFixed(2); }).join(" ");
  }

  function renderChart(svg, candles) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!candles.length) return;
    var w = 980, h = 316, pad = { l: 36, r: 22, t: 20, b: 34 };
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    var min = Math.min.apply(null, candles.map(function (c) { return c.low; }));
    var max = Math.max.apply(null, candles.map(function (c) { return c.high; }));
    var span = Math.max(max - min, Math.abs(max) * 0.002, 0.000001);
    min -= span * 0.08; max += span * 0.08;
    var plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
    function y(v) { return pad.t + (max - v) / (max - min) * plotH; }
    function x(i) { return pad.l + (candles.length <= 1 ? 0 : i / (candles.length - 1) * plotW); }
    function make(tag, attrs) {
      var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      svg.appendChild(node);
      return node;
    }
    for (var g = 0; g < 5; g++) {
      var gy = pad.t + g / 4 * plotH;
      make("line", { x1: pad.l, x2: w - pad.r, y1: gy, y2: gy, stroke: "rgba(148,163,184,.14)", "stroke-width": "1" });
    }
    var linePoints = candles.map(function (c, i) { return { x: x(i), y: y(c.close) }; });
    make("path", { d: pathForLine(linePoints), fill: "none", stroke: "rgba(125,211,252,.36)", "stroke-width": "2", "stroke-linecap": "round" });
    var candleW = Math.max(3, Math.min(10, plotW / candles.length * 0.54));
    candles.forEach(function (c, i) {
      var cx = x(i), up = c.close >= c.open;
      var color = up ? "rgba(74,222,128,.92)" : "rgba(248,113,113,.90)";
      var yHigh = y(c.high), yLow = y(c.low), yOpen = y(c.open), yClose = y(c.close);
      var top = Math.min(yOpen, yClose), height = Math.max(2, Math.abs(yClose - yOpen));
      var wick = make("line", { x1: cx, x2: cx, y1: yHigh, y2: yLow, stroke: color, "stroke-width": "1.4", opacity: ".82" });
      wick.style.animation = "faytCandleFade .55s ease both";
      var rect = make("rect", { x: cx - candleW / 2, y: top, width: candleW, height: height, rx: "2", fill: color, opacity: ".88" });
      rect.style.transformOrigin = cx + "px " + (top + height) + "px";
      rect.style.animation = "faytCandleRise .72s ease both";
      rect.style.animationDelay = Math.min(i * 0.006, 0.38) + "s";
    });
    var defs = document.createElementNS("http://www.w3.org/2000/svg", "style");
    defs.textContent = "@keyframes faytCandleRise{0%{opacity:0;transform:scaleY(.15)}100%{opacity:.88;transform:scaleY(1)}}@keyframes faytCandleFade{0%{opacity:0}100%{opacity:.82}}";
    svg.appendChild(defs);
  }

  function ensureStage() {
    css();
    var stage = document.getElementById("fayt-live-candle-stage");
    if (stage) return stage;
    stage = el("section", "fayt-live-candle-stage");
    stage.id = "fayt-live-candle-stage";
    stage.innerHTML = '<div class="fayt-candle-shell"><div class="fayt-candle-head"><div><div class="fayt-candle-kicker">Live runner candle feed</div><div class="fayt-candle-title">Fayt market pulse</div><div class="fayt-candle-sub">Streaming OHLCV candles for the public demo chart layer.</div></div><div class="fayt-candle-badges"><span class="fayt-candle-badge good" id="fayt-candle-status">Connecting</span><span class="fayt-candle-badge" id="fayt-candle-symbol">AAVE/USD</span><span class="fayt-candle-badge" id="fayt-candle-frame">60m</span></div></div><div class="fayt-candle-grid"><div class="fayt-candle-chart"><svg id="fayt-candle-svg" role="img" aria-label="Live candle chart"></svg></div><div class="fayt-candle-side"><div><div class="fayt-side-label">Last price</div><div class="fayt-side-value" id="fayt-candle-last">—</div></div><div><div class="fayt-side-label">Window move</div><div class="fayt-side-value" id="fayt-candle-move">—</div></div><div><div class="fayt-side-label">Latest candle</div><div class="fayt-side-value" id="fayt-candle-latest" style="font-size:14px;letter-spacing:0;color:#cbd5e1">—</div></div><div class="fayt-symbol-tabs" id="fayt-symbol-tabs"></div></div></div><div class="fayt-candle-foot"><span>Public chart feed only</span><span>No broker keys. No trade controls.</span></div></div>';
    var root = document.getElementById("root");
    if (root && root.parentNode) {
      root.parentNode.insertBefore(stage, root.nextSibling);
    } else {
      document.body.appendChild(stage);
    }
    var tabs = stage.querySelector("#fayt-symbol-tabs");
    SYMBOLS.forEach(function (s, idx) {
      var b = el("button", "fayt-symbol-tab" + (idx === symbolIndex ? " active" : ""), s);
      b.type = "button";
      b.onclick = function () { symbolIndex = idx; update(true); };
      tabs.appendChild(b);
    });
    return stage;
  }

  async function update(force) {
    var stage = ensureStage();
    var symbol = SYMBOLS[symbolIndex % SYMBOLS.length];
    var url = API_BASE + "/demo/live-candles?symbol=" + encodeURIComponent(symbol) + "&timeframe=60m&limit=88&_=" + Date.now();
    try {
      var res = await fetch(url, { cache: "no-store" });
      var data = await res.json();
      var candles = Array.isArray(data.candles) ? data.candles : [];
      stage.querySelector("#fayt-candle-status").textContent = data.ok ? "Live feed" : "Waiting";
      stage.querySelector("#fayt-candle-symbol").textContent = data.symbol || symbol;
      stage.querySelector("#fayt-candle-frame").textContent = data.timeframe || "60m";
      stage.querySelectorAll(".fayt-symbol-tab").forEach(function (n, i) { n.classList.toggle("active", i === symbolIndex); });
      if (candles.length) {
        var first = candles[0], last = candles[candles.length - 1];
        var move = (last.close - first.open) / Math.max(Math.abs(first.open), 0.0000001) * 100;
        var moveNode = stage.querySelector("#fayt-candle-move");
        var lastNode = stage.querySelector("#fayt-candle-last");
        lastNode.textContent = money(last.close);
        lastNode.className = "fayt-side-value " + (last.close >= last.open ? "up" : "down");
        moveNode.textContent = pct(move);
        moveNode.className = "fayt-side-value " + (move >= 0 ? "up" : "down");
        stage.querySelector("#fayt-candle-latest").textContent = last.ts || "latest";
        renderChart(stage.querySelector("#fayt-candle-svg"), candles);
      }
    } catch (err) {
      stage.querySelector("#fayt-candle-status").textContent = "API offline";
    }
    if (!force) symbolIndex = (symbolIndex + 1) % SYMBOLS.length;
  }

  function start() {
    ensureStage();
    update(true);
    setInterval(function () { update(false); }, pollMs);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
