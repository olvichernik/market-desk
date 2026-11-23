/* Navigation layer: sticky bar with the current section, deep links, folding sections. */
(() => {
"use strict";
const D = window.DESK; if (!D) return;
const {S, $} = D;
const bar = $("bar"), scroller = $("barIn"), chip = $("barPx");
const links = [...document.querySelectorAll("#nav a[data-go]")];
const ids = links.map((a) => a.dataset.go);
const calm = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const barH = () => bar.offsetHeight || 48;
const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
let active = null, picked = null, raf = 0;

function syncBarVar(){ document.documentElement.style.setProperty("--bar-h", barH() + "px"); }
syncBarVar();
if ("ResizeObserver" in window) new ResizeObserver(syncBarVar).observe(bar);

/* ---------- which section is on screen ---------- */
function current(){
  const line = barH() + 28;
  let best = null, bestTop = -Infinity;
  for (const id of ids){
    const el = $(id); if (!el || el.hidden) continue;
    const t = el.getBoundingClientRect().top;
    if (t <= line && t > bestTop + 3){ best = id; bestTop = t; }   // side-by-side sections share a top: the first one wins
  }
  if (atBottom() && window.scrollY > 0){   // short sections at the very end never reach the line
    for (const id of ids){
      const el = $(id); if (!el || el.hidden) continue;
      const t = el.getBoundingClientRect().top;
      if (t > bestTop + 3 && t < window.innerHeight - 120){ best = id; bestTop = t; }
    }
  }
  if (picked && picked !== best){   // the reader asked for a neighbour that starts on the same line, or one that cannot reach the top
    const el = $(picked), t = el ? el.getBoundingClientRect().top : NaN;
    if (Math.abs(t - bestTop) <= 3 || (atBottom() && t > line && t < window.innerHeight - 120)) best = picked;
  }
  return best || ids[0];
}
function reveal(a){   // keep the active link visible in the scrolling row on a phone
  if (scroller.scrollWidth <= scroller.clientWidth + 1) return;
  const cover = bar.classList.contains("has-px") ? chip.offsetWidth + 28 : 0;
  const room = scroller.clientWidth - cover;
  const left = a.offsetLeft - Math.max(12, (room - a.offsetWidth) / 2);
  scroller.scrollTo({left: Math.max(0, left), behavior: calm() ? "auto" : "smooth"});
}
function spy(){
  raf = 0;
  bar.classList.toggle("stuck", window.scrollY > 4);
  for (const a of links){ const el = $(a.dataset.go); a.hidden = !el || el.hidden; }   // a block without data hides, and so does its link
  const id = current();
  if (id === active) return;
  active = id;
  for (const a of links){
    if (a.dataset.go === id){ a.setAttribute("aria-current", "true"); reveal(a); }
    else a.removeAttribute("aria-current");
  }
}
const queue = () => { if (!raf) raf = requestAnimationFrame(spy); };
window.addEventListener("scroll", queue, {passive: true});
window.addEventListener("resize", queue);
for (const ev of ["wheel", "touchmove", "keydown"]) window.addEventListener(ev, () => { picked = null; }, {passive: true});

if ("MutationObserver" in window){ const mo = new MutationObserver(queue); for (const id of ids){ const el = $(id); if (el) mo.observe(el, {attributes: true, attributeFilter: ["hidden"]}); } }

/* ---------- jumping ---------- */
const targetY = (el) => Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - barH() - 12));
function go(id, smooth, keepUrl){
  const el = $(id); if (!el) return;
  if (el.classList.contains("folded")) setFold(el, false);
  picked = id === "top" ? null : id;
  const y = id === "top" ? 0 : targetY(el);
  if (smooth && !calm()){
    const d = y - window.scrollY, far = window.innerHeight * 1.5;
    if (Math.abs(d) > far) window.scrollTo(0, y - Math.sign(d) * far * 0.6);   // a long trip starts close to the target instead of crawling through the whole page
    window.scrollTo({top: y, behavior: "smooth"});
  } else window.scrollTo(0, y);
  if (!keepUrl) try { history.replaceState(null, "", id === "top" ? location.pathname + location.search : "#" + id); } catch (e){}
  queue();
  // blocks above keep loading and change height: hold the section in place until the reader takes over
  if (id !== "top") for (const ms of [700, 1500, 2600, 4500]) setTimeout(() => {
    if (picked !== id) return;
    const y2 = Math.min(targetY(el), document.documentElement.scrollHeight - window.innerHeight);
    if (Math.abs(y2 - window.scrollY) > 6) window.scrollTo(0, y2);
  }, ms);
}
for (const a of document.querySelectorAll("#bar a[data-go]")) a.addEventListener("click", (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   // a new tab stays a new tab
  e.preventDefault(); go(a.dataset.go, true);
});
window.addEventListener("hashchange", () => { const id = location.hash.slice(1); if (ids.includes(id)) go(id, true, true); });

/* ---------- the price in the bar once the big one has scrolled away ---------- */
function mirror(){
  const L = S.live, t = $("hPrice").textContent, ok = /\d/.test(t);
  $("bPrice").textContent = t;
  const c = $("bChg");
  if (L && L.chg != null && isFinite(L.chg)){
    const arrow = L.chg > 0 ? "▲" : L.chg < 0 ? "▼" : "", bx = document.createElement("span");
    bx.className = "bx"; bx.textContent = (arrow ? " " : "") + D.pct(L.chg);
    c.replaceChildren(arrow, bx); c.className = "chg " + (L.chg > 0 ? "up" : L.chg < 0 ? "down" : "flat");
  } else { c.replaceChildren(); c.className = "chg"; }
  $("bDot").classList.toggle("off", !L);
  chip.title = (L ? "Живая цена биткойна, спот на Hyperliquid" : "Цена из утреннего отчёта") + ". Нажмите, чтобы вернуться наверх";
  bar.classList.toggle("no-px", !ok);
  const title = (L && ok ? t + " · " : "") + "Рыночный пульт";   // the live price is readable from a background tab
  if (document.title !== title) document.title = title;
}
new MutationObserver(mirror).observe($("hPrice").parentNode, {childList: true, subtree: true, characterData: true});
mirror();
if ("IntersectionObserver" in window){
  let io = null;
  const watch = () => {
    if (io) io.disconnect();
    io = new IntersectionObserver((es) => {
      const out = !es[es.length - 1].isIntersecting;
      bar.classList.toggle("has-px", out);
      chip.tabIndex = out ? 0 : -1; chip.setAttribute("aria-hidden", String(!out));
      const a = links.find((x) => x.dataset.go === active); if (a) reveal(a);
    }, {rootMargin: "-" + (barH() + 4) + "px 0px 0px 0px"});
    io.observe($("hPrice"));
  };
  watch();
}

/* ---------- folding sections ---------- */
const FOLD_KEY = "desk.sections";   // "desk.fold" belongs to the markets block: the chosen folder
let folded = [];
try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) || "[]"); if (Array.isArray(v)) folded = v.filter((x) => typeof x === "string"); } catch (e){}
function showFold(sec, on){
  sec.classList.toggle("folded", on);
  const b = sec.querySelector(":scope > .sec-head .fold");
  if (b){ b.setAttribute("aria-expanded", String(!on)); b.title = on ? "Развернуть раздел" : "Свернуть раздел"; }
}
function setFold(sec, on){
  showFold(sec, on);
  folded = folded.filter((x) => x !== sec.id); if (on) folded.push(sec.id);
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch (e){}
  if (!on) D.recalc();   // the level map is drawn to the width of its box, which was zero while folded
  queue();
}
const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
for (const id of ids){
  const sec = $(id); if (!sec || sec.tagName !== "SECTION") continue;
  const h2 = sec.querySelector(":scope > .sec-head > h2"); if (!h2) continue;
  const b = document.createElement("button");
  b.type = "button"; b.className = "fold"; b.setAttribute("aria-controls", id);
  const label = document.createElement("span"); label.textContent = h2.textContent;
  b.append(label); b.insertAdjacentHTML("beforeend", CHEVRON);
  h2.replaceChildren(b);
  b.addEventListener("click", () => setFold(sec, !sec.classList.contains("folded")));
  showFold(sec, folded.includes(id));
}
if (folded.length) D.recalc();

/* ---------- a link straight to a section ---------- */
const first = location.hash.slice(1);
if (ids.includes(first) && first !== "top") go(first, false, true);
spy();
D.nav = () => ({active, picked, folded: folded.slice(), px: bar.classList.contains("has-px"), barH: barH()});
})();
