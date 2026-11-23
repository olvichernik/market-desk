// Builds web/index.html (a normal hosted page) from the artifact page plus the live layer.
const fs = require('fs');
const dir = __dirname;
let src = fs.readFileSync(dir + '/market-desk.html', 'utf8');
function rep(a, b){ if (!src.includes(a)) throw new Error('patch anchor not found: ' + a.slice(0, 70)); src = src.replace(a, b); }

// split the artifact file into head parts and body
const styleEnd = src.indexOf('</style>');
let css = src.slice(src.indexOf('<style>') + 7, styleEnd);
src = src.slice(styleEnd + 8);
css += fs.readFileSync(dir + '/src/extra.css', 'utf8');

// header: the live line joins the top line, live tiles go under the hero, the old jump row is replaced by the sticky bar
rep(`  <header class="top">`, `  <header class="top" id="top">`);
rep(`      <p class="stamp" id="stamp">Загружаю отчёты…</p>`, `      <p class="stamp live-line"><span class="live-dot off" id="liveDot"></span><span id="liveText">Подключаюсь к Hyperliquid…</span></p>
      <p class="stamp" id="stamp">Загружаю отчёты…</p>`);
rep(`    <nav class="jump" aria-label="Разделы">`, `    <div class="tiles q">
      <div class="tile"><div class="lab">Фандинг, перп BTC</div><div class="tile-v" id="lFund">—</div><div class="tile-s" id="lFundS"></div></div>
      <div class="tile"><div class="lab">Открытый интерес, перп</div><div class="tile-v" id="lOi">—</div><div class="tile-s" id="lOiS"></div></div>
      <div class="tile"><div class="lab">Объём за сутки, перп</div><div class="tile-v" id="lVol">—</div><div class="tile-s" id="lVolS"></div></div>
      <div class="tile"><div class="lab">Плечо вольта</div><div class="tile-v" id="lLev">—</div><div class="tile-s" id="lLevS"></div></div>
    </div>

    <nav class="jump" aria-label="Разделы">`);
{ const a = src.indexOf(`    <nav class="jump"`), b = src.indexOf(`</nav>`, a); if (a < 0 || b < 0) throw new Error('jump nav not found'); src = src.slice(0, a) + src.slice(b + 7); }

const BAR = `<div class="bar" id="bar">
  <div class="bar-in" id="barIn">
    <a class="bar-brand" href="#top" data-go="top" title="Наверх">Рыночный пульт</a>
    <nav class="bar-nav" id="nav" aria-label="Разделы">
      <a href="#top" data-go="top">Обзор</a>
      <a href="#chart" data-go="chart">График</a>
      <a href="#today" data-go="today">Отчёт</a>
      <a href="#markets" data-go="markets">Рынки</a>
      <a href="#tokens" data-go="tokens">Токены</a>
      <a href="#etf" data-go="etf">ETF</a>
      <a href="#fed" data-go="fed">ФРС</a>
      <a href="#mood" data-go="mood">Настроение</a>
      <a href="#cycle" data-go="cycle">Цикл</a>
      <a href="#ladder" data-go="ladder">Уровни</a>
      <a href="#vault" data-go="vault">Вольт</a>
    </nav>
    <a class="bar-px" id="barPx" href="#top" data-go="top" tabindex="-1" aria-hidden="true"><span class="live-dot off" id="bDot"></span><b id="bPrice">—</b><span class="chg" id="bChg"></span></a>
  </div>
</div>
`;

// new sections: BTC chart before the digest, markets after the levels
rep(`  <section class="sec" id="today">`, `  <section class="sec" id="chart">
    <div class="sec-head">
      <h2>График BTC</h2>
      <p class="sec-note" id="mkNote">Hyperliquid, спот UBTC/USDC</p>
    </div>
    <div class="panel stack chart-panel" id="chartPanel">
      <div class="chart-bar">
        <div class="chart-ctl">
        <div class="seg" id="mk" role="group" aria-label="Рынок">
          <button type="button" data-mk="spot" aria-pressed="true">Спот</button>
          <button type="button" data-mk="perp" aria-pressed="false">Перп</button>
          <button type="button" data-mk="tv" aria-pressed="false">TradingView</button>
        </div>
        <div class="seg" id="tf" role="group" aria-label="Интервал свечей">
          <button type="button" data-tf="1m" aria-pressed="false">1м</button>
          <button type="button" data-tf="5m" aria-pressed="false">5м</button>
          <button type="button" data-tf="15m" aria-pressed="false">15м</button>
          <button type="button" data-tf="1h" aria-pressed="false">1ч</button>
          <button type="button" data-tf="4h" aria-pressed="false">4ч</button>
          <button type="button" data-tf="1d" aria-pressed="true">1д</button>
          <button type="button" data-tf="1w" aria-pressed="false">1н</button>
        </div>
        </div>
        <button type="button" class="btn" id="expand">Развернуть</button>
      </div>
      <div class="lw-wrap" id="lwWrap"><div class="lw" id="lw"></div><div class="lw-legend" id="lwLegend"></div></div>
      <div class="tvbox lw-tv" id="tvBtc" hidden><p>График TradingView загружается. Если он не появился, виджет заблокирован браузером или расширением.</p></div>
      <p class="hint" id="lwNote">Загружаю свечи с Hyperliquid…</p>
    </div>
  </section>

  <section class="sec" id="today">`);
rep(`  <section class="sec" id="ladder">`, `  <section class="sec" id="markets">
    <div class="sec-head">
      <h2>Рынки</h2>
      <p class="sec-note">Графики, котировки и календарь TradingView</p>
    </div>
    <div class="seg" id="fold" role="group" aria-label="Папки"></div>
    <div class="mk-grid">
      <div class="panel"><div class="tvbox big" id="tvChart"><p>График TradingView загружается. Если он не появился, виджет заблокирован браузером или расширением.</p></div></div>
      <div class="panel mk-side"><div class="tk-list" id="foldItems" role="group" aria-label="Инструменты папки"></div><p class="hint" id="tkNote"></p></div>
    </div>
    <div class="mk-row2">
      <div class="panel"><div class="tvbox" id="tvQuotes"><p>Котировки папки загружаются.</p></div></div>
      <div class="panel"><div class="tvbox cal" id="tvCal"><p>Экономический календарь TradingView загружается.</p></div></div>
    </div>
  </section>

  <section class="sec" id="tokens" hidden>
    <div class="sec-head">
      <h2>Токены: выручка и оценка</h2>
      <p class="sec-note" id="tokStamp"></p>
    </div>
    <div class="panel stack">
      <div class="scroll">
        <table class="tbl tok-tbl" id="tokTable">
          <thead><tr><th>Токен</th><th class="r">Цена</th><th class="r">Капитализация</th><th class="r">Выручка за 30 дней</th><th class="r">Держателям за 30 дней</th><th class="r">Капитализация к годовой выручке</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <p class="hint" id="tokNote"></p>
    </div>
  </section>

  <section class="sec" id="etf">
    <div class="sec-head">
      <h2>Потоки в крипто-ETF</h2>
      <p class="sec-note">Спотовые ETF в США: сколько денег пришло и ушло за день</p>
    </div>
    <div class="chart-bar">
      <div class="seg" id="etfAsset" role="group" aria-label="Актив"></div>
      <p class="etf-links" id="etfLinks"></p>
    </div>
    <div class="etf-grid" id="etfGrid">
    <div class="panel stack" id="etfDays" hidden>
      <div class="sec-head"><h3 id="etfDaysT">По дням</h3><p class="sec-note" id="etfDaysS"></p></div>
      <div class="tiles q">
        <div class="tile"><div class="lab">Последняя сессия</div><div class="tile-v" id="efLast">—</div><div class="tile-s" id="efLastS"></div></div>
        <div class="tile"><div class="lab">За 5 сессий</div><div class="tile-v" id="efWeek">—</div><div class="tile-s" id="efWeekS"></div></div>
        <div class="tile"><div class="lab" id="efAllL">За все дни на графике</div><div class="tile-v" id="efAll">—</div><div class="tile-s" id="efAllS"></div></div>
        <div class="tile"><div class="lab">Серия</div><div class="tile-v" id="efRun">—</div><div class="tile-s" id="efRunS"></div></div>
      </div>
      <p class="ef-read" id="efRead" aria-live="polite"></p>
      <div class="ef-bars" id="efBars" role="group" aria-label="Чистый поток по дням"></div>
      <p class="hint" id="efNote"></p>
    </div>
      <div class="panel stack"><h3 id="etfFlowsT">По фондам</h3><div class="etfbox" id="etfFlows"><p>График The Block загружается. Если он не появился, его блокирует браузер или расширение.</p></div></div>
      <div class="panel stack"><h3 id="etfTotalT">Все фонды вместе</h3><div class="etfbox" id="etfTotal"><p>График The Block загружается. Если он не появился, его блокирует браузер или расширение.</p></div></div>
    </div>
    <p class="hint">Графики The Block: период переключается кнопками 1M, 3M, 12M, YTD и ALL, точные суммы видны при наведении. Данные за день появляются после закрытия торгов в США, обычно к утру по Варшаве; The Block иногда обновляется на сутки позже, чем SoSoValue и Farside.</p>
  </section>

  <section class="sec" id="fed">
    <div class="sec-head">
      <h2>ФРС: ставка и заседания</h2>
      <p class="sec-note" id="fedStamp">Вероятности с биржи прогнозов Kalshi</p>
    </div>
    <div class="fed-grid" id="fedGrid">
      <div class="panel stack" id="fedNext">
        <div class="sec-head"><h3 id="fedNextT">Ближайшее заседание</h3><p class="sec-note" id="fedNextS"></p></div>
        <div class="tiles q">
          <div class="tile"><div class="lab">Решение</div><div class="tile-v" id="fdWhen">—</div><div class="tile-s" id="fdWhenS"></div></div>
          <div class="tile"><div class="lab">Осталось</div><div class="tile-v" id="fdLeft">—</div><div class="tile-s" id="fdLeftS"></div></div>
          <div class="tile"><div class="lab">Ставка сейчас</div><div class="tile-v" id="fdCur">—</div><div class="tile-s" id="fdCurS"></div></div>
          <div class="tile"><div class="lab">Рынок ждёт</div><div class="tile-v" id="fdExp">—</div><div class="tile-s" id="fdExpS"></div></div>
        </div>
        <div class="stack" id="fdOddsBox" hidden>
          <h4>Вероятности исходов</h4>
          <p class="fd-avg" id="fdAvg"></p>
          <div class="scroll">
            <table class="tbl fd-tbl" id="fdOdds"><thead></thead><tbody></tbody></table>
          </div>
        </div>
        <p class="hint" id="fdNote"></p>
      </div>
      <div class="panel stack" id="fedOdds" hidden>
        <div class="sec-head"><h3 id="foT">Ставки на решение ФРС</h3><p class="sec-note" id="foS">рынок исходов Hyperliquid</p></div>
        <div class="tiles fo-tiles" id="foTiles"></div>
        <div class="chart-bar">
          <div class="seg" id="foRange" role="group" aria-label="Период графика">
            <button type="button" data-r="all" aria-pressed="true">Всё время</button>
            <button type="button" data-r="7d" aria-pressed="false">7 дней</button>
          </div>
          <p class="fo-read" id="foRead" aria-live="polite"></p>
        </div>
        <div class="fo-chart" id="foChart"></div>
        <p class="hint" id="foNote"></p>
      </div>
      <div class="panel stack" id="fedSched">
        <div class="sec-head"><h3>График заседаний</h3><p class="sec-note fd-legend" id="fdLegend"></p></div>
        <div class="scroll">
          <table class="tbl fd-tbl" id="fdSched">
            <thead><tr><th>Заседание и время решения</th><th>Что ждёт рынок</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <p class="hint" id="fdSchedNote"></p>
      </div>
    </div>
  </section>

  <section class="sec" id="mood" hidden>
    <div class="sec-head">
      <h2>Настроение и ликвидность</h2>
      <p class="sec-note">Страх и жадность, плата за плечо, деньги в стейблкоинах</p>
    </div>
    <div class="mood-grid">
      <div class="panel stack" id="fgBox" hidden>
        <div class="sec-head"><h3>Индекс страха и жадности</h3><p class="sec-note" id="fgS"></p></div>
        <div class="tiles fo-tiles">
          <div class="tile"><div class="lab">Сегодня</div><div class="tile-v" id="fgNow">—</div><div class="tile-s" id="fgNowS"></div></div>
          <div class="tile"><div class="lab">Неделю назад</div><div class="tile-v" id="fgW">—</div><div class="tile-s" id="fgWS"></div></div>
          <div class="tile"><div class="lab">Месяц назад</div><div class="tile-v" id="fgM">—</div><div class="tile-s" id="fgMS"></div></div>
        </div>
        <p class="fo-read" id="fgRead" aria-live="polite"></p>
        <div class="lw-xs" id="fgChart"></div>
        <p class="hint" id="fgNote"></p>
      </div>
      <div class="panel stack" id="fuBox" hidden>
        <div class="sec-head"><h3>Фандинг за месяц</h3><p class="sec-note" id="fuS"></p></div>
        <div class="tiles fo-tiles">
          <div class="tile"><div class="lab">Сейчас</div><div class="tile-v" id="fuNow">—</div><div class="tile-s" id="fuNowS"></div></div>
          <div class="tile"><div class="lab">За 7 дней</div><div class="tile-v" id="fuW">—</div><div class="tile-s" id="fuWS"></div></div>
          <div class="tile"><div class="lab">За 30 дней</div><div class="tile-v" id="fuM">—</div><div class="tile-s" id="fuMS"></div></div>
        </div>
        <p class="fo-read" id="fuRead" aria-live="polite"></p>
        <div class="lw-xs" id="fuChart"></div>
        <p class="hint" id="fuNote"></p>
      </div>
      <div class="panel stack" id="stBox" hidden>
        <div class="sec-head"><h3>Стейблкоины</h3><p class="sec-note" id="stS"></p></div>
        <div class="tiles fo-tiles">
          <div class="tile"><div class="lab">Всего</div><div class="tile-v" id="stNow">—</div><div class="tile-s" id="stNowS"></div></div>
          <div class="tile"><div class="lab">За 7 дней</div><div class="tile-v" id="stW">—</div><div class="tile-s" id="stWS"></div></div>
          <div class="tile"><div class="lab">За 30 дней</div><div class="tile-v" id="stM">—</div><div class="tile-s" id="stMS"></div></div>
        </div>
        <p class="fo-read" id="stRead" aria-live="polite"></p>
        <div class="lw-xs" id="stChart"></div>
        <p class="hint" id="stNote"></p>
      </div>
    </div>
  </section>

  <section class="sec" id="cycle" hidden>
    <div class="sec-head">
      <h2>Где мы в цикле</h2>
      <p class="sec-note" id="cyStamp"></p>
    </div>
    <div class="cy-grid">
      <div class="panel stack" id="cyStats">
        <div class="tiles">
          <div class="tile"><div class="lab">Цена к реализованной, MVRV</div><div class="tile-v" id="cyMvrv">—</div><div class="tile-s" id="cyMvrvS"></div></div>
          <div class="tile"><div class="lab">Множитель Майера</div><div class="tile-v" id="cyMayer">—</div><div class="tile-s" id="cyMayerS"></div></div>
          <div class="tile"><div class="lab">К 200-недельной средней</div><div class="tile-v" id="cy200w">—</div><div class="tile-s" id="cy200wS"></div></div>
          <div class="tile"><div class="lab">От пика цикла</div><div class="tile-v" id="cyDd">—</div><div class="tile-s" id="cyDdS"></div></div>
          <div class="tile"><div class="lab">Дней от пика</div><div class="tile-v" id="cyDays">—</div><div class="tile-s" id="cyDaysS"></div></div>
          <div class="tile"><div class="lab">Минимум цикла</div><div class="tile-v" id="cyLow">—</div><div class="tile-s" id="cyLowS"></div></div>
        </div>
        <h4>Циклы: дно после пика</h4>
        <div class="scroll">
          <table class="tbl cy-tbl" id="cyTable">
            <thead><tr><th>Цикл</th><th class="r">Дней от пика</th><th class="r">Просадка</th><th class="r">MVRV</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <p class="hint" id="cyNote"></p>
      </div>
      <div class="panel stack" id="cyChartBox">
        <div class="sec-head"><h3>Цена и реализованная цена</h3>
          <p class="sec-note fd-legend"><span><i class="fo-dot" style="background:var(--s1)"></i>цена</span><span><i class="fo-dot" style="background:var(--s2)"></i>реализованная цена</span><span><i class="cy-band"></i>цена ниже реализованной</span></p></div>
        <div class="chart-bar">
          <div class="seg" id="cyRange" role="group" aria-label="Период графика">
            <button type="button" data-r="all" aria-pressed="true">Вся история</button>
            <button type="button" data-r="5y" aria-pressed="false">5 лет</button>
            <button type="button" data-r="2y" aria-pressed="false">2 года</button>
          </div>
          <p class="fo-read" id="cyRead" aria-live="polite"></p>
        </div>
        <div class="cy-chart" id="cyChart"></div>
        <p class="hint" id="cyChartNote"></p>
      </div>
    </div>
  </section>

  <section class="sec" id="ladder">`);

// vault: live panel with positions before the what-if block
rep(`    <div class="panel v-what">`, `    <div class="panel stack" id="vLive" hidden>
      <div class="sec-head"><h3>Сейчас в вольте</h3><p class="sec-note" id="vlStamp"></p></div>
      <div class="tiles q">
        <div class="tile"><div class="lab">Размер</div><div class="tile-v" id="vlAv">—</div><div class="tile-s">стоимость счёта вольта</div></div>
        <div class="tile"><div class="lab">Плечо</div><div class="tile-v" id="vlLev">—</div><div class="tile-s" id="vlLevS"></div></div>
        <div class="tile"><div class="lab">APR по Hyperliquid</div><div class="tile-v" id="vlApr">—</div><div class="tile-s">как считает сама биржа</div></div>
        <div class="tile"><div class="lab">Доля управляющего</div><div class="tile-v" id="vlLead">—</div><div class="tile-s">его деньги в вольте</div></div>
      </div>
      <div class="scroll">
        <table class="tbl" id="vPos">
          <thead><tr><th>Позиция</th><th class="r">Размер</th><th class="r">Плечо</th><th class="r">Вход</th><th class="r">Ликвидация</th><th class="r">Результат</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="stack" id="vPnlBox" hidden>
        <h4>Прибыль и убыток вольта за всё время, $</h4>
        <div class="lw-sm" id="vPnlChart"></div>
      </div>
    </div>
    <div class="panel v-what">`);

// script patches: live price first, hooks for the live layer
rep(`      .sort((a, b) => a.date < b.date ? 1 : -1);
    S.load = "ok";`, `      .sort((a, b) => a.date < b.date ? 1 : -1);
    S.reportAge = S.digests[0] ? daysAgo(S.digests[0].date) : null;
    if (S.reportAge > 10) S.digests = [];   // a report that stopped coming hides itself instead of showing old numbers
    S.load = "ok";`);
rep(`  else if (S.digests[0] && daysAgo(S.digests[0].date) > 3) msg =`, `  else if (S.reportAge > 10) msg = "Утренний отчёт не выходил " + S.reportAge + " " + plural(S.reportAge, "день", "дня", "дней") + ", поэтому он скрыт. Остальные блоки работают как обычно.";
  else if (S.digests[0] && daysAgo(S.digests[0].date) > 3) msg =`);
rep(`function btcNow(){
`, `function btcNow(){
  if (S.live && S.live.price > 0) return {price: S.live.price, chg: S.live.chg, date: null, live: true};
`);
rep(`function normDigest(d){`, `function normEtf(e){
  if (!e || typeof e !== "object") return null;
  const out = {asOf: str(e.asOf, 160), source: str(e.source, 160)};
  let any = false;
  for (const k of ["btc", "eth", "sol", "xrp", "hype"]){
    out[k] = arr(e[k], 80).filter((x) => x && typeof x === "object" && isDate(x.date) && numv(x.flow) != null && Math.abs(x.flow) < 1e5).map((x) => ({date: x.date, flow: x.flow}));
    if (out[k].length) any = true;
  }
  return any ? out : null;
}
function normDigest(d){`);
rep(`    vault: normVault(d.vault),
  };`, `    vault: normVault(d.vault),
    etf: normEtf(d.etf),
  };`);
rep(`    sub.append("из отчёта за " + longDate(now.date));`, `    sub.append(now.live ? "живая цена, спот на Hyperliquid" : "из отчёта за " + longDate(now.date));`);
rep(`  } catch (e){ S.load = "error"; }
  renderAll();
}`, `  } catch (e){ S.load = "error"; }
  renderAll();
  if (S.onData) S.onData();
}`);
rep(`renderAll();
load();
})();`, `window.DESK = {S, $, h, usd, usdBig, pct, nf0, nf1, nf2, btcf, levelSet, recalc, renderHero, renderVault, longDate, shortDate, parseDate, plural, daysAgo, btcNow};
renderAll();
load();
})();`);
rep(`Отчёт обновляется по будням около 08:00 по Варшаве, у каждой цифры подписано время сбора.`, `Цена, график, фандинг и все цифры вольта приходят с Hyperliquid в реальном времени, 200-недельная средняя и минимум за год считаются по свечам Hyperliquid, реализованная цена приходит от BGeometrics с задержкой около недели, графики рынков и календарь показывает TradingView, потоки ETF приходят с SoSoValue и The Block, вероятности по заседаниям ФРС раз в час обновляются с биржи прогнозов Kalshi, текущая ставка берётся из данных ФРС (FRED), ставки на ближайшее решение идут с рынка исходов Hyperliquid. История цены и реализованной цены с 2011 года взята у Bitbo, шансы касания уровней считаются по индексу волатильности Deribit, индекс страха и жадности отдаёт alternative.me, стейблкоины и выручку протоколов считает DefiLlama, капитализацию токенов даёт CoinGecko. Утренний отчёт обновляется по будням около 08:00 по Варшаве, у каждой цифры подписано время сбора.`);

const body = src.slice(src.indexOf('<div class="page">'));
const scriptAt = body.indexOf('<script>');
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Рыночный пульт</title>
<meta name="description" content="Биткойн в реальном времени, уровни и цели, рынки, вольт DOUBLETOP и утренний отчёт.">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#eef2f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1214" media="(prefers-color-scheme: dark)">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%232a78d6'/%3E%3Cpath d='M6 21l6-7 5 4 9-10' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geologica:wght@500;600;700&family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>${css}</style>
</head>
<body>
${BAR}${body.slice(0, scriptAt)}<script src="vendor/lightweight-charts.standalone.production.js"></script>
${body.slice(scriptAt)}
<script>
${fs.readFileSync(dir + '/src/live.js', 'utf8')}</script>
<script>
${fs.readFileSync(dir + '/src/insight.js', 'utf8')}</script>
<script>
${fs.readFileSync(dir + '/src/nav.js', 'utf8')}</script>
</body>
</html>
`;
fs.writeFileSync(dir + '/web/index.html', html);
fs.copyFileSync(dir + '/webdata/data.json', dir + '/web/data.json');
fs.writeFileSync(dir + '/web/.nojekyll', '');
fs.copyFileSync(dir + '/src/watchlist.json', dir + '/web/watchlist.json');
fs.copyFileSync(dir + '/src/fed.json', dir + '/web/fed.json');
fs.copyFileSync(dir + '/src/fed-calendar.json', dir + '/web/fed-calendar.json');
fs.copyFileSync(dir + '/src/levels.json', dir + '/web/levels.json');
fs.copyFileSync(dir + '/src/history.json', dir + '/web/history.json');
console.log('built', html.length, 'bytes');
