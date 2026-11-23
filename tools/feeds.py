#!/usr/bin/env python3
"""Refreshes the data files the site cannot fetch from a browser.

Runs from GitHub Actions on a schedule; no secrets, no dependencies, nobody's computer.

fed.json: the Fed's current target range and market odds for each coming meeting
  - odds per meeting: Kalshi's public market-data API (series KXFEDDECISION: hike, hold, cut)
  - current target range: FRED series DFEDTARL / DFEDTARU (the Fed's own numbers)
  - meeting calendar: fed-calendar.json in this repository
levels.json: on-chain price levels for bitcoin (realized price, balanced price)
  - the free daily charts of Bitbo (charts.bitbo.io), read a few times a day
  - if Bitbo is unreachable, the realized price from BGeometrics' free API (it can lag by a week)

Each source is optional: if one is unreachable or looks wrong, the previous values for that part are
kept, and the site hides numbers that have not been refreshed for several days.
"""
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import urllib.request

KALSHI = "https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXFEDDECISION&status=open&with_nested_markets=true&limit=50"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARL,DFEDTARU&cosd="
OUT, CAL, LEVELS = "fed.json", "fed-calendar.json", "levels.json"
BITBO = "https://charts.bitbo.io/"
BITBO_LEVELS = (("realized", "realized-price", "realized_price"), ("balanced", "balanced-price", "balanced"))   # key, page, variable on the page
BG_REALIZED = "https://bitcoin-data.com/v1/realized-price/last"
UA = "market-desk feed (+https://github.com/olvichernik/market-desk)"
LEG = {"H0": "hold", "H25": "up25", "H26": "upBig", "C25": "down25", "C26": "downBig"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/csv;q=0.9, */*;q=0.5"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


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


def bitbo_last(html, var):
    """The chart pages carry their daily series as JavaScript arrays: the dates in axis_x, the values in a named one."""
    def arr(name):
        m = re.search(r"var\s+" + re.escape(name) + r"\s*=\s*\[([^\]]*)\]", html)
        return [x.strip() for x in m.group(1).split(",")] if m else None
    xs, ys = arr("axis_x"), arr(var)
    if not xs or not ys or len(xs) != len(ys) or len(xs) < 1000:
        raise ValueError("series %s not found" % var)
    day, v = xs[-1].strip("\"'"), num(ys[-1])
    dt.date.fromisoformat(day)
    if v is None or not 1000 < v < 10_000_000:
        raise ValueError("odd value %r" % ys[-1])
    return day, round(v, 2)


def levels(now, sample=None):
    """Realized and balanced price, each with the date of its own last value."""
    try:
        old = json.load(open(LEVELS, encoding="utf-8"))
    except Exception:
        old = {}
    try:
        age = (now - dt.datetime.fromisoformat(str(old.get("updated")).replace("Z", "+00:00"))).total_seconds()
    except ValueError:
        age = 1e9
    if age < 5 * 3600 and not sample and os.environ.get("FORCE_LEVELS") != "true":
        print("levels.json is fresh")
        return
    have, got = {}, 0
    for key, page, var in BITBO_LEVELS:
        try:
            html = open(sample[key], encoding="utf-8").read() if sample else get(BITBO + page + "/")
            day, v = bitbo_last(html, var)
            have[key] = {"key": key, "value": v, "asOf": day, "src": "Bitbo", "url": BITBO + page + "/"}
            got += 1
        except Exception as e:
            print("Bitbo", key, "unavailable:", repr(e))
    if "realized" not in have and not sample:
        try:
            j = json.loads(get(BG_REALIZED))
            v, day = num(j.get("realizedPrice")), str(j.get("d") or "")
            dt.date.fromisoformat(day)
            if v is not None and 1000 < v < 10_000_000:
                have["realized"] = {"key": "realized", "value": round(v, 2), "asOf": day, "src": "BGeometrics", "url": "https://bitcoin-data.com/"}
                got += 1
        except Exception as e:
            print("BGeometrics realized unavailable:", repr(e))
    if not got:
        return
    doc = {"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "levels": [have[k] for k, _, _ in BITBO_LEVELS if k in have]}
    open(LEVELS, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")
    print("levels.json:", ", ".join("%s %s (%s, %s)" % (l["key"], l["value"], l["asOf"], l["src"]) for l in doc["levels"]))


def main():
    args = sys.argv[1:]                       # local test: feeds.py kalshi.json fred.csv [realized.html balanced.html]
    try:
        levels(dt.datetime.now(dt.timezone.utc), {"realized": args[2], "balanced": args[3]} if len(args) > 3 else None)
    except Exception as e:
        print("levels skipped:", repr(e))
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date()
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        old = {}
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
