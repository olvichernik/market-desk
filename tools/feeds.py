#!/usr/bin/env python3
"""Refreshes the data files the site cannot fetch from a browser.

Runs from GitHub Actions on a schedule; no secrets, no dependencies, nobody's computer. The schedule starts it several
times an hour because GitHub skips many scheduled starts; every part below refreshes only when its data has aged.

fed.json: the Fed's current target range and market odds for each coming meeting
  - odds per meeting: Kalshi's public market-data API (series KXFEDDECISION: hike, hold, cut)
  - current target range: FRED series DFEDTARL / DFEDTARU (the Fed's own numbers)
  - meeting calendar: fed-calendar.json in this repository
levels.json: bitcoin's realized price
  - BGeometrics' free API (bitcoin-data.com); the free tier serves a value about a week old, and its date is kept
  - every new daily value is also appended to "hist", which continues the site's chart after history.json ends
  Bitbo and Woocharts publish fresher numbers but refuse scripts (HTTP 428 and 429), so they are not used.
  Levels that can be computed from exchange candles (the yearly low, the 200-week average) are computed by the page itself.
liq.json: the total of dollar stablecoins, daily, for the last 400 days (DefiLlama; the full answer is over a megabyte,
  too heavy for a page to load on every visit)
tokens.json: for a few tokens, protocol revenue and what goes to holders over 30 days (DefiLlama) with supply,
  market value and the all-time high (CoinGecko); the page multiplies the supply by a live price itself

macro.json: liquidity outside crypto, one value a week (Wednesdays) since 2013, in billions of dollars
  - M2 of the four largest economies: the United States (FRED, weekly), the euro area (ECB), China (the People's Bank's
    monthly figures as republished by Eastmoney) and Japan (Bank of Japan), each at the exchange rate of that week
    (ECB reference rates); the latest weeks use the last published M2 with a fresh exchange rate
  - the balance sheets of the Fed, the ECB and the Bank of Japan together (FRED)
  - the Fed's net liquidity: its assets minus the Treasury's account and the reverse repo facility (FRED)
  - US M2 on its own and all dollar stablecoins (DefiLlama), for the same chart

Each source is optional: if one is unreachable or looks wrong, the previous values for that part are
kept, and the site hides numbers that have not been refreshed for several days.
"""
import bisect
import csv
import datetime as dt
import io
import json
import os
import sys
import time
import urllib.request

KALSHI = "https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXFEDDECISION&status=open&with_nested_markets=true&limit=50"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARL,DFEDTARU&cosd="
OUT, CAL, LEVELS, LIQ, TOKENS, MACRO = "fed.json", "fed-calendar.json", "levels.json", "liq.json", "tokens.json", "macro.json"
FRED_ONE = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=2012-01-01"       # one series a request: mixed frequencies come back as a zip
ECB_M2 = "https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M20.X.1.U2.2300.Z01.E?format=csvdata&startPeriod=2012-01&detail=dataonly"
ECB_FX = "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY+CNY.EUR.SP00.A?format=csvdata&startPeriod=2012-01-01&detail=dataonly"
CN_M2 = "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_CURRENCY_SUPPLY&columns=ALL&pageNumber=1&pageSize=500&sortTypes=-1&sortColumns=REPORT_DATE&source=WEB&client=WEB"
BOJ_M2 = "https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=json&lang=en&db=MD02&code=MAM1NAM2M2MO&startDate=201201"
GRID0 = dt.date(2013, 1, 2)                       # a Wednesday: the Fed dates its balance sheet by Wednesdays
BG_REALIZED = "https://bitcoin-data.com/v1/realized-price/last"
STABLES = "https://stablecoins.llama.fi/stablecoincharts/all"
LLAMA_FEES = "https://api.llama.fi/summary/fees/%s?dataType=%s"
GECKO = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=%s"
# tokens in the order the site shows them; "h" is the Hyperliquid market the page takes a live price from
TOKEN_LIST = [
    {"k": "eth", "n": "Ethereum", "sym": "eth", "h": "ETH", "gecko": "ethereum", "llama": "ethereum", "chain": True},
    {"k": "sol", "n": "Solana", "sym": "sol", "h": "SOL", "gecko": "solana", "llama": "solana", "chain": True},
    {"k": "hype", "n": "Hyperliquid", "sym": "hype", "h": "HYPE", "gecko": "hyperliquid", "llama": "hyperliquid"},
    {"k": "lit", "n": "Lighter", "sym": "lit", "h": "LIT", "gecko": "lighter", "llama": "lighter"},
    {"k": "aave", "n": "Aave", "sym": "aave", "h": "AAVE", "gecko": "aave", "llama": "aave"},
    {"k": "uni", "n": "Uniswap", "sym": "uni", "h": "UNI", "gecko": "uniswap", "llama": "uniswap"},
]
FORCE = os.environ.get("FORCE_LEVELS") == "true"
SAMPLES = os.environ.get("FEED_SAMPLES")          # local test: a folder with saved answers instead of the network
UA = "market-desk feed (+https://github.com/olvichernik/market-desk)"
LEG = {"H0": "hold", "H25": "up25", "H26": "upBig", "C25": "down25", "C26": "downBig"}


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/csv;q=0.9, */*;q=0.5"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def fetch(name, url):
    """JSON from the network, or from a saved file when testing locally."""
    if SAMPLES:
        return json.load(open(os.path.join(SAMPLES, name + ".json"), encoding="utf-8"))
    return json.loads(get(url, 25))


def raw(name, url):
    """Text from the network, or from a saved file when testing locally."""
    if SAMPLES:
        return open(os.path.join(SAMPLES, name), encoding="utf-8").read()
    return get(url, 45)


def stamp(now):
    return now.strftime("%Y-%m-%dT%H:%M:%SZ")


def fresh(path, now, hours, key="updated"):
    """The file's content if it was refreshed less than `hours` ago, and its content either way."""
    try:
        old = json.load(open(path, encoding="utf-8"))
    except Exception:
        return False, {}
    try:
        age = (now - dt.datetime.fromisoformat(str(old.get(key)).replace("Z", "+00:00"))).total_seconds()
    except ValueError:
        age = 1e9
    return age < hours * 3600 and not FORCE and not SAMPLES, old


def write(path, doc_text):
    json.loads(doc_text)
    open(path, "w", encoding="utf-8").write(doc_text)


def num(v):
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def price(m, prev=False):
    """Mid of the best bid and ask when the spread is tight, otherwise the last trade."""
    p = "previous_" if prev else ""
    bid, ask = num(m.get(p + "yes_bid_dollars")), num(m.get(p + "yes_ask_dollars"))
    last = num(m.get("previous_price_dollars" if prev else "last_price_dollars"))
    if bid is not None and ask is not None and 0 <= bid <= ask <= 1 and ask > 0 and ask - bid <= 0.10:
        return (bid + ask) / 2
    return last if last is not None and 0 <= last <= 1 else None


def leg_of(m):
    k = LEG.get(str(m.get("ticker", "")).rsplit("-", 1)[-1])
    if k:
        return k
    t = str(m.get("yes_sub_title") or m.get("subtitle") or "").lower()
    if "maintain" in t or "no change" in t:
        return "hold"
    if "hike" in t:
        return "upBig" if ">" in t else "up25"
    if "cut" in t:
        return "downBig" if ">" in t else "down25"
    return None


def shares(markets, prev=False):
    """Five outcomes of one meeting as percentages that add up to 100."""
    raw = {}
    for m in markets:
        k, p = leg_of(m), price(m, prev)
        if k and p is not None:
            raw[k] = raw.get(k, 0) + p
    total = sum(raw.values())
    if "hold" not in raw or len(raw) < 3 or not 0.7 <= total <= 1.3:
        return None
    pct = lambda *ks: round(sum(raw.get(k, 0) for k in ks) / total * 100, 1)
    return {"up": pct("up25", "upBig"), "hold": pct("hold"), "down": pct("down25", "downBig"), "up25": pct("up25"), "down25": pct("down25")}


def kalshi(text):
    out = []
    for e in json.loads(text).get("events", []):
        at = str(e.get("strike_date") or "")
        ms = [m for m in e.get("markets", []) if isinstance(m, dict)]
        try:
            day = dt.datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(dt.timezone(dt.timedelta(hours=-5))).date().isoformat()
        except ValueError:
            continue
        now, prev = shares(ms), shares(ms, prev=True)
        if not now:
            continue
        row = {"date": day}
        row.update(now)
        if prev:
            row["p1"] = [prev["up"], prev["hold"], prev["down"]]
        row["vol"] = int(sum(num(m.get("volume_fp")) or 0 for m in ms))
        out.append(row)
    return sorted(out, key=lambda r: r["date"])


def fred(text):
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        d = r.get("observation_date") or r.get("DATE")
        lo, hi = num(r.get("DFEDTARL")), num(r.get("DFEDTARU"))
        if d and lo is not None and hi is not None and 0 <= lo < hi <= 20:
            rows.append((d, lo, hi))
    return sorted(rows)


def source(name, arg, url):
    try:
        return open(arg, encoding="utf-8").read() if arg else get(url)
    except Exception as e:
        print(name, "unavailable:", repr(e))
        return None


def levels(now, sample=None):
    """Realized price with the date of its own last value."""
    try:
        old = json.load(open(LEVELS, encoding="utf-8"))
    except Exception:
        old = {}
    try:
        age = (now - dt.datetime.fromisoformat(str(old.get("updated")).replace("Z", "+00:00"))).total_seconds()
    except ValueError:
        age = 1e9
    if age < 5 * 3600 and not sample and not FORCE:
        print("levels.json is fresh")
        return
    try:
        j = json.load(open(sample, encoding="utf-8")) if sample else json.loads(get(BG_REALIZED))
        v, day = num(j.get("realizedPrice")), str(j.get("d") or "")
        dt.date.fromisoformat(day)
        if v is None or not 1000 < v < 10_000_000:
            raise ValueError("odd value %r" % (j.get("realizedPrice"),))
    except Exception as e:
        print("BGeometrics realized price unavailable:", repr(e))
        return
    hist = {}
    for h in old.get("hist") or []:                 # one value per day, as far back as this job has been running
        if isinstance(h, list) and len(h) == 2 and isinstance(h[0], str) and num(h[1]):
            hist[h[0]] = h[1]
    for lv in old.get("levels") or []:              # the value published before this history existed
        if isinstance(lv, dict) and lv.get("key") == "realized" and lv.get("asOf") and num(lv.get("value")):
            hist.setdefault(str(lv["asOf"]), lv["value"])
    hist[day] = round(v, 2)
    rows = sorted(hist.items())[-4000:]
    one = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    head = {"updated": stamp(now), "levels": [{"key": "realized", "value": round(v, 2), "asOf": day, "src": "BGeometrics", "url": "https://bitcoin-data.com/"}]}
    write(LEVELS, one(head)[:-1] + ',\n"hist":[' + ",".join(one(list(r)) for r in rows) + "]}\n")
    print("levels.json: realized %s (%s), %d days of history" % (round(v, 2), day, len(rows)))


_stable = []


def stable_rows():
    """Every day DefiLlama has, as [date, dollars]; read once a run."""
    if not _stable:
        rows = []
        for r in fetch("stables", STABLES):
            t, v = num(r.get("date")), num((r.get("totalCirculatingUSD") or {}).get("peggedUSD"))
            if t and v and v > 0:
                rows.append([dt.datetime.fromtimestamp(t, dt.timezone.utc).date().isoformat(), int(round(v, -6))])
        _stable.extend(sorted({r[0]: r for r in rows}.values()))
    return _stable


def stables(now):
    """Dollar stablecoins in circulation, one total a day."""
    ok, old = fresh(LIQ, now, 6)
    if ok:
        print("liq.json is fresh")
        return
    try:
        rows = stable_rows()[-400:]
        last = dt.date.fromisoformat(rows[-1][0])
        if len(rows) < 300 or not 5e10 < rows[-1][1] < 5e12 or (now.date() - last).days > 5:
            raise ValueError("odd series: %d rows, last %r" % (len(rows), rows[-1]))
    except Exception as e:
        print("DefiLlama stablecoins unavailable:", repr(e))
        return
    one = lambda x: json.dumps(x, separators=(",", ":"))
    write(LIQ, '{"updated":"%s","src":"DefiLlama","stables":[\n%s\n]}\n' % (stamp(now), ",".join(one(r) for r in rows)))
    print("liq.json: %d days, last %s %.1f bn" % (len(rows), rows[-1][0], rows[-1][1] / 1e9))


def tokens(now):
    """Revenue and holders' share for a few tokens, with what is needed to price them."""
    ok, old = fresh(TOKENS, now, 6)
    if ok:
        print("tokens.json is fresh")
        return
    prev = {t.get("k"): t for t in old.get("tokens") or [] if isinstance(t, dict)}
    try:
        market = {m.get("id"): m for m in fetch("gecko", GECKO % ",".join(t["gecko"] for t in TOKEN_LIST)) if isinstance(m, dict)}
    except Exception as e:
        print("CoinGecko unavailable:", repr(e))
        market = {}
    out, got_market, got_fees = [], 0, 0
    for t in TOKEN_LIST:
        row = dict(prev.get(t["k"]) or {})
        row.update({"k": t["k"], "n": t["n"], "sym": t["sym"], "h": t["h"]})
        if t.get("chain"):
            row["chain"] = True
        m = market.get(t["gecko"])
        if m and num(m.get("current_price")) and (num(m.get("circulating_supply")) or num(m.get("market_cap"))):
            row.update({"px": m["current_price"], "circ": num(m.get("circulating_supply")), "mc": num(m.get("market_cap")),
                        "fdv": num(m.get("fully_diluted_valuation")), "ath": num(m.get("ath")), "athDate": str(m.get("ath_date") or "")[:10]})
            got_market += 1
        fees = {}
        for field, kind in (("fees30", "dailyFees"), ("rev30", "dailyRevenue"), ("hold30", "dailyHoldersRevenue")):
            try:
                j = fetch("fees-%s-%s" % (t["llama"], kind), LLAMA_FEES % (t["llama"], kind))
                chart = [c for c in j.get("totalDataChart") or [] if isinstance(c, list) and len(c) == 2 and num(c[1]) is not None]
                total = num(j.get("total30d"))
                if total is None and len(chart) >= 30:
                    total = sum(c[1] for c in chart[-30:])
                if total is None or total < 0:
                    raise ValueError("no 30-day total")
                fees[field] = round(total)
                if field == "rev30" and len(chart) >= 60:
                    fees["revPrev30"] = round(sum(c[1] for c in chart[-60:-30]))
            except Exception as e:
                print("DefiLlama %s %s unavailable:" % (t["llama"], kind), repr(e))
            if not SAMPLES:
                time.sleep(0.4)
        if "rev30" in fees:
            for stale in ("fees30", "hold30", "revPrev30"):
                row.pop(stale, None)          # numbers of one refresh only, never mixed with an older one
            row.update(fees)
            got_fees += 1
        if num(row.get("px")) and (num(row.get("circ")) or num(row.get("mc"))) and num(row.get("rev30")) is not None:
            out.append(row)
    if not out or (not got_market and not got_fees):
        print("tokens: nothing refreshed, kept the old file")
        return
    doc = {"updated": stamp(now), "revAt": stamp(now) if got_fees >= len(TOKEN_LIST) / 2 else old.get("revAt"),
           "pxAt": stamp(now) if got_market else old.get("pxAt")}
    one = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    write(TOKENS, one(doc)[:-1] + ',\n"tokens":[\n' + ",\n".join(one(r) for r in out) + "\n]}\n")
    print("tokens.json: %d tokens, market data for %d, revenue for %d" % (len(out), got_market, got_fees))


def month_end(period):
    """The last day of a month given as 2026-10, 202610 or 2026-10-01."""
    p = str(period).replace("-", "")
    y, m = int(p[:4]), int(p[4:6])
    return (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)).isoformat()


class Step:
    """A series that holds its last published value until the next one."""
    def __init__(self, rows):
        rows = sorted((d, v) for d, v in rows if v is not None and v > 0)
        if len(rows) < 60:
            raise ValueError("only %d rows" % len(rows))
        self.d, self.v = [r[0] for r in rows], [r[1] for r in rows]

    def at(self, day, max_age):
        i = bisect.bisect_right(self.d, day) - 1
        if i < 0 or (dt.date.fromisoformat(day) - dt.date.fromisoformat(self.d[i])).days > max_age:
            return None
        return self.v[i]

    def when(self, day):
        i = bisect.bisect_right(self.d, day) - 1
        return self.d[i] if i >= 0 else None


def fred_one(sid, scale, monthly=False):
    rows = []
    for r in csv.DictReader(io.StringIO(raw("fred-%s.csv" % sid, FRED_ONE % sid))):
        d, v = r.get("observation_date") or r.get("DATE"), num(r.get(sid))
        if d and v is not None:
            rows.append((month_end(d) if monthly else d, v * scale))
    return rows


def ecb_csv(name, url):
    """ECB data as {currency or "": [(period, value)]}."""
    out = {}
    for r in csv.DictReader(io.StringIO(raw(name, url))):
        v = num(r.get("OBS_VALUE"))
        if v is not None and r.get("TIME_PERIOD"):
            out.setdefault(r.get("CURRENCY") or "", []).append((r["TIME_PERIOD"], v))
    return out


def cn_m2():
    rows = json.loads(raw("cn-m2.json", CN_M2))["result"]["data"]          # BASIC_CURRENCY: M2 in hundreds of millions of yuan
    return [(month_end(str(r.get("REPORT_DATE"))[:7]), num(r.get("BASIC_CURRENCY")) * 1e8) for r in rows if num(r.get("BASIC_CURRENCY"))]


def boj_m2():
    s = json.loads(raw("boj-m2.json", BOJ_M2))["RESULTSET"][0]
    if "100 million yen" not in str(s.get("UNIT")):
        raise ValueError("unit %r" % (s.get("UNIT"),))
    v = s["VALUES"]
    return [(month_end(d), num(x) * 1e8) for d, x in zip(v["SURVEY_DATES"], v["VALUES"]) if num(x)]


# what the site draws: key, plausible range of the latest value in dollars, fewest weeks worth keeping
MACRO_SERIES = (("m2g", 5e13, 3e14, 400), ("m2us", 1.2e13, 5e13, 400), ("cb", 8e12, 5e13, 400), ("netfed", 1.5e12, 1.2e13, 400), ("stables", 5e10, 5e12, 150))


def macro(now):
    """Liquidity outside crypto on one weekly grid."""
    ok, old = fresh(MACRO, now, 8)
    if ok:
        print("macro.json is fresh")
        return
    today = now.date()
    last = today - dt.timedelta(days=(today.weekday() - 2) % 7)
    grid = [(GRID0 + dt.timedelta(days=7 * i)).isoformat() for i in range((last - GRID0).days // 7 + 1)]
    src = {}

    def take(key, rows):
        try:
            src[key] = Step(rows())
        except Exception as e:
            print("macro: %s unavailable:" % key, repr(e))
        if not SAMPLES:
            time.sleep(0.5)

    take("fed", lambda: fred_one("WALCL", 1e6))
    take("tga", lambda: fred_one("WTREGEN", 1e6))
    take("rrp", lambda: [(d, v + 1.0) for d, v in fred_one("RRPONTSYD", 1e9)])      # a dollar keeps the days with nothing parked
    take("m2us", lambda: fred_one("WM2NS", 1e9))
    take("ecb", lambda: fred_one("ECBASSETSW", 1e6))
    take("boj", lambda: fred_one("JPNASSETS", 1e8, monthly=True))
    try:
        fx = ecb_csv("ecb-fx.csv", ECB_FX)
        for cur in ("USD", "JPY", "CNY"):
            src["fx" + cur] = Step(fx.get(cur) or [])
    except Exception as e:
        print("macro: exchange rates unavailable:", repr(e))
    take("m2ez", lambda: [(month_end(d), v * 1e6) for d, v in ecb_csv("ecb-m2.csv", ECB_M2).get("", [])])
    take("m2cn", cn_m2)
    take("m2jp", boj_m2)
    take("stables", lambda: [(r[0], r[1]) for r in stable_rows() if r[1] >= 1e9])

    def at(key, day, age):
        return src[key].at(day, age) if key in src else None

    def usd(cur, day):                          # dollars for one unit of the currency, from the ECB's euro rates
        e = at("fxUSD", day, 10)
        if cur == "EUR" or e is None:
            return e
        o = at("fx" + cur, day, 10)
        return e / o if o else None

    def conv(key, cur, day, age):
        v, r = at(key, day, age), usd(cur, day)
        return v * r if v is not None and r is not None else None

    def total(parts):
        return sum(parts) if all(p is not None for p in parts) else None

    m2_parts = lambda d: (("us", at("m2us", d, 120)), ("ez", conv("m2ez", "EUR", d, 150)), ("cn", conv("m2cn", "CNY", d, 120)), ("jp", conv("m2jp", "JPY", d, 120)))
    cb_parts = lambda d: (("fed", at("fed", d, 6)), ("ecb", conv("ecb", "EUR", d, 45)), ("boj", conv("boj", "JPY", d, 100)))

    def net(d):
        f, t, r = at("fed", d, 6), at("tga", d, 6), at("rrp", d, 6)
        if r is None and "rrp" in src and d < src["rrp"].d[-1]:
            r = 0                               # a week inside the history with no operations at all, as in 2013
        return f - t - r if None not in (f, t, r) else None

    build = {"m2g": lambda d: total([v for _, v in m2_parts(d)]), "m2us": lambda d: at("m2us", d, 6),
             "cb": lambda d: total([v for _, v in cb_parts(d)]), "netfed": net, "stables": lambda d: at("stables", d, 6)}
    names = {"us": "m2us", "ez": "m2ez", "cn": "m2cn", "jp": "m2jp"}
    prev = old.get("series") if isinstance(old.get("series"), dict) and isD(old.get("t0")) else {}
    out, fresh_keys = {}, 0
    for key, lo, hi, least in MACRO_SERIES:
        try:
            vals = [build[key](d) for d in grid]
            have = [i for i, v in enumerate(vals) if v is not None]
            if len(have) < least:
                raise ValueError("%d weeks" % len(have))
            i = have[-1]
            before = vals[have[-2]]
            if not lo < vals[i] < hi or abs(vals[i] / before - 1) > 0.15 or (last - dt.date.fromisoformat(grid[i])).days > 200:
                raise ValueError("odd latest value %r on %s" % (vals[i], grid[i]))
            row = {"asOf": grid[i]}
            if key in ("m2g", "cb"):                     # what the total is made of, and how old each part is
                row["parts"] = {k: [round(v / 1e9, 1), src[names.get(k, k)].when(grid[i])] for k, v in (m2_parts if key == "m2g" else cb_parts)(grid[i])}
            row["v"] = [None if v is None else round(v / 1e9, 1) for v in vals]
            out[key] = row
            fresh_keys += 1
        except Exception as e:
            print("macro: %s not rebuilt:" % key, repr(e))
            p = prev.get(key)
            if isinstance(p, dict) and isinstance(p.get("v"), list):      # the previous series, moved onto today's grid
                t0 = dt.date.fromisoformat(old["t0"])
                was = {(t0 + dt.timedelta(days=7 * i)).isoformat(): v for i, v in enumerate(p["v"])}
                out[key] = dict(p, v=[was.get(d) for d in grid])
    if not fresh_keys:
        print("macro: nothing refreshed, kept the old file")
        return
    one = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    head = {"updated": stamp(now), "t0": grid[0], "step": 7, "n": len(grid), "unit": "bn USD"}
    write(MACRO, one(head)[:-1] + ',\n"series":{\n' + ",\n".join('"%s":%s' % (k, one(v)) for k, v in out.items()) + "\n}}\n")
    print("macro.json: %d weeks to %s; %s" % (len(grid), grid[-1], ", ".join("%s %s bn on %s" % (k, next(x for x in reversed(v["v"]) if x is not None), v["asOf"]) for k, v in out.items())))


def isD(v):
    try:
        dt.date.fromisoformat(str(v))
        return True
    except ValueError:
        return False


def main():
    args = sys.argv[1:]                       # local test: feeds.py kalshi.json fred.csv [realized.json]
    try:
        levels(dt.datetime.now(dt.timezone.utc), args[2] if len(args) > 2 else None)
    except Exception as e:
        print("levels skipped:", repr(e))
    for part in (stables, tokens, macro):
        try:
            part(dt.datetime.now(dt.timezone.utc))
        except Exception as e:
            print(part.__name__, "skipped:", repr(e))
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date()
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        old = {}
    try:
        odds_age = (now - dt.datetime.fromisoformat(str(old.get("oddsAt")).replace("Z", "+00:00"))).total_seconds()
    except ValueError:
        odds_age = 1e9
    if odds_age < 50 * 60 and not FORCE and not args:      # the job is started several times an hour; the odds are read once
        print("fed.json is fresh")
        return
    doc = {"v": 3, "updated": old.get("updated"), "oddsAt": old.get("oddsAt"), "source": "Kalshi", "sourceUrl": "https://kalshi.com/markets/kxfeddecision",
           "band": old.get("band"), "bandAsOf": old.get("bandAsOf"), "last": old.get("last"),
           "meetings": old.get("meetings") if old.get("v") == 3 else [], "hist": old.get("hist") if old.get("v") == 3 else []}

    text = source("Kalshi", args[0] if args else None, KALSHI)
    if text:
        try:
            ms = kalshi(text)
            if len(ms) >= 2:
                doc["meetings"], doc["oddsAt"] = ms, now.strftime("%Y-%m-%dT%H:%M:%SZ")
                snap = {"d": today.isoformat(), "m": {m["date"]: [m["up"], m["hold"], m["down"]] for m in ms}}
                hist = [h for h in (doc["hist"] or []) if isinstance(h, dict) and h.get("d") != snap["d"]] + [snap]
                doc["hist"] = sorted(hist, key=lambda h: h["d"])[-45:]      # one snapshot a day, for "a week ago"
            else:
                print("Kalshi: too few meetings, kept the old ones")
        except Exception as e:
            print("Kalshi: unexpected answer:", repr(e))

    text = source("FRED", args[1] if len(args) > 1 else None, FRED + (today - dt.timedelta(days=240)).isoformat())
    if text:
        try:
            obs = fred(text)
            if obs:
                doc["band"], doc["bandAsOf"] = [obs[-1][1], obs[-1][2]], obs[-1][0]
                cal = json.load(open(CAL, encoding="utf-8")).get("schedule", [])
                done = sorted(s["end"] for s in cal if not s.get("noDecision")
                              and dt.datetime.fromisoformat(s["end"] + "T19:30:00+00:00") <= now)
                if done:                        # the new range takes effect the day after the decision
                    end = done[-1]
                    before = [o for o in obs if o[0] <= end]
                    after = [o for o in obs if o[0] > end]
                    move = round((after[-1][2] - before[-1][2]) * 100) if before and after else None
                    doc["last"] = {"date": end, "move": move}
        except Exception as e:
            print("FRED: unexpected answer:", repr(e))

    doc["updated"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if not doc["meetings"] and not doc["band"]:
        print("nothing to write")
        return
    one = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    head = {k: v for k, v in doc.items() if k not in ("meetings", "hist")}
    text = one(head)[:-1] + ',\n"meetings":[\n' + ",\n".join(one(m) for m in doc["meetings"]) + '\n],\n"hist":[\n' + \
        ",\n".join(one(h) for h in doc["hist"] or []) + "\n]}\n"
    json.loads(text)
    open(OUT, "w", encoding="utf-8").write(text)
    print("fed.json: band %s as of %s, last %s, %d meetings, %d daily snapshots" % (doc["band"], doc["bandAsOf"], doc["last"], len(doc["meetings"]), len(doc["hist"] or [])))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:                      # never fail the workflow: stale data hides itself on the site
        print("feed skipped:", repr(e))
