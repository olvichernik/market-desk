/* Insight layer: where the market stands in its cycle, the odds of reaching each level, mood and liquidity, tokens with revenue.
   Every block reads a public source by itself and hides when that source stops answering. */
(() => {
"use strict";
const D = window.DESK; if (!D || !D.kit) return;
const {S, $, h, usd, usdBig, pct, nf0, nf1, nf2, plural} = D;
const {hl, getJson, css, chartOpts, clock, LW, isoOf, isoDay, dataUrl, quote} = D.kit;
const DAY = 864e5;
const isD = (v) => typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v);
const num = (v) => typeof v === "number" && isFinite(v) ? v : null;
const utcMs = (iso) => Date.parse(iso + "T00:00:00Z");
const addDays = (iso, n) => isoOf(utcMs(iso) + n * DAY);
const fullDate = (iso) => new Date(utcMs(iso)).toLocaleDateString("ru-RU", {timeZone: "UTC", day: "numeric", month: "long", year: "numeric"}).replace(" г.", "");
const shortDay = (ms) => new Date(ms).toLocaleDateString("ru-RU", {timeZone: "UTC", day: "numeric", month: "short"});
const stamp = (ms) => new Date(ms).toLocaleDateString("ru-RU", {day: "numeric", month: "long"}) + " в " + new Date(ms).toLocaleTimeString("ru-RU", {hour: "2-digit", minute: "2-digit"});
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e){ return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e){} };
const sign = (el, n) => { el.classList.remove("up", "down"); if (n > 0) el.classList.add("up"); else if (n < 0) el.classList.add("down"); };
const set = (id, v) => { $(id).textContent = v; };
const price = () => S.live && S.live.price > 0 ? S.live.price : null;
const money = (v) => v == null ? "—" : v >= 1000 ? usd(v) : "$" + (v >= 10 ? nf1 : nf2).format(v);
const f2 = new Intl.NumberFormat("ru-RU", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const dmy = (iso) => iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4);
/* a sum of money in billions, millions or thousands, with one decimal while the number is short */
const cap = (n) => {
  if (n == null) return "—";
  const a = Math.abs(n), sg = n < 0 ? "−$" : "$";
  return a >= 1e9 ? sg + (a >= 1e11 ? nf0 : nf1).format(a / 1e9) + " млрд" : a >= 1e6 ? sg + (a >= 1e8 ? nf0 : nf1).format(a / 1e6) + " млн" : a >= 1e3 ? sg + nf0.format(a / 1e3) + " тыс." : sg + nf0.format(a);
};
const bn = cap;
const timeKey = (t) => typeof t === "string" ? t : t && typeof t === "object" ? t.year + "-" + String(t.month).padStart(2, "0") + "-" + String(t.day).padStart(2, "0") : isoOf(t * 1000);
/* share of the history that sat below a value, read off 101 stored quantiles */
function shareBelow(q, v){
  if (!Array.isArray(q) || q.length !== 101 || v == null) return null;
  let i = 0; while (i < 101 && q[i] < v) i++;
  return Math.min(100, i);
}
const sharp = (n) => n == null ? "" : n <= 0 ? "меньше 1%" : n >= 100 ? "больше 99%" : n + "%";
function mini(hostId, extra){
  const c = LW.createChart($(hostId), Object.assign(chartOpts(), {handleScroll: false, handleScale: false}, extra || {}));
  c.applyOptions({timeScale: {timeVisible: false, rightOffset: 1, borderColor: css("--rule-strong")}});
  return c;
}
const charts = [];   // [chart, recolour] pairs, for a theme switch

/* ================= the cycle: price against the realized price ================= */
let H = null, cyChart = null, cyPx = null, cyRp = null, cyBand = null, cyPts = [], cyDrawn = false;
let cyRange = ["all", "5y", "2y"].includes(lsGet("desk.cy")) ? lsGet("desk.cy") : "all";
const BAND = "rgba(208,59,59,.16)";
async function loadHistory(){
  try {
    const d = await getJson("history.json", 8000);
    const n = Array.isArray(d.price) ? d.price.length : 0;
    if (!isD(d.end) || n < 200 || !Array.isArray(d.realized) || d.realized.length !== n || !d.cur || !isD(d.cur.peak) || !(num(d.cur.peakPx) > 0)) throw new Error("shape");
    const q = (a) => Array.isArray(a) && a.length === 101 && a.every((x) => num(x) != null) ? a : null;
    H = {src: String(d.src || "").slice(0, 20), url: typeof d.srcUrl === "string" && /^https:\/\/[^\s"'<>]+$/.test(d.srcUrl) ? d.srcUrl : "", end: d.end, n,
      price: d.price.map(Number), realized: d.realized.map(Number),
      cycles: (Array.isArray(d.cycles) ? d.cycles : []).filter((c) => c && isD(c.peak) && isD(c.low) && num(c.days) > 0 && num(c.dd) != null && num(c.lowR) > 0).slice(0, 6),
      cur: {peak: d.cur.peak, peakPx: d.cur.peakPx, low: isD(d.cur.low) ? d.cur.low : d.cur.peak, lowPx: num(d.cur.lowPx) > 0 ? d.cur.lowPx : d.cur.peakPx, lowR: num(d.cur.lowR)},
      belowShare: num(d.belowShare), lastBelow: isD(d.lastBelow) ? d.lastBelow : "", qMvrv: q(d.qMvrv), qMayer: q(d.qMayer), q200w: q(d.q200w)};
    if (H.price.some((x) => !(x > 0)) || H.realized.some((x) => !(x > 0))) throw new Error("values");
    S.seedRealized = {key: "realized", value: H.realized[n - 1], asOf: H.end, src: H.src};
    D.kit.applyLevels();
  } catch (e){ H = null; }
  renderCycle(); drawCycle();
}
/* closes of Hyperliquid candles as points in time; a price for any moment is the nearest one */
function knots(){
  const k = [];
  for (const c of S.wkCandles || []) k.push([c.t + 7 * DAY, c.c]);
  for (const c of S.dayCandles || []) k.push([c.t + DAY, c.c]);
  return k;
}
function priceAt(k, ms){
  let best = null, gap = 4 * DAY;
  for (const x of k){ const g = Math.abs(x[0] - ms); if (g < gap){ gap = g; best = x[1]; } }
  return best;
}
function realizedAt(iso){   // the job's daily values that are newer than the history file
  let v = null;
  for (const x of S.lvHist || []){ if (x[0] > iso) break; if (x[0] > H.end) v = x[1]; }
  return v;
}
function buildCycle(){
  if (!H) return [];
  const pts = [], t0 = utcMs(H.end) - (H.n - 1) * 7 * DAY;
  for (let i = 0; i < H.n; i++) pts.push({time: isoOf(t0 + i * 7 * DAY), p: H.price[i], r: H.realized[i]});
  const today = isoOf(Date.now()), k = knots();
  let lastR = H.realized[H.n - 1];
  for (let d = addDays(H.end, 7); d < today; d = addDays(d, 7)){   // one point a week after the file ends
    const p = priceAt(k, utcMs(d)); if (p == null) continue;
    const r = realizedAt(d); if (r != null) lastR = r;
    pts.push({time: d, p, r: lastR});
  }
  const P = price(), rn = D.realized(), last = pts[pts.length - 1];
  if (P && today > last.time) pts.push({time: today, p: P, r: rn ? rn.value : lastR});
  else if (P && today === last.time){ last.p = P; if (rn) last.r = rn.value; }
  return pts;
}
function cycleRead(pt){
  const x = pt || cyPts[cyPts.length - 1];
  set("cyRead", x ? (pt ? fullDate(x.time) : "сейчас") + ": цена " + money(x.p) + ", реализованная " + money(x.r) + ", отношение " + f2.format(x.p / x.r) : "");
}
function setCyRange(){
  for (const b of document.querySelectorAll("#cyRange button")) b.setAttribute("aria-pressed", String(b.dataset.r === cyRange));
  if (!cyChart || !cyPts.length) return;
  const last = cyPts[cyPts.length - 1].time;
  if (cyRange === "all") cyChart.timeScale().fitContent();
  else cyChart.timeScale().setVisibleRange({from: addDays(last, -(cyRange === "5y" ? 5 : 2) * 365), to: last});
}
function drawCycle(){
  if (!LW || !H) return;
  cyPts = buildCycle();
  if (!cyChart){
    cyChart = LW.createChart($("cyChart"), Object.assign(chartOpts(), {handleScale: {mouseWheel: false, pinch: true, axisPressedMouseMove: true},
      localization: {locale: "ru-RU", priceFormatter: (v) => v >= 1000 ? nf0.format(v) : v >= 10 ? nf1.format(v) : nf2.format(v)}}));
    cyChart.applyOptions({timeScale: {timeVisible: false, rightOffset: 4, minBarSpacing: 0.05, borderColor: css("--rule-strong")}});   // all 830 weeks fit even a phone
    cyChart.priceScale("right").applyOptions({mode: 1, scaleMargins: {top: 0.06, bottom: 0.06}});   // logarithmic: fifteen years fit on one scale
    cyBand = cyChart.addAreaSeries({priceScaleId: "", lineType: 1, lineColor: "rgba(0,0,0,0)", lineWidth: 1, topColor: BAND, bottomColor: BAND, lastValueVisible: false, priceLineVisible: false,
      crosshairMarkerVisible: false, autoscaleInfoProvider: () => ({priceRange: {minValue: 0, maxValue: 1}})});
    cyBand.priceScale().applyOptions({scaleMargins: {top: 0, bottom: 0}});
    cyRp = cyChart.addLineSeries({color: css("--s2"), lineWidth: 2, title: "Реализованная", priceLineVisible: false, lastValueVisible: true});
    cyPx = cyChart.addLineSeries({color: css("--s1"), lineWidth: 2, title: "Цена", priceLineVisible: false, lastValueVisible: true});
    cyChart.subscribeCrosshairMove((p) => { const k = p && p.time != null ? timeKey(p.time) : null; cycleRead(k ? cyPts.find((x) => x.time === k) : null); });
    charts.push([cyChart, () => { cyRp.applyOptions({color: css("--s2")}); cyPx.applyOptions({color: css("--s1")}); }]);
  }
  cyPx.setData(cyPts.map((x) => ({time: x.time, value: x.p})));
  cyRp.setData(cyPts.map((x) => ({time: x.time, value: x.r})));
  cyBand.setData(cyPts.map((x) => ({time: x.time, value: x.p < x.r ? 1 : 0})));   // a band wherever the price is under the realized price
  if (!cyDrawn){ cyDrawn = true; setCyRange(); }
  cycleRead(null);
}
function tailCycle(){   // the last point follows the live price
  if (!cyChart || !cyPts.length) return;
  const P = price(); if (!P) return;
  const today = isoOf(Date.now()), last = cyPts[cyPts.length - 1];
  if (today < last.time) return;
  const rn = D.realized(), r = rn ? rn.value : last.r;
  if (today > last.time) cyPts.push({time: today, p: P, r}); else { last.p = P; last.r = r; }
  const x = cyPts[cyPts.length - 1];
  cyPx.update({time: x.time, value: x.p}); cyRp.update({time: x.time, value: x.r});
  cyBand.update({time: x.time, value: x.p < x.r ? 1 : 0});
  if ($("cyRead").textContent.startsWith("сейчас")) cycleRead(null);
}
function renderCycle(){
  const sec = $("cycle");
  if (!H){ sec.hidden = true; return; }
  sec.hidden = false;
  const P = price(), today = isoOf(Date.now()), rn = D.realized();
  // the cycle's peak and its low so far: the history file, then daily closes after it, then the live price
  let peak = {d: H.cur.peak, px: H.cur.peakPx}, low = {d: H.cur.low, px: H.cur.lowPx, r: H.cur.lowR};
  const step = (d, px) => { if (px > peak.px){ peak = {d, px}; low = {d, px, r: null}; } else if (px < low.px) low = {d, px, r: null}; };
  for (const c of S.dayCandles || []){ const d = isoOf(c.t); if (d > H.end && d < today) step(d, c.c); }
  if (P) step(today, P);
  const dayNo = (d) => Math.round((utcMs(d) - utcMs(peak.d)) / DAY);
  const days = dayNo(today), dd = P ? (P / peak.px - 1) * 100 : null, lowDd = (low.px / peak.px - 1) * 100;
  if (low.r == null){ const r = realizedAt(low.d) || (rn ? rn.value : null); low.r = r ? low.px / r : null; }

  const mv = P && rn ? P / rn.value : null, pm = shareBelow(H.qMvrv, mv);
  set("cyMvrv", mv == null ? "—" : f2.format(mv));
  set("cyMvrvS", rn ? "реализованная " + usd(rn.value) + " на " + isoDay(rn.asOf) + (pm != null ? "; ниже было " + sharp(pm) + " дней" : "") : "реализованная цена давно не обновлялась");

  const dc = (S.dayCandles || []).slice(-200), sma = dc.length === 200 ? dc.reduce((a, c) => a + c.c, 0) / 200 : null;
  const my = P && sma ? P / sma : null, py = shareBelow(H.qMayer, my);
  set("cyMayer", my == null ? "—" : f2.format(my));
  set("cyMayerS", sma ? "цена к средней за 200 дней, " + usd(sma) + (py != null ? "; ниже было " + sharp(py) + " дней" : "") : "средняя за 200 дней не загрузилась");

  const wl = D.levelSet().levels.find((l) => l.key === "wma200"), w = P && wl ? P / wl.value : null, pw = shareBelow(H.q200w, w);
  const elW = $("cy200w"); elW.textContent = w == null ? "—" : pct((w - 1) * 100); sign(elW, w == null ? 0 : w - 1);
  set("cy200wS", wl ? "средняя за 200 недель " + usd(wl.value) + (pw != null ? "; ниже было " + sharp(pw) + " недель" : "") : "средняя за 200 недель не загрузилась");

  const elD = $("cyDd"); elD.textContent = dd == null ? "—" : pct(dd); sign(elD, dd || 0);
  set("cyDdS", "пик " + usd(peak.px) + ", " + fullDate(peak.d));
  const hero = $("hCy"); hero.textContent = dd == null ? "—" : pct(dd); sign(hero, dd || 0);
  set("hCyS", "пик " + usd(peak.px) + " был " + days + " " + plural(days, "день", "дня", "дней") + " назад");
  const ds = H.cycles.map((c) => c.days), dMin = Math.min(...ds), dMax = Math.max(...ds);
  set("cyDays", nf0.format(days));
  set("cyDaysS", H.cycles.length ? "прошлые циклы: дно на " + dMin + "–" + dMax + "-й день" : "");
  set("cyLow", usd(low.px));
  set("cyLowS", fullDate(low.d) + ", " + dayNo(low.d) + "-й день, " + pct(lowDd) + " от пика");

  const sub = (t) => h("span", {class: "sub", text: t});
  const tb = $("cyTable").tBodies[0]; tb.replaceChildren();
  for (const c of H.cycles) tb.append(h("tr", null,
    h("td", null, c.peak.slice(0, 4) + "–" + c.low.slice(0, 4), sub("пик " + dmy(c.peak) + ", дно " + dmy(c.low))),
    h("td", {class: "r", text: String(c.days)}),
    h("td", {class: "r", text: pct(c.dd)}),
    h("td", {class: "r", text: f2.format(c.lowR)})));
  tb.append(h("tr", null,
    h("td", null, "Минимум этого цикла", sub("пик " + dmy(peak.d) + ", минимум " + dmy(low.d))),
    h("td", {class: "r", text: String(dayNo(low.d))}),
    h("td", {class: "r", text: pct(lowDd)}),
    h("td", {class: "r", text: low.r ? f2.format(low.r) : "—"})));
  tb.append(h("tr", {class: "cy-now"},
    h("td", null, "Сейчас"),
    h("td", {class: "r", text: String(days)}),
    h("td", {class: "r", text: dd == null ? "—" : pct(dd)}),
    h("td", {class: "r", text: mv == null ? "—" : f2.format(mv)})));

  set("cyStamp", "цена в реальном времени" + (rn ? ", реализованная цена на " + isoDay(rn.asOf) : ""));
  const src = H.url ? h("a", {href: H.url, target: "_blank", rel: "noopener noreferrer", text: H.src}) : H.src;
  $("cyNote").replaceChildren("Реализованная цена: средняя цена, по которой все биткойны последний раз двигались в блокчейне, то есть средняя цена покупки всего рынка."
    + (H.belowShare != null ? " Ниже неё цена была " + nf1.format(H.belowShare) + "% всех дней с 2011 года" + (H.lastBelow ? ", последний раз " + fullDate(H.lastBelow) : "") + "." : "")
    + " В таблице для прошлых циклов стоит день дна, для этого: минимум на сегодня и текущий момент. История по " + fullDate(H.end) + ": ", src,
    ", по дневным значениям; дальше реализованная цена приходит от BGeometrics с задержкой около недели, цена с Hyperliquid.");
  set("cyChartNote", "Шкала логарифмическая: равное расстояние означает равное изменение в процентах. Красные полосы: недели, когда цена была ниже реализованной. По точке на неделю, последняя точка следует за живой ценой.");
}
for (const b of document.querySelectorAll("#cyRange button")) b.addEventListener("click", () => { cyRange = b.dataset.r; lsSet("desk.cy", cyRange); setCyRange(); });

/* ================= odds of touching a level, from option prices ================= */
let dvol = null;
const Ncdf = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
};
/* chance that a price with volatility sig and no trend touches K within the given days */
function touch(S0, K, sig, days){
  if (!(S0 > 0) || !(K > 0) || !(sig > 0)) return null;
  if (Math.abs(K / S0 - 1) < 1e-6) return 1;
  const sT = sig * Math.sqrt(days / 365), d1 = (Math.log(S0 / K) + sT * sT / 2) / sT, d2 = d1 - sT;
  const p = K < S0 ? Ncdf(-d2) + (S0 / K) * Ncdf(-d1) : Ncdf(d2) + (S0 / K) * Ncdf(d1);
  return Math.max(0, Math.min(1, p));
}
function applyTouch(){
  const fresh = dvol && Date.now() - dvol.at < 3 * 3600e3;
  S.touch = fresh ? (K) => { const P = price(); if (!P) return null; const a = touch(P, K, dvol.v / 100, 30), b = touch(P, K, dvol.v / 100, 90); return a == null || b == null ? null : {d30: a * 100, d90: b * 100}; } : null;
  const note = $("lvOddsNote"); note.hidden = !fresh;
  if (fresh) note.textContent = "Шанс: вероятность, что цена коснётся уровня за этот срок. Посчитана по индексу ожидаемой волатильности опционов на Deribit (DVOL, сейчас " + nf1.format(dvol.v)
    + "%, обновлено в " + clock(dvol.at) + "): это размах цены, который закладывает рынок опционов, без поправки на тренд. Для 90 дней взята та же волатильность.";
  D.recalc();
}
async function loadDvol(){
  if (document.hidden) return;
  try {
    const now = Date.now();
    const j = await getJson("https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=" + (now - 6 * 3600e3) + "&end_timestamp=" + now + "&resolution=3600", 8000);
    const rows = j && j.result && Array.isArray(j.result.data) ? j.result.data : [], last = rows[rows.length - 1], v = last ? +last[4] : NaN;
    if (v > 5 && v < 400) dvol = {v, at: Date.now()};
  } catch (e){}
  applyTouch();
}

/* ================= mood and liquidity ================= */
const FG_RU = {"Extreme Fear": "крайний страх", "Fear": "страх", "Neutral": "нейтрально", "Greed": "жадность", "Extreme Greed": "крайняя жадность"};
const fgName = (x) => FG_RU[x.c] || (x.v <= 24 ? "крайний страх" : x.v <= 46 ? "страх" : x.v <= 54 ? "нейтрально" : x.v <= 75 ? "жадность" : "крайняя жадность");
let fg = null, fgChart = null, fgSeries = null;
async function loadFng(){
  try {
    const j = await getJson("https://api.alternative.me/fng/?limit=120", 8000);
    const rows = (Array.isArray(j.data) ? j.data : []).map((x) => ({t: +x.timestamp * 1000, v: +x.value, c: String(x.value_classification || "")}))
      .filter((x) => x.t > 0 && x.v >= 0 && x.v <= 100).sort((a, b) => a.t - b.t);
    if (rows.length > 10) fg = {rows, at: Date.now()};
  } catch (e){}
  renderFng();
}
function renderFng(){
  const ok = fg && Date.now() - fg.rows[fg.rows.length - 1].t < 4 * DAY;
  $("fgBox").hidden = !ok; moodShown();
  if (!ok) return;
  const r = fg.rows, last = r[r.length - 1], at = (n) => r[r.length - 1 - n] || null;
  let run = 0; for (let i = r.length - 1; i >= 0 && fgName(r[i]) === fgName(last); i--) run++;
  set("fgNow", String(last.v)); set("fgNowS", fgName(last) + (run > 1 ? ", " + run + "-й день подряд" : ""));
  for (const [id, n] of [["fgW", 7], ["fgM", 30]]){ const x = at(n); set(id, x ? String(x.v) : "—"); set(id + "S", x ? fgName(x) : ""); }
  set("fgS", "alternative.me, значение за " + shortDay(last.t));
  set("fgNote", "От 0 (крайний страх) до 100 (крайняя жадность). Считается раз в день по волатильности, объёмам торгов, соцсетям и доле биткойна на рынке. Пунктир: границы крайнего страха (25) и крайней жадности (75).");
  if (!LW) return;
  if (!fgChart){
    fgChart = mini("fgChart");
    fgSeries = fgChart.addLineSeries({color: css("--s1"), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: {type: "price", precision: 0, minMove: 1},
      autoscaleInfoProvider: () => ({priceRange: {minValue: 0, maxValue: 100}})});
    fgSeries.priceScale().applyOptions({scaleMargins: {top: 0.04, bottom: 0.04}});
    for (const v of [25, 75]) fgSeries.createPriceLine({price: v, color: css("--rule-strong"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false});
    fgChart.subscribeCrosshairMove((p) => { const d = p && p.time != null && p.seriesData ? p.seriesData.get(fgSeries) : null; const x = d ? fg.rows.find((y) => isoOf(y.t) === timeKey(p.time)) : null; set("fgRead", x ? shortDay(x.t) + ": " + x.v + ", " + fgName(x) : ""); });
    charts.push([fgChart, () => fgSeries.applyOptions({color: css("--s1")})]);
  }
  fgSeries.setData(r.map((x) => ({time: isoOf(x.t), value: x.v})).filter((x, i, a) => !i || x.time > a[i - 1].time));
  fgChart.timeScale().fitContent();
}

let fu = null, fuChart = null, fuSeries = null, fuDays = [];
const yearly = (f) => f * 24 * 365 * 100;   // hourly funding as a yearly percentage
async function loadFunding(){
  if (document.hidden) return;
  try {
    const now = Date.now(); let rows = [], from = now - 31 * DAY;
    for (let i = 0; i < 4; i++){   // the API answers with at most 500 hourly records
      const part = await hl({type: "fundingHistory", coin: "BTC", startTime: from});
      if (!Array.isArray(part) || !part.length) break;
      rows = rows.concat(part);
      if (part.length < 500) break;
      from = +part[part.length - 1].time + 1;
    }
    const pts = rows.map((x) => ({t: +x.time, f: +x.fundingRate})).filter((x) => x.t > 0 && isFinite(x.f)).sort((a, b) => a.t - b.t);
    if (pts.length > 100) fu = {pts, at: now};
  } catch (e){}
  renderFunding();
}
function renderFunding(){
  const ok = fu && Date.now() - fu.pts[fu.pts.length - 1].t < 6 * 3600e3;
  $("fuBox").hidden = !ok; moodShown();
  if (!ok) return;
  const p = fu.pts, last = p[p.length - 1], avg = (ms) => { const a = p.filter((x) => x.t > last.t - ms); return a.length ? a.reduce((s, x) => s + x.f, 0) / a.length : null; };
  const tile = (id, f) => { const el = $(id); el.textContent = f == null ? "—" : pct(yearly(f)); sign(el, f || 0); };
  tile("fuNow", last.f); tile("fuW", avg(7 * DAY)); tile("fuM", avg(30 * DAY));
  const byDay = new Map(); for (const x of p){ const d = isoOf(x.t); const a = byDay.get(d) || [0, 0]; a[0] += x.f; a[1]++; byDay.set(d, a); }
  fuDays = [...byDay].map(([d, a]) => ({d, v: yearly(a[0] / a[1])})).sort((a, b) => a.d < b.d ? -1 : 1).slice(-30);
  const neg = fuDays.filter((x) => x.v < 0).length;
  set("fuNowS", "в год, последний час"); set("fuWS", "в год"); set("fuMS", "в год; дней с минусом: " + neg + " из " + fuDays.length);
  set("fuS", "перп BTC на Hyperliquid, обновлено в " + clock(fu.at));
  set("fuNote", "Фандинг: плата между лонгами и шортами бессрочного контракта, раз в час. Плюс: перевес лонгов с плечом, они платят шортам; минус: перевес шортов. Столбцы: среднее за день в пересчёте на год.");
  if (!LW) return;
  if (!fuChart){
    fuChart = mini("fuChart", {localization: {locale: "ru-RU", priceFormatter: (v) => nf0.format(v) + "%"}});
    fuSeries = fuChart.addHistogramSeries({priceLineVisible: false, lastValueVisible: false, priceFormat: {type: "price", precision: 1, minMove: 0.1}});
    fuChart.subscribeCrosshairMove((q) => { const x = q && q.time != null ? fuDays.find((y) => y.d === timeKey(q.time)) : null; set("fuRead", x ? shortDay(utcMs(x.d)) + ": " + pct(x.v) + " в год" : ""); });
    charts.push([fuChart, () => fuSeries.setData(fuDays.map((x) => ({time: x.d, value: x.v, color: css(x.v >= 0 ? "--up" : "--down")})))]);
  }
  fuSeries.setData(fuDays.map((x) => ({time: x.d, value: x.v, color: css(x.v >= 0 ? "--up" : "--down")})));
  fuChart.timeScale().fitContent();
}

let st = null, stChart = null, stSeries = null;
async function loadLiq(){
  let got = null;
  for (const u of [dataUrl("liq.json"), "liq.json"]){
    if (!u) continue;
    try {
      const d = await getJson(u, 6000);
      const rows = (Array.isArray(d.stables) ? d.stables : []).filter((x) => Array.isArray(x) && isD(x[0]) && num(x[1]) > 1e9).map((x) => ({d: x[0], v: x[1]})).sort((a, b) => a.d < b.d ? -1 : 1);
      const f = {rows, updated: Date.parse(d.updated) || 0};
      if (rows.length > 40 && (!got || f.updated > got.updated)) got = f;
      if (got && Date.now() - got.updated < 12 * 3600e3) break;
    } catch (e){}
  }
  if (got) st = got;
  renderStables();
}
function renderStables(){
  const ok = st && Date.now() - utcMs(st.rows[st.rows.length - 1].d) < 5 * DAY;
  $("stBox").hidden = !ok; moodShown();
  if (!ok) return;
  const r = st.rows, last = r[r.length - 1], ago = (n) => { const d = addDays(last.d, -n); let x = null; for (const y of r){ if (y.d <= d) x = y; else break; } return x; };
  set("stNow", bn(last.v)); set("stNowS", "на " + shortDay(utcMs(last.d)));
  for (const [id, n] of [["stW", 7], ["stM", 30]]){
    const x = ago(n), el = $(id), ch = x ? (last.v / x.v - 1) * 100 : null;
    el.textContent = ch == null ? "—" : pct(ch); sign(el, ch || 0);
    set(id + "S", x ? (last.v - x.v > 0 ? "+" : "") + bn(last.v - x.v) : "");
  }
  set("stS", "DefiLlama, обновлено " + stamp(st.updated));
  set("stNote", "Сумма всех долларовых стейблкоинов в обращении. Растёт: в крипту заходят новые деньги; падает: деньги из неё выводят.");
  if (!LW) return;
  if (!stChart){
    stChart = mini("stChart", {localization: {locale: "ru-RU", priceFormatter: (v) => nf0.format(v / 1e9)}});
    stSeries = stChart.addAreaSeries({lineColor: css("--s1"), topColor: "rgba(57,135,229,.22)", bottomColor: "rgba(57,135,229,.02)", lineWidth: 2, priceLineVisible: false, lastValueVisible: true});
    stChart.subscribeCrosshairMove((q) => { const x = q && q.time != null ? st.rows.find((y) => y.d === timeKey(q.time)) : null; set("stRead", x ? fullDate(x.d) + ": " + bn(x.v) : ""); });
    charts.push([stChart, () => stSeries.applyOptions({lineColor: css("--s1")})]);
  }
  stSeries.setData(r.slice(-366).map((x) => ({time: x.d, value: x.v})));
  stChart.timeScale().fitContent();
}
function moodShown(){ $("mood").hidden = $("fgBox").hidden && $("fuBox").hidden && $("stBox").hidden; }

/* ================= tokens: revenue against market value ================= */
let tok = null;
async function loadTokens(){
  let got = null;
  for (const u of [dataUrl("tokens.json"), "tokens.json"]){
    if (!u) continue;
    try {
      const d = await getJson(u, 6000);
      const rows = (Array.isArray(d.tokens) ? d.tokens : []).filter((t) => t && typeof t.n === "string" && num(t.px) > 0 && (num(t.circ) > 0 || num(t.mc) > 0)).slice(0, 20).map((t) => ({
        n: t.n.slice(0, 30), sym: String(t.sym || "").slice(0, 10), h: typeof t.h === "string" && /^[A-Za-z0-9]{1,16}$/.test(t.h) ? t.h : "", px: t.px, circ: num(t.circ), mc: num(t.mc), fdv: num(t.fdv),
        ath: num(t.ath), athDate: isD(t.athDate) ? t.athDate : "", rev30: num(t.rev30), hold30: num(t.hold30), fees30: num(t.fees30), revPrev30: num(t.revPrev30), chain: t.chain === true}));
      const f = {tokens: rows, updated: Date.parse(d.updated) || 0, revAt: Date.parse(d.revAt) || 0};
      if (rows.length && (!got || f.updated > got.updated)) got = f;
      if (got && Date.now() - got.updated < 12 * 3600e3) break;
    } catch (e){}
  }
  if (got) tok = got;
  renderTokens();
}
function renderTokens(){
  const ok = tok && Date.now() - tok.updated < 7 * DAY;
  $("tokens").hidden = !ok;
  if (!ok) return;
  const sub = (t, cls) => h("span", {class: "sub" + (cls ? " " + cls : ""), text: t});
  const tb = $("tokTable").tBodies[0]; let livePx = 0; tb.replaceChildren();
  for (const t of tok.tokens){
    const q = t.h ? quote(t.h) : null, px = q && q.px > 0 ? q.px : t.px; if (q && q.px > 0) livePx++;
    const mc = t.circ ? t.circ * px : t.mc * px / t.px, fdv = t.fdv ? t.fdv * px / t.px : null;
    const fromAth = t.ath ? (px / t.ath - 1) * 100 : null;
    const yr = t.rev30 != null ? t.rev30 * 365 / 30 : null, ps = yr > 0 ? mc / yr : null, pe = t.hold30 > 0 ? mc / (t.hold30 * 365 / 30) : null;
    const trend = t.rev30 != null && t.revPrev30 > 0 ? (t.rev30 / t.revPrev30 - 1) * 100 : null;
    const ratio = (v) => v == null ? "—" : v >= 100 ? nf0.format(v) : nf1.format(v);
    tb.append(h("tr", null,
      h("td", null, t.n, sub(t.sym.toUpperCase() + (t.chain ? ", сеть" : ""))),
      h("td", {class: "r"}, money(px), fromAth == null ? null : sub(fromAth >= -0.5 ? "на пике" : pct(fromAth, 0) + " от пика")),
      h("td", {class: "r"}, cap(mc), fdv && fdv > mc * 1.05 ? sub("все токены: " + cap(fdv)) : null),
      h("td", {class: "r"}, t.rev30 == null ? "—" : cap(t.rev30), trend == null ? null : sub((trend > 0 ? "▲ " : trend < 0 ? "▼ " : "") + pct(trend, 0) + " к прошлым 30 дням", trend > 0 ? "up" : trend < 0 ? "down" : "")),
      h("td", {class: "r"}, t.hold30 == null ? "—" : cap(t.hold30), t.hold30 > 0 && t.rev30 > 0 ? sub(nf0.format(Math.min(100, t.hold30 / t.rev30 * 100)) + "% выручки") : null),
      h("td", {class: "r"}, ratio(ps), pe != null && (ps == null || Math.abs(pe / ps - 1) > 0.02) ? sub("к выплатам держателям: " + ratio(pe)) : null)));
  }
  set("tokStamp", "выручка: DefiLlama, обновлено " + stamp(tok.revAt || tok.updated) + (livePx ? "; цены в реальном времени с Hyperliquid" : ""));
  set("tokNote", "Выручка: часть комиссий, которая остаётся протоколу, а не уходит поставщикам ликвидности или валидаторам. Держателям: выкуп токена с рынка, сжигание или прямые выплаты. Для Ethereum и Solana выручка — сожжённые комиссии сети. Последний столбец: сколько годовых выручек стоит вся капитализация (30 дней в пересчёте на год); чем меньше число, тем дешевле токен относительно выручки.");
}

/* ================= wiring ================= */
S.onLevels = () => { renderCycle(); tailCycle(); };
S.onCandles = () => { drawCycle(); renderCycle(); };
if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { for (const [c, recolour] of charts){ c.applyOptions(chartOpts()); recolour(); } });
loadHistory(); loadDvol(); loadFng(); loadFunding(); loadLiq(); loadTokens();
setInterval(() => { if (document.hidden) return; renderCycle(); tailCycle(); renderTokens(); }, 15000);
setInterval(loadDvol, 10 * 60e3);
setInterval(loadFunding, 10 * 60e3);
setInterval(loadFng, 3600e3);
setInterval(() => { loadLiq(); loadTokens(); }, 30 * 60e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden){ loadDvol(); loadFunding(); } });
D.insight = () => ({hist: H ? {n: H.n, end: H.end, pts: cyPts.length, last: cyPts[cyPts.length - 1] || null, range: cyRange} : null, dvol, fg: fg ? fg.rows.length : 0, fu: fu ? fu.pts.length : 0, fuDays: fuDays.length,
  st: st ? st.rows.length : 0, tok: tok ? tok.tokens.length : 0, touch: typeof S.touch === "function"});
})();
