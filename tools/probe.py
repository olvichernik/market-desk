#!/usr/bin/env python3
"""Throwaway: shows what the candidate sources answer from a GitHub runner."""
import json, sys, urllib.request, urllib.parse

UA = "market-desk feed (+https://github.com/olvichernik/market-desk)"
BR = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

def get(url, ua=UA, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/json, text/csv;q=0.9, */*;q=0.5"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers.get("content-type"), r.read().decode("utf-8", "replace")

def show(name, url, ua=UA, head=500, tail=700):
    print("=" * 8, name)
    print(url)
    try:
        st, ct, body = get(url, ua)
        print("status", st, "| type", ct, "| bytes", len(body), "| lines", body.count("\n"))
        print("HEAD:", body[:head])
        if len(body) > head:
            print("TAIL:", body[-tail:])
        return body
    except Exception as e:
        print("FAILED:", repr(e))
        try:
            print("BODY:", e.read().decode("utf-8", "replace")[:600])
        except Exception:
            pass
        return None

F = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=%s"
show("fred us", F % ("WALCL,WTREGEN,WDTGAL,RRPONTSYD,WM2NS,M2SL", "2026-08-01"))
show("fred intl", F % ("ECBASSETSW,JPNASSETS,DEXUSEU,DEXJPUS,DEXCHUS,DEXUSUK", "2026-08-01"))
show("fred long", F % ("WALCL", "2013-01-01"), head=200, tail=200)
show("ecb m2", "https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M20.X.1.U2.2300.Z01.E?format=csvdata&startPeriod=2026-01&detail=dataonly")
show("ecb fx", "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY+CNY.EUR.SP00.A?format=csvdata&startPeriod=2026-11-01&detail=dataonly")
em = "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_CURRENCY_SUPPLY&columns=ALL&pageNumber=1&pageSize=500&sortTypes=-1&sortColumns=REPORT_DATE&source=WEB&client=WEB"
b = show("eastmoney ua=feed", em, head=900, tail=400)
if not b:
    b = show("eastmoney ua=browser", em, BR, head=900, tail=400)
try:
    rows = json.loads(b)["result"]["data"]
    print("eastmoney rows", len(rows), "first", rows[0], "last", rows[-1])
except Exception as e:
    print("eastmoney parse:", repr(e))
show("dbnomics cn m2", "https://api.db.nomics.world/v22/series/NBS/M_A0D01/A0D0101?observations=1", head=300, tail=900)
B = "https://www.stat-search.boj.or.jp/api/v1/"
show("boj code", B + "getDataCode?format=json&lang=en&db=MD02&code=MAM1NAM2M2MO&startDate=202601", head=1500, tail=600)
show("boj code alt", B + "getDataCode?format=json&lang=EN&db=MD02&code=MAM1NAM2M2MO&startDate=202601&endDate=202612", head=800, tail=300)
m = show("boj meta", B + "getMetadata?format=json&lang=en&db=MD02", head=1200, tail=300)
if m:
    try:
        j = json.loads(m)
        def walk(o, depth=0):
            if isinstance(o, dict):
                txt = json.dumps(o, ensure_ascii=False)
                if len(txt) < 600 and ("M2" in txt) and ("SERIES_CODE" in txt or "code" in txt.lower()):
                    print("  M2?", txt[:500])
                for v in o.values():
                    walk(v, depth + 1)
            elif isinstance(o, list):
                for v in o:
                    walk(v, depth + 1)
        walk(j)
    except Exception as e:
        print("boj meta parse:", repr(e))
show("boj assets", B + "getMetadata?format=json&lang=en&db=BS01", head=600, tail=200)
show("llama stables", "https://stablecoins.llama.fi/stablecoincharts/all", head=250, tail=250)
