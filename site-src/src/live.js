/* Live layer: Hyperliquid public API and WebSocket straight from the browser, plus TradingView widgets. */
(() => {
"use strict";
const D = window.DESK; if (!D) return;
const {S, $, h, usd, usdBig, pct, nf0, nf1, nf2, longDate, shortDate} = D;
const API = "https://api.hyperliquid.xyz/info";
const WSS = "wss://api.hyperliquid.xyz/ws";
const VAULT = "0x53f8f390fd4f70941c5d160a964f6893c8dbceff";
const MARKETS = {spot: {coin: "@142", name: "спот", note: "Hyperliquid, спот UBTC/USDC"}, perp: {coin: "BTC", name: "перп", note: "Hyperliquid, бессрочный контракт"}};
let mkt = "spot";
try { const v = localStorage.getItem("desk.mkt"); if (v && MARKETS[v]) mkt = v; } catch (e){}
const coin = () => MARKETS[mkt].coin;
const sane = (r) => +r.h < 5e6 && +r.l > 0 && +r.h / +r.l < 3;
let P = null;   // perp context: funding, open interest, volume
const LW = window.LightweightCharts;
const dark = () => window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const big = (n) => n != null && Math.abs(n) >= 1e9 ? (n < 0 ? "−$" : "$") + nf2.format(Math.abs(n) / 1e9) + " млрд" : usdBig(n);
const clock = (t) => new Date(t).toLocaleTimeString("ru-RU", {hour: "2-digit", minute: "2-digit", second: "2-digit"});

async function hl(body){
  const r = await fetch(API, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  if (!r.ok) throw new Error("hl " + r.status);
  return r.json();
}

/* ---------- header: price, funding, open interest, volume ---------- */
let lastPx = 0, fails = 0, wsOpen = false;
function renderLive(){
  const L = S.live, set = (id, v) => { $(id).textContent = v; };
  $("liveDot").classList.toggle("off", !L);
  set("liveText", L ? "Hyperliquid, " + (wsOpen ? "поток в реальном времени" : "обновление каждые 15 секунд") + ", последние данные в " + clock(L.at)
    : fails > 1 ? "Живые данные Hyperliquid сейчас недоступны, показаны цифры из отчёта" : "Подключаюсь к Hyperliquid…");
  if (!P){ for (const id of ["lFund","lOi","lVol"]) set(id, "—"); return; }
  const fund = $("lFund"); fund.classList.remove("up", "down");
  fund.textContent = pct(P.funding * 24 * 365 * 100, 1);
  if (P.funding > 0) fund.classList.add("up"); else if (P.funding < 0) fund.classList.add("down");
  set("lFundS", "в год; за час " + pct(P.funding * 100, 4) + ". Плюс: лонги платят шортам");
  set("lOi", big(P.oi * P.px)); set("lOiS", nf0.format(P.oi) + " BTC в открытых позициях перпа");
  set("lVol", big(P.vol)); set("lVolS", "оборот перпа BTC за сутки");
}
function applySpot(c){
  const px = +c.midPx || +c.markPx, prev = +c.prevDayPx;
  if (!(px > 0)) return;
  S.live = {price: px, chg: prev ? (px / prev - 1) * 100 : null, at: Date.now()};
  fails = 0;
  if (!lastPx || Math.abs(px / lastPx - 1) > 0.0004){ lastPx = px; D.recalc(); } else D.renderHero();
  renderLive();
}
function applyPerp(c){
  const px = +c.markPx || +c.midPx;
  if (!(px > 0)) return;
  P = {funding: +c.funding, oi: +c.openInterest, vol: +c.dayNtlVlm, px};
  renderLive();
}
async function tick(){
  if (wsOpen && S.live && Date.now() - S.live.at < 20000) return;
  try {
    const [sp, pp] = await Promise.all([hl({type: "spotMetaAndAssetCtxs"}), hl({type: "metaAndAssetCtxs"})]);
    const sc = sp[1].find((x) => x.coin === MARKETS.spot.coin);
    if (sc) applySpot(sc);
    applyPerp(pp[1][pp[0].universe.findIndex((u) => u.name === "BTC")]);
  } catch (e){
    fails++;
    if (S.live && Date.now() - S.live.at > 120000){ S.live = null; D.recalc(); }
    renderLive();
  }
}

/* ---------- BTC chart ---------- */
const STEP = {"1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 14400e3, "1d": 864e5, "1w": 6048e5};
const PAGE = 1000;
const UPV = "rgba(12,163,12,.35)", DNV = "rgba(208,59,59,.35)";
let chart = null, series = null, volSeries = null, lines = [], tf = "1d";
let data = [], vols = [], earliest = 0, noMore = false, loadingMore = false, gen = 0, chartOk = false, expanded = false;
try { const v = localStorage.getItem("desk.tf"); if (v && STEP[v]) tf = v; } catch (e){}
const shift = () => STEP[tf] < 864e5 ? -new Date().getTimezoneOffset() * 60 : 0;
const bar = (r) => ({time: Math.floor(r.t / 1000) + shift(), open: +r.o, high: +r.h, low: +r.l, close: +r.c});
const volBar = (r, b) => ({time: b.time, value: +r.v, color: b.close >= b.open ? UPV : DNV});

function chartOpts(){
  return {
    autoSize: true,
    layout: {background: {type: "solid", color: css("--surface")}, textColor: css("--ink-2"), fontFamily: css("--f-body") || "system-ui"},
    grid: {vertLines: {color: css("--rule")}, horzLines: {color: css("--rule")}},
    rightPriceScale: {borderColor: css("--rule-strong")},
    timeScale: {borderColor: css("--rule-strong"), timeVisible: true, secondsVisible: false, rightOffset: 6},
    crosshair: {mode: 0},
    localization: {locale: "ru-RU"},
  };
}
function candleOpts(){
  return {upColor: css("--up"), downColor: css("--down"), wickUpColor: css("--up"), wickDownColor: css("--down"), borderVisible: false,
    priceLineColor: css("--ink-3"), priceFormat: {type: "price", precision: 0, minMove: 1}};
}
function drawLines(){
  if (!series) return;
  for (const l of lines) series.removePriceLine(l);
  lines = [];
  for (const t of S.targets) lines.push(series.createPriceLine({price: t.price, color: css("--tier"), lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: t.note || "цель"}));
  for (const l of D.levelSet().levels) lines.push(series.createPriceLine({price: l.value, color: css("--ink-3"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: l.name}));
}
function legend(b){
  const el = $("lwLegend"); if (!b){ el.textContent = ""; return; }
  const ch = b.open ? (b.close / b.open - 1) * 100 : 0;
  el.textContent = "BTC " + MARKETS[mkt].name + " · О " + nf0.format(b.open) + "  В " + nf0.format(b.high) + "  Н " + nf0.format(b.low) + "  З " + nf0.format(b.close) + "  " + pct(ch, 2);
}
function ensureChart(){
  if (chart || !LW) return;
  chart = LW.createChart($("lw"), chartOpts());
  chart.applyOptions({handleScroll: {vertTouchDrag: false}});
  series = chart.addCandlestickSeries(candleOpts());
  series.priceScale().applyOptions({scaleMargins: {top: 0.08, bottom: 0.24}});
  volSeries = chart.addHistogramSeries({priceFormat: {type: "volume"}, priceScaleId: "", lastValueVisible: false, priceLineVisible: false});
  volSeries.priceScale().applyOptions({scaleMargins: {top: 0.82, bottom: 0}});
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && r.from < 40) loadMore(); });
  chart.subscribeCrosshairMove((p) => {
    const d = p && p.seriesData ? p.seriesData.get(series) : null;
    legend(d || data[data.length - 1]);
  });
}
function setAll(){ series.setData(data); volSeries.setData(vols); }
async function loadCandles(){
  const note = $("lwNote");
  if (!LW){ note.textContent = "Библиотека графика не загрузилась, обновите страницу."; return; }
  ensureChart();
  for (const b of document.querySelectorAll("#tf button")) b.setAttribute("aria-pressed", String(b.dataset.tf === tf));
  for (const b of document.querySelectorAll("#mk button")) b.setAttribute("aria-pressed", String(b.dataset.mk === mkt));
  $("mkNote").textContent = MARKETS[mkt].note;
  const my = ++gen; noMore = false; loadingMore = false;
  try {
    const now = Date.now();
    const rows = (await hl({type: "candleSnapshot", req: {coin: coin(), interval: tf, startTime: now - PAGE * STEP[tf], endTime: now}})).filter(sane).sort((a, b) => a.t - b.t);
    if (my !== gen) return;
    if (!rows.length) throw new Error("empty");
    data = rows.map(bar); vols = rows.map((r, i) => volBar(r, data[i])); earliest = rows[0].t;
    setAll(); chartOk = true; drawLines(); legend(data[data.length - 1]);
    chart.timeScale().setVisibleLogicalRange({from: Math.max(0, data.length - 140), to: data.length + 6});
    note.textContent = "Свечи BTC на Hyperliquid (" + (mkt === "spot" ? "спот, пара UBTC/USDC" : "бессрочный контракт") + "), обновляются в реальном времени. Тяните график, чтобы листать историю; колесо мыши или щипок меняют масштаб, двойной щелчок по шкале цены возвращает автомасштаб. Серые пунктирные линии: рыночные уровни.";
    wsSubscribe();
  } catch (e){
    if (my !== gen) return;
    chartOk = false;
    note.textContent = "Свечи с Hyperliquid сейчас не загрузились. Попробуйте обновить страницу.";
  }
}
async function loadMore(){
  if (loadingMore || noMore || !chartOk || !data.length) return;
  loadingMore = true; const my = gen;
  try {
    const end = earliest - 1;
    const rows = (await hl({type: "candleSnapshot", req: {coin: coin(), interval: tf, startTime: end - PAGE * STEP[tf], endTime: end}}))
      .filter((r) => r.t < earliest && sane(r)).sort((a, b) => a.t - b.t);
    if (my !== gen) return;
    if (!rows.length){ noMore = true; return; }
    const range = chart.timeScale().getVisibleLogicalRange();
    const ob = rows.map(bar);
    data = ob.concat(data); vols = rows.map((r, i) => volBar(r, ob[i])).concat(vols); earliest = rows[0].t;
    setAll();
    if (range) chart.timeScale().setVisibleLogicalRange({from: range.from + ob.length, to: range.to + ob.length});
  } catch (e){} finally { if (my === gen) loadingMore = false; }
}
function pushBar(r){
  if (!chartOk || !data.length || !sane(r)) return;
  const b = bar(r), last = data[data.length - 1];
  if (b.time < last.time) return;
  if (b.time === last.time){ data[data.length - 1] = b; vols[vols.length - 1] = volBar(r, b); }
  else { data.push(b); vols.push(volBar(r, b)); }
  series.update(b); volSeries.update(volBar(r, b));
}
async function refreshTail(){
  if (!chartOk || document.hidden) return;
  try {
    const now = Date.now(), my = gen;
    const rows = (await hl({type: "candleSnapshot", req: {coin: coin(), interval: tf, startTime: now - 200 * STEP[tf], endTime: now}})).sort((a, b) => a.t - b.t);
    if (my !== gen || !rows.length) return;
    const lastRaw = (data[data.length - 1].time - shift()) * 1000;
    if (rows[0].t > lastRaw){ loadCandles(); return; }
    for (const r of rows) if (r.t >= lastRaw) pushBar(r);
  } catch (e){}
}

/* ---------- WebSocket: candles and market context in real time ---------- */
let ws = null, wsKey = null, wsRetry = 0, pingTimer = 0, spotNext = null, perpNext = null, ctxTimer = 0;
const wsSend = (o) => { try { ws.send(JSON.stringify(o)); } catch (e){} };
function wsSubscribe(){
  const key = coin() + "|" + tf;
  if (!wsOpen || wsKey === key) return;
  if (wsKey){ const [c, i] = wsKey.split("|"); wsSend({method: "unsubscribe", subscription: {type: "candle", coin: c, interval: i}}); }
  wsSend({method: "subscribe", subscription: {type: "candle", coin: coin(), interval: tf}});
  wsKey = key;
}
function wsConnect(){
  if (!("WebSocket" in window)) return;
  try { ws = new WebSocket(WSS); } catch (e){ return; }
  ws.onopen = () => {
    wsOpen = true; wsRetry = 0; wsKey = null;
    wsSend({method: "subscribe", subscription: {type: "activeAssetCtx", coin: MARKETS.perp.coin}});
    wsSend({method: "subscribe", subscription: {type: "activeAssetCtx", coin: MARKETS.spot.coin}});
    wsSubscribe(); refreshTail();
    pingTimer = setInterval(() => wsSend({method: "ping"}), 30000);
    renderLive();
  };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch (x){ return; }
    if (m.channel === "candle"){ const r = m.data; if (r && r.s === coin() && r.i === tf) pushBar(r); return; }
    if ((m.channel !== "activeAssetCtx" && m.channel !== "activeSpotAssetCtx") || !m.data || !m.data.ctx) return;
    if (m.data.coin === MARKETS.spot.coin) spotNext = m.data.ctx; else if (m.data.coin === MARKETS.perp.coin) perpNext = m.data.ctx;
    if (!ctxTimer) ctxTimer = setTimeout(() => {
      ctxTimer = 0;
      if (perpNext){ applyPerp(perpNext); perpNext = null; }
      if (spotNext){ applySpot(spotNext); spotNext = null; }
    }, 800);
  };
  ws.onclose = () => {
    wsOpen = false; clearInterval(pingTimer); renderLive();
    wsRetry = Math.min(wsRetry + 1, 5);
    setTimeout(wsConnect, 1000 * Math.pow(2, wsRetry));
  };
  ws.onerror = () => { try { ws.close(); } catch (e){} };
}

/* ---------- expand the chart to the whole screen ---------- */
function setExpanded(on){
  expanded = on;
  $("chartPanel").classList.toggle("expanded", on);
  document.body.classList.toggle("noscroll", on);
  $("expand").textContent = on ? "Свернуть" : "Развернуть";
  if (chart) chart.applyOptions({handleScroll: {vertTouchDrag: on}});
}

/* ---------- vault, live ---------- */
let pnlChart = null, pnlSeries = null;
/* returns and drawdown from the vault's own history: each step's profit over the money that was in the vault at its start,
   so deposits and withdrawals do not distort it */
function vaultStats(det, av){
  const P = {}; for (const x of det.portfolio || []) if (x && x[0] && x[1]) P[x[0]] = x[1];
  const stat = (key) => {
    const a = P[key] && P[key].accountValueHistory, p = P[key] && P[key].pnlHistory;
    if (!Array.isArray(a) || !Array.isArray(p) || a.length < 2 || a.length !== p.length) return null;
    let idx = 1, peak = 1, dd = 0;
    for (let i = 1; i < a.length; i++){
      const base = +a[i - 1][1], dp = +p[i][1] - +p[i - 1][1];
      if (!(base > 1000) || !isFinite(dp) || dp / base < -0.95) continue;
      idx *= 1 + dp / base; peak = Math.max(peak, idx); dd = Math.min(dd, idx / peak - 1);
    }
    return {ret: (idx - 1) * 100, dd: dd * 100, pnl: +p[p.length - 1][1] - +p[0][1], from: +a[0][0], vlm: +P[key].vlm};
  };
  const d1 = stat("day"), w1 = stat("week"), m1 = stat("month"), all = P.allTime && P.allTime.pnlHistory;
  // money in and out: the change of the account that profit and loss does not explain
  const flow = (key) => {
    const a = P[key] && P[key].accountValueHistory, p = P[key] && P[key].pnlHistory;
    if (!Array.isArray(a) || !Array.isArray(p) || a.length < 2 || a.length !== p.length) return null;
    const v = (+a[a.length - 1][1] - +a[0][1]) - (+p[p.length - 1][1] - +p[0][1]);
    return isFinite(v) ? v : null;
  };
  const pnlAll = Array.isArray(all) && all.length ? +all[all.length - 1][1] : null;
  const dep = pnlAll != null && isFinite(pnlAll) && av > 0 ? av - pnlAll : null;   // everything depositors put in, net of withdrawals
  // depositors the exchange lists: each one's result against the money he put in
  const fl = (Array.isArray(det.followers) ? det.followers : []).map((f) => {
    const eq = +f.vaultEquity, pnl = +f.allTimePnl, put = eq - pnl;
    return isFinite(eq) && isFinite(pnl) && put > 1 ? {r: pnl / put * 100, days: +f.daysFollowing} : null;
  }).filter(Boolean);
  const mid = (xs) => { const a = xs.filter(isFinite).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
  const who = fl.length >= 5 ? {n: fl.length, up: fl.filter((f) => f.r > 0).length, med: mid(fl.map((f) => f.r)),
    best: Math.max(...fl.map((f) => f.r)), worst: Math.min(...fl.map((f) => f.r)), days: mid(fl.map((f) => f.days))} : null;
  return {name: String(det.name || "Вольт").slice(0, 60), address: VAULT, at: Date.now(), tvl: av,
    dep: dep > 0 ? dep : null, depRet: dep > 0 ? pnlAll / dep * 100 : null, flow1w: flow("week"), flow1m: flow("month"), who,
    ret1d: d1 ? d1.ret : null, pnl1d: d1 ? d1.pnl : null, ret1w: w1 ? w1.ret : null, pnl1w: w1 ? w1.pnl : null,
    ret1m: m1 ? m1.ret : null, pnl1m: m1 ? m1.pnl : null, dd1m: m1 ? m1.dd : null, vlm1m: m1 && isFinite(m1.vlm) ? m1.vlm : null, monthFrom: m1 ? m1.from : 0,
    pnlAll,
    fee: typeof det.leaderCommission === "number" ? det.leaderCommission : null, btc1m: S.vaultLive ? S.vaultLive.btc1m : null};
}
let vBtc = {from: 0, px: 0};
async function vaultBtc(){   // bitcoin over the same window as the vault's month
  const v = S.vaultLive; if (!v || !v.monthFrom || !S.live) return;
  const hour = Math.floor(v.monthFrom / 3600e3) * 3600e3;
  try {
    if (vBtc.from !== hour){
      const rows = await hl({type: "candleSnapshot", req: {coin: "BTC", interval: "1h", startTime: hour - 3600e3, endTime: hour + 3600e3}});
      const r = rows.filter(sane).sort((a, b) => a.t - b.t).pop();
      if (r) vBtc = {from: hour, px: +r.c};
    }
    if (vBtc.px > 0 && S.vaultLive && S.live){ S.vaultLive.btc1m = (S.live.price / vBtc.px - 1) * 100; D.renderVault(); D.renderHero(); }
  } catch (e){}
}
async function loadVault(){
  if (document.hidden) return;
  try {
    const [det, st] = await Promise.all([hl({type: "vaultDetails", vaultAddress: VAULT}), hl({type: "clearinghouseState", user: VAULT})]);
    const av = +st.marginSummary.accountValue, ntl = +st.marginSummary.totalNtlPos;
    S.liveVault = {av, lev: av > 0 ? ntl / av : 0, at: Date.now()};
    S.vaultLive = vaultStats(det, av); D.renderVault(); D.renderHero(); vaultBtc();
    $("vLive").hidden = false;
    $("vlAv").textContent = usdBig(av);
    $("vlLev").textContent = nf2.format(S.liveVault.lev) + "x";
    $("vlLevS").textContent = "позиций на " + usdBig(ntl) + " при счёте " + usdBig(av);
    $("vlApr").textContent = typeof det.apr === "number" ? pct(det.apr * 100, 1) : "—";
    $("vlLead").textContent = typeof det.leaderFraction === "number" ? nf2.format(det.leaderFraction * 100) + "%" : "—";
    $("vlStamp").textContent = "Hyperliquid, обновлено в " + clock(Date.now());
    $("lLev").textContent = nf2.format(S.liveVault.lev) + "x"; $("lLevS").textContent = "вольт DOUBLETOP, позиций на " + usdBig(ntl);

    const tb = $("vPos").tBodies[0]; tb.replaceChildren();
    const pos = (st.assetPositions || []).map((p) => p.position).filter((p) => p && +p.szi !== 0)
      .sort((a, b) => Math.abs(+b.positionValue) - Math.abs(+a.positionValue));
    if (!pos.length) tb.append(h("tr", null, h("td", {colspan: 6, class: "muted", text: "Открытых позиций нет: вольт сейчас в долларах."})));
    for (const p of pos){
      const long = +p.szi > 0, pnl = +p.unrealizedPnl;
      tb.append(h("tr", null,
        h("td", null, String(p.coin).slice(0, 20), h("span", {class: "sub", text: (long ? "лонг" : "шорт") + ", " + (ntl > 0 ? Math.round(Math.abs(+p.positionValue) / ntl * 100) : 0) + "% позиций"})),
        h("td", {class: "r", text: usd(Math.abs(+p.positionValue))}),
        h("td", {class: "r"}, av > 0 ? nf2.format(Math.abs(+p.positionValue) / av) + "x" : "—",   // the position against the account, not the exchange setting
          p.leverage && p.leverage.value ? h("span", {class: "sub", text: "лимит " + p.leverage.value + "x"}) : null),
        h("td", {class: "r", text: p.entryPx ? nf2.format(+p.entryPx) : "—"}),
        h("td", {class: "r", text: p.liquidationPx ? nf2.format(+p.liquidationPx) : "нет"}),
        h("td", {class: "r"}, h("span", {class: pnl > 0 ? "up" : pnl < 0 ? "down" : null, text: (pnl > 0 ? "+" : "") + usd(Math.round(pnl))}))));
    }

    $("vPosNote").textContent = pos.length ? "Плечо: размер позиции к счёту вольта, по всем позициям в сумме выходит общее плечо " + nf2.format(S.liveVault.lev)
      + "x. Лимит: настройка на бирже, до скольких раз позицию разрешено увеличить; сама она ничего не говорит о размере позиции."
      + (pos.some((x) => x.liquidationPx) ? "" : " Цены ликвидации нет: позиции в сумме не больше счёта, и он не обнулится, пока активы не упадут почти до нуля.") : "";
    const all = (det.portfolio || []).find((x) => x && x[0] === "allTime");
    const hist = all && all[1] && Array.isArray(all[1].pnlHistory) ? all[1].pnlHistory : [];
    const seen = new Set(); const pts = [];
    for (const [t, v] of hist){ const s = Math.floor(t / 1000); if (!seen.has(s) && isFinite(+v)){ seen.add(s); pts.push({time: s, value: +v}); } }
    pts.sort((a, b) => a.time - b.time);
    if (LW && pts.length > 1){
      $("vPnlBox").hidden = false;
      if (!pnlChart){
        pnlChart = LW.createChart($("vPnlChart"), Object.assign(chartOpts(), {handleScroll: false, handleScale: false}));
        pnlSeries = pnlChart.addBaselineSeries({baseValue: {type: "price", price: 0}, topLineColor: css("--up"), bottomLineColor: css("--down"),
          topFillColor1: "rgba(12,163,12,.18)", topFillColor2: "rgba(12,163,12,.02)", bottomFillColor1: "rgba(208,59,59,.02)", bottomFillColor2: "rgba(208,59,59,.18)", lineWidth: 2,
          priceFormat: {type: "custom", minMove: 1, formatter: (v) => usdBig(v)}});
      }
      pnlSeries.setData(pts); pnlChart.timeScale().fitContent();
    }
  } catch (e){
    if (!S.liveVault) $("vLive").hidden = true;
    if (S.vaultLive && Date.now() - S.vaultLive.at > 30 * 60e3){ S.vaultLive = null; D.renderVault(); D.renderHero(); }   // no stale vault figures
  }
}

/* ---------- TradingView widgets ---------- */
function tv(hostId, file, cfg){
  const host = $(hostId);
  const box = h("div", {class: "tradingview-widget-container", style: "height:100%;width:100%"},
    h("div", {class: "tradingview-widget-container__widget", style: "height:100%;width:100%"}));
  const sc = document.createElement("script");
  sc.type = "text/javascript"; sc.async = true;
  sc.src = "https://s3.tradingview.com/external-embedding/" + file;
  sc.textContent = JSON.stringify(cfg);
  box.append(sc);
  for (const old of host.querySelectorAll(".tradingview-widget-container")) old.remove();
  host.append(box);
}
/* folders: a watchlist grouped by asset class, each instrument opens in the TradingView chart */
let tvDone = false, WL = [], fIdx = 0, picked = {};
const symOk = (s) => typeof s === "string" && /^[A-Za-z0-9_.]{1,20}:[A-Za-z0-9_.!]{1,24}$/.test(s);
try { picked = JSON.parse(localStorage.getItem("desk.picked") || "{}") || {}; } catch (e){ picked = {}; }
const curSym = () => { const f = WL[fIdx]; const p = picked[f.name]; return f.items.some((it) => it.s === p) ? p : f.items[0].s; };
async function loadWatch(){
  try {
    const d = await (await fetch("watchlist.json", {cache: "no-store"})).json();
    WL = (Array.isArray(d.folders) ? d.folders : []).slice(0, 12).map((f) => ({
      name: String(f.name || "").slice(0, 30),
      items: (Array.isArray(f.items) ? f.items : []).slice(0, 30).filter((it) => it && symOk(it.s)).map((it) => ({s: it.s, n: String(it.n || it.s).slice(0, 30), l: typeof it.l === "string" && /^[A-Za-z0-9\/_-]{1,60}$/.test(it.l) ? it.l : "", h: typeof it.h === "string" && /^([a-z]{2,8}:)?[A-Za-z0-9]{1,16}$/.test(it.h) ? it.h : ""})),
    })).filter((f) => f.name && f.items.length);
    let saved = null; try { saved = localStorage.getItem("desk.fold"); } catch (e){}
    const i = WL.findIndex((f) => f.name === saved); fIdx = i < 0 ? 0 : i;
  } catch (e){ WL = []; }
  renderFolders();
}
function renderFolders(){
  if (!WL.length){ $("fold").replaceChildren(); $("foldItems").replaceChildren(); return; }
  const cur = curSym();
  $("fold").replaceChildren(...WL.map((f, i) => h("button", {type: "button", "aria-pressed": String(i === fIdx), text: f.name, onclick: () => {
    fIdx = i; try { localStorage.setItem("desk.fold", f.name); } catch (e){}
    renderFolders(); if (tvDone){ showChart(); showQuotes(); }
  }})));
  $("foldItems").replaceChildren(...WL[fIdx].items.map((it) => {
    const ph = () => h("span", {class: "tk-ph", "aria-hidden": "true", text: it.n.slice(0, 1).toUpperCase()});
    let logo = ph();
    if (it.l){
      const img = h("img", {class: "tk-logo", alt: "", loading: "lazy", width: 28, height: 28, src: "https://s3-symbol-logo.tradingview.com/" + it.l + ".svg"});
      img.addEventListener("error", () => img.replaceWith(ph()));
      logo = img;
    }
    const b = h("button", {type: "button", class: "tk" + (it.s === cur ? " on" : ""), "aria-pressed": String(it.s === cur), title: it.s, "data-s": it.s},
      logo, h("span", {class: "tk-t"}, h("span", {class: "tk-n", text: it.n}), h("span", {class: "tk-s", text: it.s.split(":")[1]})),
      h("span", {class: "tk-q", "data-h": it.h || null, text: it.h ? "…" : "—", title: it.h ? null : "На Hyperliquid такого рынка нет"}));
    b.addEventListener("click", () => {
      picked[WL[fIdx].name] = it.s; try { localStorage.setItem("desk.picked", JSON.stringify(picked)); } catch (e){}
      for (const x of document.querySelectorAll("#foldItems .tk")){ const on = x.dataset.s === it.s; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); }
      if (tvDone) showChart(); else watchReady.then(initTv);
    });
    return b;
  }));
  $("foldItems").scrollTop = 0; $("foldItems").scrollLeft = 0;
  paintQuotes(); loadOpens();
}
/* live change of the current daily candle for the side list, from Hyperliquid perps:
   the main venue for crypto, the xyz venue for stocks, indices, commodities and FX */
const Q = {}, OPEN = {};
const utcDay = () => Math.floor(Date.now() / 864e5);
function paintQuotes(){
  const day = utcDay();
  for (const el of document.querySelectorAll("#foldItems .tk-q[data-h]")){
    const q = Q[el.dataset.h], o = OPEN[el.dataset.h];
    el.classList.remove("up", "down");
    if (!q || !o || o.day !== day){ el.textContent = "…"; el.removeAttribute("title"); continue; }
    const ch = Math.round((q.px / o.o - 1) * 10000) / 100 || 0;
    el.textContent = (ch > 0 ? "▲ " : ch < 0 ? "▼ " : "") + pct(ch, 2);
    el.title = "Дневная свеча с 00:00 UTC, перп " + el.dataset.h + " на Hyperliquid: открытие " + nf2.format(o.o) + ", сейчас " + nf2.format(q.px);
    if (ch > 0) el.classList.add("up"); else if (ch < 0) el.classList.add("down");
  }
}
let opensBusy = false;
async function loadOpens(){
  if (opensBusy || !WL.length || document.hidden) return;
  const day = utcDay();
  const need = WL[fIdx].items.map((it) => it.h).filter((x) => x && !(OPEN[x] && OPEN[x].day === day));
  if (!need.length) return;
  opensBusy = true;
  try {
    for (let i = 0; i < need.length; i += 4){
      await Promise.all(need.slice(i, i + 4).map(async (coinName) => {
        try {
          const now = Date.now();
          const rows = await hl({type: "candleSnapshot", req: {coin: coinName, interval: "1d", startTime: now - 3 * 864e5, endTime: now}});
          const last = rows.sort((a, b) => a.t - b.t).pop();
          if (last && Math.floor(last.t / 864e5) === day && +last.o > 0) OPEN[coinName] = {day, o: +last.o};
        } catch (e){}
      }));
      paintQuotes();
    }
  } finally { opensBusy = false; }
}
async function pollQuotes(){
  if (document.hidden || !WL.length) return;
  const take = (res, prefix) => { const [m, c] = res; m.universe.forEach((u, i) => { const px = +(c[i].markPx || c[i].midPx); if (px > 0) Q[prefix && !u.name.includes(":") ? prefix + ":" + u.name : u.name] = {px}; }); };
  const jobs = [hl({type: "metaAndAssetCtxs"}).then((r) => take(r, "")), hl({type: "metaAndAssetCtxs", dex: "xyz"}).then((r) => take(r, "xyz"))];
  await Promise.all(jobs.map((p) => p.catch(() => {})));
  paintQuotes();
  loadOpens();
  $("tkNote").textContent = Object.keys(Q).length ? "Проценты: изменение с открытия текущей дневной свечи (00:00 UTC) по перпам Hyperliquid, обновлено в " + clock(Date.now()) + ". Прочерк: такого рынка там нет." : "Проценты с Hyperliquid сейчас не загрузились.";
}
const tvTheme = () => dark() ? "dark" : "light";
function showChart(){
  tv("tvChart", "embed-widget-advanced-chart.js", {autosize: true, symbol: WL.length ? curSym() : "OANDA:NAS100USD", interval: "D", timezone: "Europe/Warsaw", theme: tvTheme(), style: "1", locale: "ru",
    backgroundColor: css("--surface"), gridColor: css("--rule"), allow_symbol_change: true, hide_side_toolbar: false, withdateranges: true, calendar: false, support_host: "https://www.tradingview.com"});
}
function showQuotes(){
  const box = $("tvQuotes");
  box.parentNode.hidden = !WL.length;
  if (!WL.length) return;
  const f = WL[fIdx];
  box.style.height = (84 + f.items.length * 38) + "px";   // a row of the widget is about 36px tall
  tv("tvQuotes", "embed-widget-market-quotes.js", {width: "100%", height: "100%", symbolsGroups: [{name: f.name, symbols: f.items.map((it) => ({name: it.s, displayName: it.n}))}],
    showSymbolLogo: true, isTransparent: true, colorTheme: tvTheme(), locale: "ru"});
}
function initTv(){
  if (tvDone) return; tvDone = true;
  showChart(); showQuotes();
  tv("tvCal", "embed-widget-events.js", {colorTheme: tvTheme(), isTransparent: true, width: "100%", height: "100%", locale: "ru", importanceFilter: "0,1", countryFilter: "us,eu,jp,cn,kr,gb"});
}

/* ---------- ETF flows: The Block embeds, plus the daily totals that come with the morning report ---------- */
const ETF = [
  {k: "btc", n: "BTC", flows: "spot-bitcoin-etf-flows", total: "spot-bitcoin-etf-total-net-flow", soso: "us-btc-spot", far: "btc", cur: "1673723677362319866", type: 1},
  {k: "eth", n: "ETH", flows: "spot-ethereum-etf-flows", total: "spot-ethereum-etf-total-net-flows", soso: "us-eth-spot", far: "eth", cur: "1673723677362319867", type: 4},
  {k: "sol", n: "SOL", flows: "spot-solana-etf-flows", total: "spot-solana-etf-total-net-flows", soso: "us-sol-spot", far: "sol", cur: "1673723677362319875", type: 0},
  {k: "xrp", n: "XRP", flows: "spot-xrp-etf-flows", total: "spot-xrp-etf-total-net-flows", soso: "us-xrp-spot", cur: "1673723677362319871", type: 0},
  {k: "hype", n: "HYPE", flows: "hype-spot-etf-flows", total: "spot-hype-etf-total-net-flows", soso: "us-hype-spot", far: "hyp", cur: "1862702593582522369", type: 0},
];
let eIdx = 0, etfDone = false;
try { const i = ETF.findIndex((a) => a.k === localStorage.getItem("desk.etf")); if (i > 0) eIdx = i; } catch (e){}
const flowTxt = (m) => !m ? "$0" : (m > 0 ? "+" : "−") + "$" + (Math.abs(m) >= 1000 ? nf2.format(Math.abs(m) / 1000) + " млрд" : nf1.format(Math.abs(m)) + " млн");
const plur = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
const sum = (rows) => rows.reduce((t, x) => t + x.flow, 0);
/* daily totals straight from SoSoValue: the endpoint its own ETF pages use, open to other sites; rows come oldest first */
const SOSO = "https://gw.sosovalue.com/finance/etf-statistics-do/findPage", SOSO_PAGE = 50;
const SO = {}, soBusy = {};
async function sosoPage(a, pageNum){
  const r = await fetch(SOSO, {method: "POST", headers: {"Content-Type": "application/json"}, credentials: "omit",
    body: JSON.stringify({pageNum, pageSize: SOSO_PAGE, currencyId: a.cur, market: "US", period: "1d", type: a.type})});
  if (!r.ok) throw new Error("soso " + r.status);
  const j = await r.json();
  if (!j || j.code !== 0 || !j.data || !Array.isArray(j.data.list)) throw new Error("soso shape");
  return j.data;
}
const sosoRows = (pages) => {
  const m = new Map();
  for (const pg of pages) for (const x of pg.list){
    const date = String(x && x.dataDate || "").slice(0, 10), v = x ? +x.totalNetInflow : NaN;
    if (/^\d{4}-\d\d-\d\d$/.test(date) && isFinite(v) && Math.abs(v) < 1e11) m.set(date, {date, flow: v / 1e6, aum: +x.totalNetAssets > 0 ? +x.totalNetAssets : null});
  }
  return [...m.values()].sort((p, q) => p.date < q.date ? -1 : 1);
};
async function loadSoso(k, force){
  const a = ETF.find((x) => x.k === k), c = SO[k];
  if (!a || soBusy[k] || document.hidden || (!force && c && Date.now() - c.tried < 15 * 60e3)) return;
  soBusy[k] = true;
  try {
    const first = await sosoPage(a, 1), total = +first.total || 0;
    let rows = sosoRows([first]);
    const lastPage = Math.ceil(total / SOSO_PAGE);
    if (lastPage > 1){   // newest rows sit on the last page; take the one before it too when the last is nearly empty
      const need = [lastPage]; if (total % SOSO_PAGE && total % SOSO_PAGE < 35) need.unshift(lastPage - 1);
      const tail = sosoRows(await Promise.all(need.filter((n) => n > 1).map((n) => sosoPage(a, n))));
      if (tail.length && (!rows.length || tail[tail.length - 1].date > rows[rows.length - 1].date)) rows = tail;   // if the order ever flips, page one already holds the newest
    }
    if (rows.length < 5) throw new Error("soso short");
    SO[k] = {tried: Date.now(), at: Date.now(), rows, err: false};
  } catch (e){ SO[k] = Object.assign({rows: null, at: 0}, SO[k], {tried: Date.now(), err: true}); }   // keep what was loaded before
  soBusy[k] = false;
  if (ETF[eIdx].k === k) renderEtfDays();
}
function etfSeries(k){
  if (SO[k] && SO[k].rows) return SO[k].rows.slice(-30);
  const m = new Map();
  for (const d of S.digests.slice().reverse()) if (d.etf) for (const x of d.etf[k] || []) m.set(x.date, x.flow);   // a newer report overrides an older one
  return [...m].map(([date, flow]) => ({date, flow})).sort((a, b) => a.date < b.date ? -1 : 1).slice(-30);
}
function setFlow(id, v){ const el = $(id); el.textContent = flowTxt(v); el.classList.toggle("up", v > 0); el.classList.toggle("down", v < 0); }
function renderEtfDays(){
  const a = ETF[eIdx], box = $("etfDays");
  let rows = etfSeries(a.k);
  if (rows.length && Date.now() - D.parseDate(rows[rows.length - 1].date) > 10 * 864e5) rows = [];   // a feed that stopped hides itself
  box.hidden = !rows.length;
  $("etfGrid").classList.toggle("has-days", rows.length > 0);
  if (!rows.length) return;
  const last = rows[rows.length - 1], wk = rows.slice(-5);
  $("etfDaysT").textContent = "Спотовые " + a.n + "-ETF по дням";
  $("etfDaysS").textContent = "чистый поток всех фондов, последний день " + longDate(last.date) + (last.aum ? " · в фондах " + big(last.aum) : "");
  setFlow("efLast", last.flow); $("efLastS").textContent = longDate(last.date);
  setFlow("efWeek", sum(wk)); $("efWeekS").textContent = wk.length < 5 ? "пока есть только " + wk.length + " " + plur(wk.length, "сессия", "сессии", "сессий") : shortDate(wk[0].date) + " – " + shortDate(last.date);
  $("efAllL").textContent = "За " + rows.length + " " + plur(rows.length, "сессию", "сессии", "сессий");
  setFlow("efAll", sum(rows)); $("efAllS").textContent = "с " + shortDate(rows[0].date) + " по " + shortDate(last.date);
  let run = 0; const sg = Math.sign(last.flow);
  if (sg) for (let i = rows.length - 1; i >= 0 && Math.sign(rows[i].flow) === sg; i--) run++;
  const runEl = $("efRun"); runEl.classList.toggle("up", sg > 0); runEl.classList.toggle("down", sg < 0);
  runEl.textContent = run ? run + " " + plur(run, "день", "дня", "дней") : "—";
  $("efRunS").textContent = run ? (sg > 0 ? "притоки" : "оттоки") + " подряд, всего " + flowTxt(sum(rows.slice(-run))) : "в последний день поток нулевой";

  const maxP = Math.max(0, ...rows.map((x) => x.flow)), maxN = Math.max(0, ...rows.map((x) => -x.flow)), tot = maxP + maxN || 1;
  const fp = Math.max(maxP, tot * 0.08), fn = Math.max(maxN, tot * 0.08);
  const step = rows.length <= 8 ? 1 : 5;
  const say = (x) => longDate(x.date) + ": " + flowTxt(x.flow) + (x.flow > 0 ? ", приток" : x.flow < 0 ? ", отток" : "");
  const bars = $("efBars");
  bars.replaceChildren(...rows.map((x, i) => h("div", {class: "ef-col", "data-i": i, title: say(x)},
    h("div", {class: "ef-plot", style: "grid-template-rows:" + fp + "fr " + fn + "fr"},
      h("div", {class: "ef-half up"}, x.flow > 0 ? h("i", {style: "height:max(2px," + (x.flow / fp * 100).toFixed(2) + "%)"}) : null),
      h("div", {class: "ef-half dn"}, x.flow < 0 ? h("i", {style: "height:max(2px," + (-x.flow / fn * 100).toFixed(2) + "%)"}) : null)),
    h("div", {class: "ef-x"}, (rows.length - 1 - i) % step === 0 ? h("span", {text: shortDate(x.date)}) : null))));
  const pick = (i) => {
    const x = rows[i]; if (!x) return;
    for (const c of bars.children) c.classList.toggle("on", +c.dataset.i === i);
    $("efRead").textContent = say(x);
  };
  bars.onpointerover = bars.onclick = (e) => { const c = e.target.closest ? e.target.closest(".ef-col") : null; if (c) pick(+c.dataset.i); };
  pick(rows.length - 1);
  const live = SO[a.k], src = S.digests.find((d) => d.etf && (d.etf[a.k] || []).length);
  const from = live && live.rows
    ? "Данные SoSoValue, загружены в " + clock(live.at).slice(0, 5) + (live.err ? " (последняя попытка обновить не удалась)" : "") + ". Сумма за последний день может уточняться, пока отчитались не все фонды."
    : (live && live.err ? "SoSoValue сейчас не отвечает, показаны суммы из утреннего отчёта" : "Загружаю данные SoSoValue, пока показаны суммы из утреннего отчёта") + (src ? " от " + longDate(src.date) : "") + ".";
  $("efNote").textContent = "Столбик вверх: в фонды пришли деньги, вниз: ушли. " + from + " Разбивка по фондам и вся история с запуска: на соседних графиках The Block.";
}
function etfFrame(hostId, path, title){
  const host = $(hostId);
  const f = h("iframe", {src: "https://www.theblock.co/data/etfs/" + path + "/embed?theme=" + (dark() ? "dark" : "light"), title, loading: "lazy",
    sandbox: "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads", referrerpolicy: "strict-origin-when-cross-origin"});
  for (const old of host.querySelectorAll("iframe")) old.remove();
  host.append(f);
}
function showEtf(){
  const a = ETF[eIdx];
  $("etfFlowsT").textContent = a.n + "-ETF по фондам: кто принёс и кто забрал";
  $("etfTotalT").textContent = a.n + "-ETF, все фонды вместе";
  etfFrame("etfFlows", a.flows, "Потоки спотовых " + a.n + "-ETF по фондам, The Block");
  etfFrame("etfTotal", a.total, "Суммарный чистый поток спотовых " + a.n + "-ETF, The Block");
}
function renderEtf(){
  const a = ETF[eIdx];
  $("etfAsset").replaceChildren(...ETF.map((x, i) => h("button", {type: "button", "aria-pressed": String(i === eIdx), text: x.n, onclick: () => {
    if (i === eIdx) return;
    eIdx = i; try { localStorage.setItem("desk.etf", x.k); } catch (e){}
    renderEtf(); if (etfDone) showEtf();
  }})));
  const link = (text, href) => h("a", {href, target: "_blank", rel: "noopener", text});
  $("etfLinks").replaceChildren("Суммы по дням: ", link("SoSoValue", "https://sosovalue.com/ru/assets/etf/" + a.soso), ...(a.far ? [" · по фондам: ", link("таблица Farside", "https://farside.co.uk/" + a.far + "/")] : []));
  renderEtfDays();
  loadSoso(a.k);
}
function initEtf(){ if (etfDone) return; etfDone = true; showEtf(); }

/* ---------- Fed: meeting calendar (fed-calendar.json) and market odds for each meeting (fed.json).
   fed.json is rebuilt every hour by a GitHub job (tools/feeds.py) from Kalshi and FRED; the site reads the job's
   "data" branch and falls back to the daily copy next to the page. Numbers that stop updating hide themselves. ---------- */
let FED = null, CAL = null, fedSel = null;
const FED_OLD = 36 * 3600e3, FED_DEAD = 4 * 864e5;   // "not refreshed for a while" and "hide the odds"
const OUTS = [{k: "up", name: "Повышение", verb: "повысят", cssVar: "--s1"}, {k: "hold", name: "Без изменений", verb: "оставят как есть", cssVar: "--s2"}, {k: "down", name: "Снижение", verb: "снизят", cssVar: "--s3"}];
const r2 = (x) => x.toFixed(2).replace(".", ",");
const rngTxt = (lo) => r2(lo) + "–" + r2(lo + 0.25) + "%";
const pc1 = (v) => v == null ? "—" : nf1.format(v) + "%";
function nyInstant(dateStr, hour){   // the moment it is hour:00 in New York on that date
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d, hour + 5);
  const shown = +new Intl.DateTimeFormat("en-US", {timeZone: "America/New_York", hour: "numeric", hourCycle: "h23"}).format(new Date(t));
  return t + (hour - shown) * 3600e3;
}
const dayMonth = (t, opt) => new Date(t).toLocaleDateString("ru-RU", Object.assign({day: "numeric", month: "long"}, opt || {}));
const isoDay = (iso) => dayMonth(D.parseDate(iso));
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
function meetLabel(sc){
  const a = D.parseDate(sc.start), b = D.parseDate(sc.end), y = " " + b.getFullYear();
  return a.getMonth() === b.getMonth() ? a.getDate() + "–" + dayMonth(b) + y : dayMonth(a) + " – " + dayMonth(b) + y;
}
function leftTxt(ms){
  const min = Math.max(0, Math.floor(ms / 60e3)), d = Math.floor(min / 1440), hh = Math.floor(min % 1440 / 60), mm = min % 60;
  return d >= 1 ? d + " " + plur(d, "день", "дня", "дней") + (d < 30 && hh ? " " + hh + " ч" : "") : hh ? hh + " ч " + mm + " мин" : mm + " мин";
}
const isD = (v) => typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v), numOk = (v) => typeof v === "number" && isFinite(v) ? v : null;
const httpsUrl = (v) => typeof v === "string" && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : "";
async function getJson(url, ms){
  const c = new AbortController(), tm = setTimeout(() => c.abort(), ms || 8000);
  try { const r = await fetch(url, {cache: "no-store", signal: c.signal}); if (!r.ok) throw new Error("http " + r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}
function fedDataUrl(){   // the job's branch of this same repository, when the page is served by GitHub Pages
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname), repo = location.pathname.split("/")[1];
  return m && repo ? "https://raw.githubusercontent.com/" + m[1] + "/" + repo + "/data/fed.json" : "";
}
function normFed(d){
  const pct = (v) => { const x = numOk(v); return x != null && x >= 0 && x <= 100 ? x : null; };
  const tri = (a) => Array.isArray(a) && a.length === 3 && a.every((x) => pct(x) != null) ? a : null;
  return {
    updated: Date.parse(d.updated) || 0, oddsAt: Date.parse(d.oddsAt) || 0, source: typeof d.source === "string" ? d.source.slice(0, 40) : "", url: httpsUrl(d.sourceUrl),
    cur: Array.isArray(d.band) ? numOk(d.band[0]) : null, bandAsOf: isD(d.bandAsOf) ? d.bandAsOf : "",
    last: d.last && isD(d.last.date) ? {date: d.last.date, move: numOk(d.last.move)} : null,
    meetings: (Array.isArray(d.meetings) ? d.meetings : []).slice(0, 30).filter((m) => m && isD(m.date) && pct(m.up) != null && pct(m.hold) != null && pct(m.down) != null)
      .map((m) => ({date: m.date, up: m.up, hold: m.hold, down: m.down, up25: pct(m.up25), down25: pct(m.down25), p1: tri(m.p1)})),
    hist: (Array.isArray(d.hist) ? d.hist : []).slice(-60).filter((x) => x && isD(x.d) && x.m && typeof x.m === "object"),
  };
}
async function loadFed(){
  try {
    const c = await getJson("fed-calendar.json");
    CAL = {calUrl: httpsUrl(c.scheduleSource), schedule: (Array.isArray(c.schedule) ? c.schedule : []).slice(0, 60).filter((x) => x && isD(x.start) && isD(x.end))
      .map((x) => ({start: x.start, end: x.end, sep: x.sep === true, noDecision: x.noDecision === true, at: nyInstant(x.end, 14)})).sort((a, b) => a.at - b.at)};
  } catch (e){ if (!CAL) CAL = {calUrl: "", schedule: []}; }
  let got = null;
  for (const u of [fedDataUrl(), "fed.json"]){
    if (!u) continue;
    try { const f = normFed(await getJson(u, 6000)); if (!got || f.updated > got.updated) got = f; if (Date.now() - f.updated < 3 * 3600e3) break; } catch (e){}
  }
  if (got) FED = got;
  renderFed(); renderOdds();
}
function fedSchedule(){   // the published calendar, continued by meetings the odds market already lists beyond it
  const sc = CAL ? CAL.schedule.slice() : [], lastEnd = sc.length ? sc[sc.length - 1].end : "";
  if (FED) for (const m of FED.meetings) if (m.date > lastEnd){ const e = D.parseDate(m.date); e.setDate(e.getDate() - 1);
    sc.push({start: e.getFullYear() + "-" + String(e.getMonth() + 1).padStart(2, "0") + "-" + String(e.getDate()).padStart(2, "0"), end: m.date, sep: false, noDecision: false, at: nyInstant(m.date, 14)}); }
  return sc;
}
function weekAgo(date){
  if (!FED) return null;
  const cut = isoOf(Date.now() - 7 * 864e5);
  let v = null;
  for (const x of FED.hist) if (x.d <= cut && Array.isArray(x.m[date]) && x.m[date].length === 3) v = x.m[date];
  return v;
}
function renderFed(){
  const now = Date.now(), all = fedSchedule(), up = all.filter((x) => x.at > now);
  $("fedNext").hidden = $("fedSched").hidden = !up.length;
  if (!up.length){ $("fedStamp").textContent = CAL ? "В календаре нет будущих заседаний" : "Календарь ФРС не загрузился"; return; }
  const age = FED && FED.oddsAt ? now - FED.oddsAt : Infinity, fresh = age < FED_DEAD;
  // after a decision the new range reaches the data a day later: until then the old one is not shown as current
  const curOk = !!FED && FED.cur != null && now - FED.updated < 10 * 864e5 && !all.some((x) => !x.noDecision && x.at <= now && x.end >= FED.bandAsOf);
  const byDate = fresh ? new Map(FED.meetings.map((m) => [m.date, m])) : new Map();
  const dataOf = (sc) => sc.noDecision ? null : byDate.get(sc.end) || null;
  if (!up.some((x) => x.end === fedSel && (dataOf(x) || x === up[0]))) fedSel = up[0].end;
  const sel = up.find((x) => x.end === fedSel), m = dataOf(sel);
  const stampTxt = fresh ? new Date(FED.oddsAt).toLocaleString("ru-RU", {day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"}) : "";
  $("fedStamp").textContent = fresh ? "вероятности с биржи прогнозов Kalshi, обновлено " + stampTxt + (age > FED_OLD ? " (давно не обновлялись)" : "")
    : "вероятности перестали обновляться и скрыты, календарь заседаний работает";

  $("fedNextT").textContent = (sel === up[0] ? "Ближайшее заседание: " : "Заседание ") + meetLabel(sel);
  $("fedNextS").textContent = sel.noDecision ? "стратегическое, без решения по ставке" : sel.sep ? "с новыми прогнозами ФРС" : "";
  $("fdWhen").textContent = sel.noDecision ? "—" : dayMonth(sel.at);
  $("fdWhenS").textContent = sel.noDecision ? "на этом заседании ставку не меняют" : new Date(sel.at).toLocaleDateString("ru-RU", {weekday: "long"}) + ", " + new Date(sel.at).toLocaleTimeString("ru-RU", {hour: "2-digit", minute: "2-digit"}) + " по местному времени (14:00 в Нью-Йорке)";
  $("fdLeft").textContent = leftTxt(sel.at - now);
  $("fdLeftS").textContent = sel.noDecision ? "до конца заседания" : "до объявления решения";
  $("fdCur").textContent = curOk ? rngTxt(FED.cur) : "—";
  $("fdCurS").textContent = !curOk ? (FED && FED.cur != null ? "после решения новая ставка попадает в данные на следующий день" : "данные о ставке не загрузились")
    : FED.last ? isoDay(FED.last.date) + " " + (FED.last.move == null ? "было заседание" : FED.last.move === 0 ? "оставили без изменений" : (FED.last.move > 0 ? "повысили на " : "снизили на ") + Math.abs(FED.last.move) + " б.п.") : "целевой диапазон ФРС";
  const top = m ? OUTS.reduce((a, b) => m[b.k] > m[a.k] ? b : a) : null, ti = top ? OUTS.indexOf(top) : -1, wk = m ? weekAgo(m.date) : null;
  const split = (o) => o.k === "up" && m.up25 != null ? "на 25 б.п. " + pc1(m.up25) + ", сильнее " + pc1(Math.max(0, m.up - m.up25))
    : o.k === "down" && m.down25 != null ? "на 25 б.п. " + pc1(m.down25) + ", сильнее " + pc1(Math.max(0, m.down - m.down25)) : "";
  $("fdExp").textContent = top ? pc1(m[top.k]) : "—";
  $("fdExpS").textContent = top ? "что ставку " + top.verb + (split(top) ? ": " + split(top) : "") + (m.p1 ? ". Сутки назад " + pc1(m.p1[ti]) : "")
    : sel.noDecision ? "решения по ставке не будет" : fresh ? "по этому заседанию ставок пока нет" : "вероятности скрыты: данные устарели";
  $("fdAvg").textContent = m && sel !== up[0] ? "Это шансы решения на самом этом заседании, а не того, какой ставка будет к этой дате." : "";
  $("fdOddsBox").hidden = !m;
  if (m){
    $("fdOdds").tHead.replaceChildren(h("tr", null, h("th", {text: "Исход"}), h("th", {class: "r", text: "Сейчас"}), m.p1 ? h("th", {class: "r", text: "Сутки назад"}) : null, wk ? h("th", {class: "r", text: "Неделю назад"}) : null));
    $("fdOdds").tBodies[0].replaceChildren(...OUTS.map((o, i) => h("tr", {class: o === top ? "fd-top" : null},
      h("td", null, h("i", {class: "fo-dot", style: "background:var(" + o.cssVar + ")"}), o.name, split(o) ? h("span", {class: "sub", text: split(o)}) : null,
        h("div", {class: "fd-bar"}, m[o.k] ? h("i", {style: "width:" + Math.min(100, m[o.k]).toFixed(1) + "%;background:var(" + o.cssVar + ")"}) : null)),
      h("td", {class: "r"}, h("b", {text: pc1(m[o.k])})), m.p1 ? h("td", {class: "r", text: pc1(m.p1[i])}) : null, wk ? h("td", {class: "r", text: pc1(wk[i])}) : null)));
  }
  const link = (text, href) => href ? h("a", {href, target: "_blank", rel: "noopener", text}) : text;
  $("fdNote").replaceChildren(...(fresh ? ["Вероятности: цены контрактов на бирже прогнозов ", link("Kalshi", FED.url), ", где торгуют исходом каждого заседания. Обновляются раз в час сами. По дальним заседаниям торгов мало, там оценки грубее."]
    : ["Вероятности не обновлялись больше четырёх дней, поэтому скрыты. Календарь и обратный отсчёт продолжают работать."]));

  $("fdLegend").replaceChildren(...OUTS.map((o) => h("span", null, h("i", {class: "fo-dot", style: "background:var(" + o.cssVar + ")"}), o.name.toLowerCase())));
  $("fdSched").tBodies[0].replaceChildren(...up.map((sc) => {
    const mm = dataOf(sc), pick = !!mm || sc === up[0], t2 = mm ? OUTS.reduce((a, b) => mm[b.k] > mm[a.k] ? b : a) : null;
    const when = new Date(sc.at).toLocaleString("ru-RU", {weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"});
    const tr = h("tr", {class: (pick ? "pick" : "") + (sc.end === fedSel ? " on" : ""), tabindex: pick ? 0 : null, "aria-selected": pick ? String(sc.end === fedSel) : null},
      h("td", null, meetLabel(sc), sc.sep ? h("span", {class: "pill", title: "К этому заседанию ФРС публикует новые прогнозы по ставке, инфляции и экономике", text: "прогнозы"}) : null,
        h("span", {class: "sub", text: sc.noDecision ? "стратегическое заседание, через " + leftTxt(sc.at - now) : when + " · через " + leftTxt(sc.at - now)})),
      h("td", null, ...(sc.noDecision ? ["Решения по ставке не будет"] : !mm ? [fresh ? "ставок пока нет" : "—"] : [
        t2.name + " · " + pc1(mm[t2.k]),
        h("div", {class: "fd-seg", role: "img", "aria-label": OUTS.map((o) => o.name.toLowerCase() + " " + pc1(mm[o.k])).join(", ")}, ...OUTS.map((o) => mm[o.k] >= 0.5 ? h("i", {style: "flex-grow:" + mm[o.k].toFixed(1) + ";background:var(" + o.cssVar + ")"}) : null)),
        h("span", {class: "sub", text: OUTS.filter((o) => o !== t2).map((o) => o.name.toLowerCase() + " " + pc1(mm[o.k])).join(" · ")})])));
    if (pick){
      const go = () => { fedSel = sc.end; renderFed(); };
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); go(); } });
    }
    return tr;
  }));
  $("fdSchedNote").replaceChildren("Даты: ", link("календарь ФРС", CAL ? CAL.calUrl : ""), ". Решение объявляют во второй день в 14:00 по Нью-Йорку, время в таблице местное, даты 2027 года предварительные.");
}

/* ---------- market levels. Two are computed here from Hyperliquid's own candles (the 200-week average and the
   yearly low); the realized price comes from levels.json, refreshed by the GitHub job. Nothing comes from the morning report. ---------- */
const LV_NAMES = {realized: "Реализованная цена"};
let lvFeed = null, lvLow = null, lvWma = null;
function realizedPick(){   // the job's value lags about a week; the history file may hold a fresher one for a while
  const old = isoOf(Date.now() - 14 * 864e5);
  const a = lvFeed ? lvFeed.levels.find((l) => l.key === "realized") : null, b = S.seedRealized || null;
  return [a, b].filter((x) => x && x.asOf >= old).sort((x, y) => x.asOf < y.asOf ? 1 : -1)[0] || null;
}
function applyLevels(){
  const out = [], old = isoOf(Date.now() - 14 * 864e5);
  if (lvWma) out.push({key: "wma200", name: "200-недельная средняя", value: lvWma, note: "по свечам Hyperliquid", stale: false});
  if (lvLow) out.push({key: "low52w", name: "Минимум за год", value: lvLow, note: "по свечам Hyperliquid", stale: false});
  const feed = lvFeed ? lvFeed.levels.filter((l) => l.asOf >= old && l.key !== "realized") : [];   // a value that stopped updating hides itself
  const rp = realizedPick(); if (rp) feed.push({key: "realized", value: rp.value, asOf: rp.asOf, src: rp.src});
  for (const l of feed) out.push({key: l.key, name: LV_NAMES[l.key], value: l.value, note: "на " + isoDay(l.asOf) + (l.src ? ", " + l.src : ""), stale: false});
  out.sort((a, b) => b.value - a.value);
  S.lv = {date: null, levels: out, note: [lvWma || lvLow ? "средняя и минимум считаются по свечам Hyperliquid" : "", ...feed.map((l) => LV_NAMES[l.key].toLowerCase() + ": " + (l.src || "") + ", на " + isoDay(l.asOf))].filter(Boolean).join("; ")};
  D.recalc(); drawLines();
  if (S.onLevels) S.onLevels();
}
async function loadLevels(){
  let got = null;
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname), repo = location.pathname.split("/")[1];
  for (const u of [m && repo ? "https://raw.githubusercontent.com/" + m[1] + "/" + repo + "/data/levels.json" : "", "levels.json"]){
    if (!u) continue;
    try {
      const d = await getJson(u, 6000);
      const f = {updated: Date.parse(d.updated) || 0, levels: (Array.isArray(d.levels) ? d.levels : []).filter((l) => l && LV_NAMES[l.key] && numOk(l.value) > 1000 && isD(l.asOf))
        .map((l) => ({key: l.key, value: l.value, asOf: l.asOf, src: typeof l.src === "string" ? l.src.slice(0, 20) : ""})),
        hist: (Array.isArray(d.hist) ? d.hist : []).filter((x) => Array.isArray(x) && isD(x[0]) && numOk(x[1]) > 1000).slice(-4000).map((x) => [x[0], x[1]]).sort((a, b) => a[0] < b[0] ? -1 : 1)};
      if (f.levels.length && (!got || f.updated > got.updated)) got = f;
      if (got && Date.now() - got.updated < 12 * 3600e3) break;
    } catch (e){}
  }
  if (got){ lvFeed = got; S.lvHist = got.hist; }
  applyLevels();
}
async function loadCandleLevels(){
  const now = Date.now();
  try {
    const rows = await hl({type: "candleSnapshot", req: {coin: "BTC", interval: "1d", startTime: now - 365 * 864e5, endTime: now}});
    const ok = rows.filter(sane).sort((a, b) => a.t - b.t);
    const lows = ok.map((r) => +r.l).filter((v) => v > 0);
    if (lows.length > 300) lvLow = Math.min(...lows);
    S.dayCandles = ok.map((r) => ({t: +r.t, c: +r.c, l: +r.l})).filter((r) => r.c > 0);
  } catch (e){}
  try {
    const rows = await hl({type: "candleSnapshot", req: {coin: "BTC", interval: "1w", startTime: now - 520 * 7 * 864e5, endTime: now}});
    const okw = rows.filter(sane).sort((a, b) => a.t - b.t);
    S.wkCandles = okw.map((r) => ({t: +r.t, c: +r.c})).filter((r) => r.c > 0);
    const closes = okw.map((r) => +r.c).filter((v) => v > 0).slice(-200);
    if (closes.length === 200) lvWma = closes.reduce((a, b) => a + b, 0) / 200;   // the current week counts with its latest price
  } catch (e){}
  applyLevels();
  if (S.onCandles) S.onCandles();
}

/* ---------- Fed decision odds: Hyperliquid outcome markets, where the "Yes" price of an outcome is its probability ---------- */
const LEGS = [
  {k: "up", re: /policyRateIncrease$/, name: "Повышение", cssVar: "--s1"},
  {k: "hold", re: /policyRateNoChange$/, name: "Без изменений", cssVar: "--s2"},
  {k: "down", re: /policyRateDecrease$/, name: "Снижение", cssVar: "--s3"},
];
const FO_RANGES = {all: {interval: "4h", step: 14400, ms: 1000 * 14400e3}, "7d": {interval: "1h", step: 3600, ms: 7 * 864e5}};
let FO = null, foMids = null, foMidsAt = 0, foDayAgo = {}, foRange = "all", foChart = null, foSeries = {}, foHist = {}, foGen = 0;
try { if (localStorage.getItem("desk.fo") === "7d") foRange = "7d"; } catch (e){}
const tzOff = () => -new Date().getTimezoneOffset() * 60;
async function loadOutcomes(){
  try {
    const m = await hl({type: "outcomeMeta"}), now = Date.now();
    const outs = new Map((Array.isArray(m.outcomes) ? m.outcomes : []).map((o) => [o.outcome, o]));
    const cand = (Array.isArray(m.questions) ? m.questions : [])
      .filter((q) => q && q.name === "template:policyRateDecision" && /(^|\|)institution:Federal Open Market Committee(\||$)/.test(String(q.description))
        && Array.isArray(q.namedOutcomes) && !(q.settledNamedOutcomes || []).length)
      .map((q) => { const t = /(?:^|\|)scheduledDecision:(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)/.exec(String(q.description)); return {q, at: t ? Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5]) : 0}; })
      .filter((x) => x.at > now - 2 * 864e5).sort((a, b) => a.at - b.at)[0];
    const legs = cand ? LEGS.map((L) => { const id = cand.q.namedOutcomes.find((n) => outs.has(n) && L.re.test(String(outs.get(n).name))); return id == null ? null : Object.assign({coin: "#" + id + "0"}, L); }).filter(Boolean) : [];
    const key = legs.map((l) => l.coin).join();
    if (legs.length < 2) FO = null;
    else if (!FO || FO.key !== key){
      if (foChart) for (const k of Object.keys(foSeries)) foChart.removeSeries(foSeries[k]);
      foSeries = {}; foHist = {}; foDayAgo = {}; foMids = null;
      FO = {key, at: cand.at, legs};
    }
  } catch (e){ /* keep the market we already have */ }
  renderOdds();
  if (FO){ pollOdds(); loadOddsHistory(); }
}
async function pollOdds(){
  if (!FO || document.hidden) return;
  try {
    const all = await hl({type: "allMids"}), mids = {};
    for (const l of FO.legs){ const v = all ? +all[l.coin] : NaN; if (v >= 0 && v <= 1) mids[l.k] = v * 100; }
    if (Object.keys(mids).length){ foMids = mids; foMidsAt = Date.now(); }
  } catch (e){}
  renderOdds(); pushOddsTail();
}
async function loadOddsHistory(){
  if (!FO || document.hidden) return;
  const g = ++foGen, R = FO_RANGES[foRange], now = Date.now(), key = FO.key;
  try {
    const got = await Promise.all(FO.legs.map((l) => hl({type: "candleSnapshot", req: {coin: l.coin, interval: R.interval, startTime: now - R.ms, endTime: now}})));
    if (g !== foGen || !FO || FO.key !== key) return;
    const off = tzOff(), cut = now / 1000 + off - 86400;
    FO.legs.forEach((l, i) => {
      const pts = (Array.isArray(got[i]) ? got[i] : []).filter((r) => +r.c >= 0 && +r.c <= 1).sort((a, b) => a.t - b.t).map((r) => ({time: Math.floor(r.t / 1000) + off, value: +r.c * 100}));
      foHist[l.k] = pts.filter((p, j) => !j || p.time > pts[j - 1].time);
      let v = null; for (const p of foHist[l.k]){ if (p.time <= cut) v = p.value; else break; }
      foDayAgo[l.k] = v;
    });
    drawOdds(); renderOdds();
  } catch (e){ if (g === foGen) $("foRead").textContent = "История ставок сейчас не загрузилась"; }
}
function drawOdds(){
  if (!LW || !FO) return;
  if (!foChart){
    foChart = LW.createChart($("foChart"), Object.assign(chartOpts(), {handleScale: {mouseWheel: false, pinch: true, axisPressedMouseMove: true},
      localization: {locale: "ru-RU", priceFormatter: (v) => nf0.format(v) + "%"}}));
    foChart.priceScale("right").applyOptions({scaleMargins: {top: 0.07, bottom: 0.06}});
    foChart.subscribeCrosshairMove((p) => {
      if (!FO || !p || p.time == null || !p.seriesData){ $("foRead").textContent = ""; return; }
      const parts = FO.legs.map((l) => { const d = foSeries[l.k] && p.seriesData.get(foSeries[l.k]); return d ? l.name.toLowerCase() + " " + pc1(d.value) : null; }).filter(Boolean);
      $("foRead").textContent = parts.length ? new Date(p.time * 1000).toLocaleString("ru-RU", {timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}) + ": " + parts.join(", ") : "";
    });
  }
  for (const l of FO.legs){
    if (!foSeries[l.k]) foSeries[l.k] = foChart.addLineSeries({color: css(l.cssVar), lineWidth: 2, title: l.name, priceLineVisible: false, lastValueVisible: true,
      autoscaleInfoProvider: () => ({priceRange: {minValue: 0, maxValue: 100}})});
    foSeries[l.k].setData(foHist[l.k] || []);
  }
  pushOddsTail();
  foChart.timeScale().fitContent();
}
function pushOddsTail(){   // the line ends at the current mid price
  if (!foChart || !foMids || !FO) return;
  const step = FO_RANGES[foRange].step, t = Math.floor(Date.now() / 1000 / step) * step + tzOff();
  for (const l of FO.legs){
    const sr = foSeries[l.k], v = foMids[l.k], hist = foHist[l.k] || [], last = hist[hist.length - 1];
    if (!sr || v == null || (last && last.time > t)) continue;
    sr.update({time: t, value: v});
  }
}
function futOdds(at){   // the same three outcomes on Kalshi, for comparison
  if (!FED || Date.now() - FED.oddsAt > FED_DEAD) return null;
  const sc = fedSchedule().find((x) => !x.noDecision && Math.abs(x.at - at) < 12 * 3600e3), m = sc ? FED.meetings.find((x) => x.date === sc.end) : null;
  return m ? {up: m.up, hold: m.hold, down: m.down} : null;
}
function renderOdds(){
  $("fedOdds").hidden = !FO; $("fedGrid").classList.toggle("has-odds", !!FO);
  if (!FO) return;
  const when = dayMonth(FO.at), fut = futOdds(FO.at);
  $("foT").textContent = "Ставки на решение " + when;
  $("foS").textContent = "рынок исходов Hyperliquid" + (foMidsAt ? ", обновлено в " + clock(foMidsAt) : "");
  $("foTiles").replaceChildren(...FO.legs.map((l) => h("div", {class: "tile"},
    h("div", {class: "lab"}, h("i", {class: "fo-dot", style: "background:var(" + l.cssVar + ")"}), l.name),
    h("div", {class: "tile-v", text: pc1(foMids ? foMids[l.k] : null)}),
    h("div", {class: "tile-s", text: [foDayAgo[l.k] != null ? "сутки назад " + pc1(foDayAgo[l.k]) : null, fut ? "на Kalshi " + pc1(fut[l.k]) : null].filter(Boolean).join(" · ")}))));
  for (const b of document.querySelectorAll("#foRange button")) b.setAttribute("aria-pressed", String(b.dataset.r === foRange));
  $("foNote").textContent = "Участники рынка исходов на Hyperliquid ставят деньги на то, что ФРС сделает со ставкой " + when + ". Цена контракта «да» по исходу и есть его вероятность, график показывает, как она менялась. Три исхода торгуются отдельно, поэтому в сумме бывает не ровно 100%.";
}

/* ---------- wiring ---------- */
for (const b of document.querySelectorAll("#tf button")){
  b.addEventListener("click", () => { tf = b.dataset.tf; try { localStorage.setItem("desk.tf", tf); } catch (e){} loadCandles(); });
}
let tvBtcDone = false;
function setView(v){
  const isTv = v === "tv";
  try { localStorage.setItem("desk.view", v); } catch (e){}
  $("lwWrap").hidden = isTv; $("tf").hidden = isTv; $("tvBtc").hidden = !isTv;
  if (!isTv){ mkt = v; try { localStorage.setItem("desk.mkt", mkt); } catch (e){} loadCandles(); return; }
  for (const b of document.querySelectorAll("#mk button")) b.setAttribute("aria-pressed", String(b.dataset.mk === "tv"));
  $("mkNote").textContent = "TradingView, спот Hyperliquid BTC/USDC";
  $("lwNote").textContent = "Виджет TradingView: индикаторы сверху, инструменты рисования слева, инструмент меняется в поиске. Рыночные уровни на нём не рисуются, они есть на графике Hyperliquid (кнопки «Спот» и «Перп»).";
  if (!tvBtcDone){
    tvBtcDone = true;
    tv("tvBtc", "embed-widget-advanced-chart.js", {autosize: true, symbol: "HYPERLIQUID:BTCUSDC", interval: "D", timezone: "Europe/Warsaw", theme: dark() ? "dark" : "light", style: "1", locale: "ru",
      backgroundColor: css("--surface"), gridColor: css("--rule"), allow_symbol_change: true, hide_side_toolbar: false, withdateranges: true, calendar: false, support_host: "https://www.tradingview.com"});
  }
}
for (const b of document.querySelectorAll("#mk button")) b.addEventListener("click", () => setView(b.dataset.mk));
$("expand").addEventListener("click", () => setExpanded(!expanded));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && expanded) setExpanded(false); });
S.onData = () => { drawLines(); renderEtfDays(); };
if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (chart){ chart.applyOptions(chartOpts()); series.applyOptions(candleOpts()); drawLines(); }
  if (pnlChart) pnlChart.applyOptions(chartOpts());
  tvDone = false; initTv();
  if (etfDone) showEtf();
  if (foChart){ foChart.applyOptions(chartOpts()); if (FO) for (const l of FO.legs) if (foSeries[l.k]) foSeries[l.k].applyOptions({color: css(l.cssVar)}); }
  if (tvBtcDone){ tvBtcDone = false; if (!$("tvBtc").hidden) setView("tv"); }
});
const watchReady = loadWatch();   // widgets wait for the watchlist, or they would open with a fallback symbol
if ("IntersectionObserver" in window){
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)){ io.disconnect(); watchReady.then(initTv); } }, {rootMargin: "600px"});
  io.observe($("markets"));
} else watchReady.then(initTv);
renderEtf();
if ("IntersectionObserver" in window){
  const io2 = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)){ io2.disconnect(); initEtf(); } }, {rootMargin: "600px"});
  io2.observe($("etf"));
} else initEtf();

D.chartState = () => ({tf, mkt, bars: data.length, wsOpen, noMore, first: data[0] && data[0].time, last: data[data.length - 1], range: chart ? chart.timeScale().getVisibleLogicalRange() : null});
D.loadMore = loadMore;
D.opens = () => OPEN;
D.etf = () => { const k = ETF[eIdx].k, c = SO[k]; return {asset: k, etfDone, days: etfSeries(k).length, live: !!(c && c.rows), err: !!(c && c.err), liveLast: c && c.rows ? c.rows[c.rows.length - 1].date : null, frames: [...document.querySelectorAll("#etf iframe")].map((f) => f.src)}; };
D.etfReload = (k) => loadSoso(k || ETF[eIdx].k, true);
D.kit = {hl, getJson, css, chartOpts, clock, dark, LW, isoOf, isoDay, dayMonth, pc1, big, sane, quote: (k) => Q[k] || null, applyLevels,
  dataUrl: (name) => { const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname), repo = location.pathname.split("/")[1]; return m && repo ? "https://raw.githubusercontent.com/" + m[1] + "/" + repo + "/data/" + name : ""; }};
D.realized = realizedPick;
D.fed = () => ({sel: fedSel, cal: CAL ? CAL.schedule.length : null, fed: FED && {cur: FED.cur, bandAsOf: FED.bandAsOf, last: FED.last, meetings: FED.meetings.length, hist: FED.hist.length, updated: FED.updated, oddsAt: FED.oddsAt}, dataUrl: fedDataUrl()});
D.levels = () => ({feed: lvFeed, low: lvLow, wma: lvWma, set: S.lv});
D.odds = () => FO && {key: FO.key, at: FO.at, mids: foMids, dayAgo: foDayAgo, range: foRange, pts: Object.fromEntries(Object.entries(foHist).map(([k, v]) => [k, v.length])), series: Object.keys(foSeries).length};
D.watch = () => ({folders: WL.map((f) => f.name + ":" + f.items.length), fIdx, cur: WL.length ? curSym() : null, tvDone});
renderLive();
tick(); loadCandles(); loadVault(); wsConnect();
try { if (localStorage.getItem("desk.view") === "tv") setView("tv"); } catch (e){}
setInterval(tick, 15000);
setInterval(() => { if (!wsOpen) refreshTail(); }, 15000);
setInterval(loadVault, 60000);
watchReady.then(pollQuotes);
setInterval(pollQuotes, 8000);
setInterval(() => loadSoso(ETF[eIdx].k), 5 * 60e3);
loadFed();
setInterval(renderFed, 60e3);           // the countdown
setInterval(loadFed, 30 * 60e3);
loadLevels(); loadCandleLevels();
setInterval(loadLevels, 60 * 60e3);
setInterval(loadCandleLevels, 3600e3);
loadOutcomes();
setInterval(pollOdds, 30e3);
setInterval(loadOddsHistory, 10 * 60e3);
setInterval(loadOutcomes, 60 * 60e3);
for (const b of document.querySelectorAll("#foRange button")) b.addEventListener("click", () => {
  if (foRange === b.dataset.r) return;
  foRange = b.dataset.r; try { localStorage.setItem("desk.fo", foRange); } catch (e){}
  renderOdds(); loadOddsHistory();
});   // refetches only when the last try is older than 15 minutes
document.addEventListener("visibilitychange", () => { if (!document.hidden){ tick(); refreshTail(); loadVault(); pollQuotes(); loadSoso(ETF[eIdx].k); pollOdds(); if (FO && !Object.keys(foHist).length) loadOddsHistory(); } });
})();
