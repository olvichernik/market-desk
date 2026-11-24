#!/usr/bin/env python3
"""Throwaway: saves the raw answers of the liquidity sources, to build and test the feed against."""
import os, time, urllib.request

UA = "market-desk feed (+https://github.com/olvichernik/market-desk)"
os.makedirs("samples", exist_ok=True)

def save(name, url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/csv;q=0.9, */*;q=0.5"})
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
        open(os.path.join("samples", name), "wb").write(body)
        print(name, len(body), "bytes |", body[-90:].decode("utf-8", "replace").replace("\n", " / "))
    except Exception as e:
        print(name, "FAILED", repr(e))
    time.sleep(0.6)

for s in ("WALCL", "WTREGEN", "RRPONTSYD", "WM2NS", "M2SL", "ECBASSETSW", "JPNASSETS"):
    save("fred-%s.csv" % s, "https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s&cosd=2012-01-01" % s)
save("ecb-m2.csv", "https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M20.X.1.U2.2300.Z01.E?format=csvdata&startPeriod=2012-01&detail=dataonly")
save("ecb-fx.csv", "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY+CNY.EUR.SP00.A?format=csvdata&startPeriod=2012-01-01&detail=dataonly")
save("cn-m2.json", "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_CURRENCY_SUPPLY&columns=ALL&pageNumber=1&pageSize=500&sortTypes=-1&sortColumns=REPORT_DATE&source=WEB&client=WEB")
save("boj-m2.json", "https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=json&lang=en&db=MD02&code=MAM1NAM2M2MO&startDate=201201")
save("stables.json", "https://stablecoins.llama.fi/stablecoincharts/all")
