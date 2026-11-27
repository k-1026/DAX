"""대구 도시철도역·버스정류장 좌표 추출과 매물 거리 기준점 확인 (입지 1단계 준비, 2026-11-26). 엔진은 바꾸지 않는다.

입력 (무료·공공, 이용허락범위 제한 없음, 2026-11-26 내려받음)
  data/08.외부데이터/08_교통좌표/전체_도시철도역사정보_20260630.xlsx
      국가철도공단 도시광역철도 역사정보 표준데이터 (레일포털 data.kric.go.kr, 공공데이터포털 15013205)
  data/08.외부데이터/08_교통좌표/국토교통부_전국 버스정류장 위치정보_20261109.csv (공공데이터포털 15067528, cp949)
출력
  data/08.외부데이터/08_교통좌표/대구_도시철도역.csv   역 이름·노선·좌표 (환승역은 노선마다 한 줄)
  data/08.외부데이터/08_교통좌표/대구_버스정류장.csv   대구BIS·군위(TSBIS) 정류장
  data/09.스코어링/교통거리_기준점확인.json             매물 파일의 역거리·정류소거리를 새 좌표로 다시 잰 비교
실행  py -I data/scripts/transit_points.py
"""
import csv
import json
import math
import os
import sys

import openpyxl

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
D = os.path.join(ROOT, "data", "08.외부데이터", "08_교통좌표")
OUT = os.path.join(ROOT, "data", "09.스코어링")
LISTING_CSV = os.path.join(ROOT, "data", "07.대구_매물유형별_csv", "대구_구역별_매물 (최종).csv")
STATION_XLSX = os.path.join(D, "전체_도시철도역사정보_20260630.xlsx")
BUS_CSV = os.path.join(D, "국토교통부_전국 버스정류장 위치정보_20261109.csv")
# 대구 시 경계를 넉넉히 감싸는 상자 (군위 포함). 광역철도(대경선) 역 중 대구 밖(구미·경산 등)을 거른다
BBOX = (35.55, 36.35, 128.30, 128.80)
DAEGU_ADDR = ("대구", "달성군", "달서구", "수성구", "북구", "동구", "서구", "남구", "중구", "군위군")


def hav(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def in_box(lat, lon):
    return BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lon <= BBOX[3]


def load_stations():
    ws = openpyxl.load_workbook(STATION_XLSX, read_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    h = {k: i for i, k in enumerate(rows[0])}
    out = []
    for r in rows[1:]:
        org, lat, lon = r[h["운영기관명"]], r[h["역위도"]], r[h["역경도"]]
        if lat is None or lon is None:
            continue
        lat, lon = float(lat), float(lon)
        if org == "대구교통공사" or (org == "한국철도공사" and in_box(lat, lon) and "대경" in str(r[h["노선명"]])):
            out.append({"역번호": r[h["역번호"]], "역사명": r[h["역사명"]], "노선명": r[h["노선명"]], "운영기관명": org,
                        "위도": lat, "경도": lon, "주소": r[h["역사도로명주소"]] or ""})
    return out


def load_stops():
    out = []
    with open(BUS_CSV, encoding="cp949", newline="") as f:
        for r in csv.DictReader(f):
            if r["관리도시명"] in ("대구BIS", "TSBIS") and r["도시명"].startswith("대구광역시"):
                out.append({"정류장번호": r["정류장번호"], "정류장명": r["정류장명"], "위도": float(r["위도"]), "경도": float(r["경도"]),
                            "도시명": r["도시명"], "관리도시명": r["관리도시명"]})
    return out


def nearest(lat, lon, pts):
    best = None
    for p in pts:
        if abs(p["위도"] - lat) > 0.05 or abs(p["경도"] - lon) > 0.06:
            continue
        d = hav(lat, lon, p["위도"], p["경도"])
        if best is None or d < best[0]:
            best = (d, p)
    return best


def summarize(diffs):
    s = sorted(diffs)
    q = lambda p: round(s[int((len(s) - 1) * p)], 1)
    return {"n": len(s), "차이_중앙값_m": q(.5), "차이_10%": q(.1), "차이_90%": q(.9),
            "절대차_중앙값_m": round(sorted(abs(x) for x in s)[len(s) // 2], 1),
            "50m_안": round(100 * sum(1 for x in s if abs(x) <= 50) / len(s), 1),
            "100m_안": round(100 * sum(1 for x in s if abs(x) <= 100) / len(s), 1)}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    st, bs = load_stations(), load_stops()
    for name, rows in (("대구_도시철도역.csv", st), ("대구_버스정류장.csv", bs)):
        with open(os.path.join(D, name), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    print("역", len(st), "줄 (", len({(s["역사명"]) for s in st}), "개 역 이름) | 정류장", len(bs))

    listings = list(csv.DictReader(open(LISTING_CSV, encoding="utf-8-sig", newline="")))
    ds, db, far = [], [], []
    for L in listings:
        try:
            lat, lon = float(L["위도"]), float(L["경도"])
        except ValueError:
            continue
        for col, pts, acc in (("역거리_m", st, ds), ("정류소거리_m", bs, db)):
            try:
                given = float(L[col])
            except ValueError:
                continue
            nb = nearest(lat, lon, pts)
            if nb:
                acc.append(nb[0] - given)
                if col == "역거리_m" and abs(nb[0] - given) > 300:
                    far.append({"매물번호": L["매물번호"], "구": L["구"], "법정동": L["법정동"], "매물값": given, "새좌표": round(nb[0]), "가까운역": nb[1]["역사명"]})
    res = {"역": {"자료": "국가철도공단 역사정보 표준데이터 역 좌표(1점)", **summarize(ds)},
           "정류장": {"자료": "국토부 버스정류장 위치정보 대구BIS·TSBIS", **summarize(db)},
           "역_300m넘게_다른_매물": len(far), "역_다른_예": far[:15],
           "읽는법": "차이 = 새 좌표로 잰 가장 가까운 거리 − 매물 파일 값. 0에 가까우면 매물 파일도 역 좌표(1점) 기준, 음수가 크면 매물 값이 더 멂"}
    json.dump(res, open(os.path.join(OUT, "교통거리_기준점확인.json"), "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "역_다른_예"}, ensure_ascii=False, indent=1))
    for x in far[:8]:
        print(x)


if __name__ == "__main__":
    sys.exit(main())
