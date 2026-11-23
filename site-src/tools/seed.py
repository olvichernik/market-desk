"""Builds the site's history.json from the daily series downloaded from Bitbo (realized price chart)."""
import json, sys, datetime as dt, bisect
src, out = sys.argv[1], sys.argv[2]
rows = json.load(open(src, encoding='utf-8'))
R = [(dt.date.fromisoformat(r["Date"]), float(r["Price"]), float(r["Realized Price"])) for r in rows]
assert all((b[0] - a[0]).days == 1 for a, b in zip(R, R[1:])), 'gaps'
end = R[-1][0]
def sig(x, n=5):
    if x == 0: return 0
    from math import log10, floor
    d = n - 1 - floor(log10(abs(x)))
    v = round(x, max(0, d))
    return int(v) if d <= 0 else v
# weekly points that end exactly on the last day
wk = [r for r in R if (end - r[0]).days % 7 == 0]
# past cycles: the peak and the lowest day after it
def window(a, b): return [r for r in R if a <= r[0] <= b]
cyc = []
for name, a, b in [("2013", dt.date(2013, 6, 1), dt.date(2015, 12, 31)), ("2017", dt.date(2016, 6, 1), dt.date(2019, 12, 31)), ("2021", dt.date(2020, 6, 1), dt.date(2023, 6, 30))]:
    w = window(a, b); pk = max(w, key=lambda r: r[1]); lo = min([r for r in w if r[0] >= pk[0]], key=lambda r: r[1])
    cyc.append({"name": name, "peak": pk[0].isoformat(), "peakPx": round(pk[1]), "low": lo[0].isoformat(), "lowPx": round(lo[1]), "days": (lo[0] - pk[0]).days,
                "dd": round((lo[1] / pk[1] - 1) * 100, 1), "lowR": round(lo[1] / lo[2], 2)})
w = window(dt.date(2024, 1, 1), end); pk = max(w, key=lambda r: r[1]); lo = min([r for r in w if r[0] >= pk[0]], key=lambda r: r[1])
cur = {"peak": pk[0].isoformat(), "peakPx": round(pk[1]), "low": lo[0].isoformat(), "lowPx": round(lo[1]), "lowR": round(lo[1] / lo[2], 2)}
# periods with the price under the realized price
per, c = [], None
for d, p, r in R:
    m = p / r
    if m < 1:
        if c is None: c = [d, d, m, 1]
        else: c[1] = d; c[2] = min(c[2], m); c[3] += 1
    elif c is not None: per.append(c); c = None
if c: per.append(c)
merged = []
for p in per:
    if merged and (p[0] - merged[-1][1]).days < 45:
        m = merged[-1]; m[1] = p[1]; m[2] = min(m[2], p[2]); m[3] += p[3]
    else: merged.append(list(p))
below = [{"from": m[0].isoformat(), "to": m[1].isoformat(), "days": m[3], "min": round(m[2], 2)} for m in merged if m[3] >= 5]
nb = sum(1 for d, p, r in R if p < r)
last_below = max(d for d, p, r in R if p < r)
# distributions, as 101 quantiles each
def quant(xs):
    xs = sorted(xs); n = len(xs)
    return [round(xs[min(n - 1, round(i / 100 * (n - 1)))], 3) for i in range(101)]
mv = [p / r for d, p, r in R]
c = [p for d, p, r in R]
mayer = [c[i] / (sum(c[i - 199:i + 1]) / 200) for i in range(199, len(c))]
wc = [p for d, p, r in wk]
w200 = [wc[i] / (sum(wc[i - 199:i + 1]) / 200) for i in range(199, len(wc))]
doc = {"src": "Bitbo", "srcUrl": "https://charts.bitbo.io/", "start": wk[0][0].isoformat(), "end": end.isoformat(), "step": 7, "days": len(R),
       "price": [sig(p) for d, p, r in wk], "realized": [sig(r) for d, p, r in wk],
       "cycles": cyc, "cur": cur, "below": below, "belowShare": round(100 * nb / len(R), 1), "lastBelow": last_below.isoformat(),
       "qMvrv": quant(mv), "qMayer": quant(mayer), "q200w": quant(w200)}
one = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
text = "{\n" + ",\n".join('"%s":%s' % (k, one(v)) for k, v in doc.items()) + "\n}\n"
json.loads(text)
open(out, "w", encoding="utf-8").write(text)
print(len(text), 'bytes;', len(wk), 'weekly points', wk[0][0], '..', wk[-1][0], '| last', doc["price"][-1], doc["realized"][-1])
print(cyc); print(cur); print(below, doc["belowShare"], doc["lastBelow"])
print('mvrv q10/50/90', doc["qMvrv"][10], doc["qMvrv"][50], doc["qMvrv"][90], '| mayer', doc["qMayer"][10], doc["qMayer"][50], doc["qMayer"][90], '| 200w', doc["q200w"][0], doc["q200w"][10], doc["q200w"][50], 'n', len(w200), 'now', round(w200[-1], 3))
