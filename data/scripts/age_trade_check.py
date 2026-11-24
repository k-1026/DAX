"""건물 연식 검증: 매매 실거래가로 연식 곡선 모양 확인 (2026-11-24). 엔진은 바꾸지 않는다.

자료  09.스코어링/검증_실거래/대구_상업업무용_매매_2023_2025.csv (국토부 상업업무용 부동산 매매 신고, fetch_commercial_trade.py)
식    log(거래금액 ÷ 건물면적) = 연식 구간(거래연도 − 건축년도) + 법정동 + 거래연도 + log 건물면적 + 용도지역 + 건물 용도
      집합(구분상가): 층 구간 추가 / 일반(건물 통째): 대지면적 ÷ 건물면적(땅 비중) 추가
제외  해제된 거래, 지분 거래, 건축년도·면적·금액 없음, 연식 < 0
표준오차  같은 건물(구·동·지번·건축년도) 군집 강건
비교  우리 매물 헤도닉(건물연식_보완.json)과 같은 연식 구간
출력  09.스코어링/검증_실거래/연식_실거래_검증.json
"""
import csv
import json
import math
import os
import sys
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scoring_engine as se  # noqa: E402
from building_age_review import LABELS, age_bin, ols_cluster, pava_decreasing  # noqa: E402

SRC = os.path.join(se.OUT, "검증_실거래", "대구_상업업무용_매매_2023_2025.csv")
OUT = os.path.join(se.OUT, "검증_실거래", "연식_실거래_검증.json")


def num(s):
    try:
        return float(str(s).replace(",", ""))
    except ValueError:
        return None


def fband(s):
    f = num(s)
    if f is None:
        return "없음"
    return "지하" if f < 0 else "1층" if f == 1 else "2층" if f == 2 else "3층이상"


def fit(rows, kind):
    cats = {"동": sorted({(r["sggNm"], r["umdNm"]) for r in rows}), "연도": sorted({r["dealYear"] for r in rows}),
            "용도지역": sorted({r["landUse"] for r in rows}), "용도": sorted({r["buildingUse"] for r in rows})}
    if kind == "집합":
        cats["층"] = ["1층", "2층", "3층이상", "지하", "없음"]
    k = len(LABELS) - 1
    cols = k + 1 + (1 if kind == "일반" else 0)
    offs = {}
    for name, lv in cats.items():
        offs[name] = cols
        cols += len(lv) - (0 if name == "동" else 1)
    X = np.zeros((len(rows), cols))
    y = np.zeros(len(rows))
    cl = []
    for i, r in enumerate(rows):
        j = age_bin(r["_age"])
        if j:
            X[i, j - 1] = 1
        X[i, k] = math.log(r["_ar"])
        if kind == "일반":
            X[i, k + 1] = math.log(r["_land"] / r["_ar"])
        vals = {"동": (r["sggNm"], r["umdNm"]), "연도": r["dealYear"], "용도지역": r["landUse"], "용도": r["buildingUse"]}
        if kind == "집합":
            vals["층"] = fband(r["floor"])
        for name, lv in cats.items():
            idx = lv.index(vals[name])
            if name == "동":
                X[i, offs[name] + idx] = 1
            elif idx:
                X[i, offs[name] + idx - 1] = 1
        y[i] = math.log(r["_amt"] / r["_ar"])
        cl.append((r["sggNm"], r["umdNm"], r["jibun"], r["buildYear"]))
    b, s, r2, G = ols_cluster(X, y, cl)
    n_bin = Counter(age_bin(r["_age"]) for r in rows)
    coef = [0.0] + [float(x) for x in b[:k]]
    ses = [0.0] + [float(x) for x in s[:k]]
    mono = pava_decreasing(coef, [n_bin[j] for j in range(len(LABELS))])
    mx = max(math.exp(c) for c in mono)
    return {"n": len(rows), "건물군집": G, "R2": round(float(r2), 3),
            "구간": [{"연식": LABELS[j], "거래": n_bin[j], "가격차이_%": round(100 * (math.exp(coef[j]) - 1), 1),
                    "95%구간_%": [round(100 * (math.exp(coef[j] - 1.96 * ses[j]) - 1), 1), round(100 * (math.exp(coef[j] + 1.96 * ses[j]) - 1), 1)] if j else None}
                   for j in range(len(LABELS))],
            "점수_단조": [round(100 * math.exp(c) / mx) for c in mono]}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    raw = list(csv.DictReader(open(SRC, encoding="utf-8-sig", newline="")))
    drop = Counter()
    rows = []
    for r in raw:
        if r.get("cdealType", "").strip():
            drop["해제"] += 1
            continue
        if r.get("shareDealingType", "").strip():
            drop["지분"] += 1
            continue
        by, dy, ar, amt = num(r["buildYear"]), num(r["dealYear"]), num(r["buildingAr"]), num(r["dealAmount"])
        if not by or not dy or not ar or not amt or ar <= 0:
            drop["값없음"] += 1
            continue
        if dy - by < 0:
            drop["연식음수"] += 1
            continue
        r["_age"], r["_ar"], r["_amt"] = dy - by, ar, amt
        r["_land"] = num(r.get("plottageAr"))
        rows.append(r)
    res = {"meta": {"원자료": len(raw), "제외": dict(drop), "사용": len(rows), "유형": dict(Counter(r["buildingType"] for r in rows))}}
    jip = [r for r in rows if r["buildingType"] == "집합"]
    il = [r for r in rows if r["buildingType"] == "일반" and r["_land"]]
    res["집합"] = fit(jip, "집합")
    res["일반"] = fit(il, "일반")
    mine = json.load(open(os.path.join(se.OUT, "건물연식_보완.json"), encoding="utf-8"))
    res["우리매물"] = {"구간": [{"연식": b["연식"], "매물": b["매물"], "임대료차이_%": b["임대료차이_%"]} for b in mine["①헤도닉_기본(동·환산)"]["구간"]],
                    "점수_단조": mine["③점수"]["후보_단조"]}
    json.dump(res, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print("작성:", OUT)
    print(res["meta"])
    for kind in ("집합", "일반"):
        f = res[kind]
        print(f"\n{kind} n={f['n']} 건물={f['건물군집']} R2={f['R2']}")
        print(" | ".join(f"{b['연식']}: {b['가격차이_%']}% {b['95%구간_%'] or ''} ({b['거래']})" for b in f["구간"]))
        print("점수", f["점수_단조"])
    print("\n우리 매물 점수", res["우리매물"]["점수_단조"])


if __name__ == "__main__":
    sys.exit(main())
