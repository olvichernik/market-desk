#!/usr/bin/env python3
"""Refreshes fed.json: what interest-rate futures price in for each Fed meeting.

Runs from GitHub Actions on a schedule, with no secrets and no dependencies.
Source: RateProbability (https://rateprobability.com/fed), which computes the
rate path from futures prices the same way CME FedWatch does, once a day.

The meeting calendar already in fed.json is kept; meetings the source knows
about and the calendar does not are appended. If the source is unreachable or
returns something unexpected, the file is left untouched: the site hides the
market numbers by itself once they are too old.
"""
import datetime as dt
import json
import sys
import urllib.request

SRC = "https://rateprobability.com/api/latest"
PAGE = "https://rateprobability.com/fed"
OUT = "fed.json"
UA = "Mozilla/5.0 (compatible; market-desk; +https://olvichernik.github.io/market-desk/)"


def fetch(arg):
    if arg:                                    # local test: python3 tools/feeds.py sample.json
        return json.load(open(arg, encoding="utf-8"))
    req = urllib.request.Request(SRC, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def is_date(v):
    try:
        dt.date.fromisoformat(v)
        return isinstance(v, str) and len(v) == 10
    except Exception:
        return False


def band(text):
    lo, hi = [float(x) for x in str(text).replace("–", "-").split("-")]
    if not (0 <= lo < hi <= 20 and abs(hi - lo - 0.25) < 1e-6):
        raise ValueError("unexpected band %r" % text)
    return [lo, hi]


def meetings(rows):
    out = []
    for r in rows or []:
        d, rate = r.get("meeting_iso"), r.get("implied_rate_post_meeting")
        if not is_date(d) or not isinstance(rate, (int, float)) or not 0 <= rate <= 20:
            continue
        num = lambda k: float(r[k]) if isinstance(r.get(k), (int, float)) else None
        out.append({"date": d, "rate": round(float(rate), 3), "bps": num("change_bps"), "prob": num("prob_move_pct"),
                    "cut": bool(r.get("prob_is_cut")), "moves": num("num_moves")})
    return sorted(out, key=lambda m: m["date"])


def main():
    src = fetch(sys.argv[1] if len(sys.argv) > 1 else None)
    today = src["today"]
    now = dt.datetime.now(dt.timezone.utc)
    cur = band(today["current band"])
    rows = meetings(today.get("rows"))
    if len(rows) < 3 or not is_date(today.get("as_of")):
        raise ValueError("source returned too little: %d meetings" % len(rows))

    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        old = {}
    schedule = [s for s in old.get("schedule", []) if isinstance(s, dict) and is_date(s.get("start")) and is_date(s.get("end"))]
    known = {s["end"] for s in schedule}
    for m in rows:                              # the source looks further ahead than the stored calendar
        if m["date"] not in known and m["date"] > now.date().isoformat():
            d = dt.date.fromisoformat(m["date"])
            schedule.append({"start": (d - dt.timedelta(days=1)).isoformat(), "end": m["date"], "auto": True})
    schedule.sort(key=lambda s: s["end"])
    horizon = (now.date() - dt.timedelta(days=120)).isoformat()
    schedule = [s for s in schedule if s["end"] >= horizon]

    # the last decision: the most recent meeting whose announcement (19:00 UTC at the earliest) has passed
    passed = [s["end"] for s in schedule if not s.get("noDecision")
              and dt.datetime.fromisoformat(s["end"] + "T19:30:00+00:00") <= now]
    last = old.get("last") if isinstance(old.get("last"), dict) and is_date(old["last"].get("date")) else None
    old_cur = old.get("band") or old.get("current")
    diff = round((cur[0] - old_cur[0]) * 100) if isinstance(old_cur, list) and old_cur else 0
    if passed and (last is None or passed[-1] > last["date"]):
        last = {"date": passed[-1], "move": diff}
    elif diff:
        recent = last and (now.date() - dt.date.fromisoformat(last["date"])).days <= 4
        last = {"date": last["date"], "move": int(last.get("move") or 0) + diff} if recent else {"date": now.date().isoformat(), "move": diff}

    ago = []
    for key, label in (("ago_1w", "1w"), ("ago_3w", "3w"), ("ago_6w", "6w"), ("ago_10w", "10w")):
        a = src.get(key) or {}
        ms = meetings(a.get("rows"))
        if ms and is_date(a.get("used_date")):
            ago.append({"label": label, "date": a["used_date"], "meetings": ms})

    num = lambda v: round(float(v), 3) if isinstance(v, (int, float)) else None
    doc = {"v": 2, "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "asOf": today["as_of"],
           "source": "RateProbability", "sourceUrl": PAGE,
           "band": cur, "midpoint": num(today.get("midpoint")), "effr": num(today.get("most_recent_effr")),
           "last": last, "meetings": rows, "ago": ago, "schedule": schedule,
           "scheduleSource": old.get("scheduleSource") or "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"}

    same = {k: v for k, v in old.items() if k != "updated"} == {k: v for k, v in doc.items() if k != "updated"}
    stale = True
    try:
        stale = (now - dt.datetime.fromisoformat(str(old.get("updated")).replace("Z", "+00:00"))).total_seconds() > 20 * 3600
    except Exception:
        pass
    if same and not stale:                      # nothing new and the stamp is fresh enough: no commit
        print("no change, as of", today["as_of"])
        return
    one = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    head = {k: v for k, v in doc.items() if k not in ("meetings", "ago", "schedule", "scheduleSource")}
    text = one(head)[:-1] + ',\n"meetings":[\n' + ",\n".join(one(m) for m in doc["meetings"]) + '\n],\n"ago":[\n' + \
        ",\n".join(one(a) for a in doc["ago"]) + '\n],\n"schedule":[\n' + ",\n".join(one(s) for s in doc["schedule"]) + \
        '\n],\n"scheduleSource":' + one(doc["scheduleSource"]) + "}\n"
    json.loads(text)
    open(OUT, "w", encoding="utf-8").write(text)
    print("fed.json updated: as of %s, band %s, %d meetings, %d snapshots" % (today["as_of"], cur, len(rows), len(ago)))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:                      # never fail the workflow: stale data hides itself on the site
        print("fed feed skipped:", repr(e))
