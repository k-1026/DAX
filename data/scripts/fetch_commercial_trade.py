"""국토교통부 상업업무용 부동산 매매 신고 자료 (대구 9개 구·군, 2023-01 ~ 2025-12) 내려받기.
출력  data/09.스코어링/검증_실거래/대구_상업업무용_매매_2023_2025.csv
실행  py -I data/scripts/fetch_commercial_trade.py
"""
import csv
import os
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "09.스코어링", "검증_실거래")
OUT = os.path.join(OUT_DIR, "대구_상업업무용_매매_2023_2025.csv")
URL = "https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade"
SGG = {"27110": "중구", "27140": "동구", "27170": "서구", "27200": "남구", "27230": "북구",
       "27260": "수성구", "27290": "달서구", "27710": "달성군", "27720": "군위군"}


def key():
    for line in open(os.path.join(BASE, ".env"), encoding="utf-8"):
        if line.startswith("BLD_API_KEY="):
            return line.strip().split("=", 1)[1]


def fetch(k, sgg, ym, page):
    q = urllib.parse.urlencode({"serviceKey": k, "LAWD_CD": sgg, "DEAL_YMD": ym, "numOfRows": "1000", "pageNo": str(page)})
    for t in range(4):
        try:
            return ET.fromstring(urllib.request.urlopen(URL + "?" + q, timeout=60).read())
        except Exception as e:  # noqa: BLE001
            err = str(e).replace(k, "<key>")
            time.sleep(2 * (t + 1))
    raise RuntimeError(f"{sgg} {ym} p{page}: {err}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT_DIR, exist_ok=True)
    k = key()
    rows, cols = [], []
    for sgg in SGG:
        for y in (2023, 2024, 2025):
            for m in range(1, 13):
                ym = f"{y}{m:02d}"
                page = 1
                while True:
                    root = fetch(k, sgg, ym, page)
                    code = root.findtext("header/resultCode")
                    if code not in ("000", "00"):
                        raise RuntimeError(f"{sgg} {ym}: {code} {root.findtext('header/resultMsg')}")
                    items = root.findall("body/items/item")
                    for it in items:
                        r = {c.tag: (c.text or "").strip() for c in it}
                        for c in r:
                            if c not in cols:
                                cols.append(c)
                        rows.append(r)
                    total = int(root.findtext("body/totalCount") or 0)
                    if page * 1000 >= total:
                        break
                    page += 1
            print(SGG[sgg], "누적", len(rows), flush=True)
    with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print("작성:", OUT, len(rows), "건")


if __name__ == "__main__":
    sys.exit(main())
