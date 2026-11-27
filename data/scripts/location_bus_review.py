"""입지 2단계: 버스 거리 (교통 › 버스, 2026-11-26). 엔진은 바꾸지 않는다.

지금 식 (scoring_engine BP["버스"]): 정류소 거리 60m 100 · 100m 80 · 150m 60 · 250m 30 (그 뒤 30), 업종 공통.
판정: 구간값 없음(매물 분포 90%가 207m 안이라 잡음), 도보권 끝 부분(버스 도보권 400m 관행·보도, 원문 미확인).

1단계(지하철)와 같은 순서
① 업종마다 정류장 거리 분포가 다른가: 실제 점포 정류장 거리 10분위, 업종 대 나머지 2×10, Cohen w, Holm
② 업종별 점포 선택비 (참고) ③ 매물 라벨 AUC: 지금 점수 vs 점포 선택비 곡선
④ 시장 가치: 헤도닉(연식·지하철과 같은 틀)에 정류장 거리 구간을 넣고 역 거리 구간도 함께 통제
   (버스 정류장 가까운 곳이 역 근처이기도 해서, 역 효과를 빼야 버스만의 효과가 남음)
⑤ 400m 도보권 끝: 매물·점포 중 400m 넘는 비율

출력  09.스코어링/버스거리_보완.json
실행  py -I data/scripts/location_bus_review.py
"""
import csv
import json
import math
import os
import sys
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import building_age_review as bar  # noqa: E402
import classify_use as cu  # noqa: E402
import location_subway_review as ls  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT = os.path.join(se.OUT, "버스거리_보완.json")
BUS_EDGES = [60, 100, 150, 250]          # 지금 식 기준점과 같은 경계
SUB_EDGES = [250, 500, 850]              # 지하철 통제용 (D11에서 850m 뒤 평평)


def stops():
    rows = list(csv.DictReader(open(os.path.join(ls.TP, "대구_버스정류장.csv"), encoding="utf-8-sig")))
    return np.array([[float(r["위도"]), float(r["경도"])] for r in rows])


def nearest_small(lat, lon, pts, chunk=2000):
    R = 6371008.8
    sla, slo = np.radians(pts[:, 0])[None, :], np.radians(pts[:, 1])[None, :]
    best = np.full(len(lat), np.inf)
    for i in range(0, len(lat), chunk):
        la = np.radians(lat[i:i + chunk])[:, None]
        lo = np.radians(lon[i:i + chunk])[:, None]
        a = np.sin((sla - la) / 2) ** 2 + np.cos(la) * np.cos(sla) * np.sin((slo - lo) / 2) ** 2
        best[i:i + chunk] = (2 * R * np.arcsin(np.sqrt(a))).min(1)
    return best


def hedonic_bus(listings, fe_key):
    rows = []
    for L in listings:
        db, ds, area, r = se.num(L["정류소거리_m"]), se.num(L["역거리_m"]), se.num(L["전용면적"]), se.converted_rent(L)
        if db is None or ds is None or not area or not r or r <= 0:
            continue
        rows.append((L, db, ds, area, r, bar.age_of(L)))
    nb, ns = len(BUS_EDGES), len(SUB_EDGES)
    fes = sorted({fe_key(L) for L, *_ in rows})
    fl = ["2층", "3층이상", "지하", None]
    ty = sorted({L["세부유형"] for L, *_ in rows})[1:]
    na = len(bar.LABELS)
    k = {"bus": 0, "sub": nb, "area": nb + ns, "fl": nb + ns + 1, "ty": nb + ns + 1 + len(fl)}
    k["age"] = k["ty"] + len(ty)
    k["fe"] = k["age"] + na
    X = np.zeros((len(rows), k["fe"] + len(fes)))
    y = np.zeros(len(rows))
    cl = []
    for i, (L, db, ds, area, r, a) in enumerate(rows):
        j = int(np.searchsorted(BUS_EDGES, db, side="left"))
        if j:
            X[i, k["bus"] + j - 1] = 1
        j = int(np.searchsorted(SUB_EDGES, ds, side="left"))
        if j:
            X[i, k["sub"] + j - 1] = 1
        X[i, k["area"]] = math.log(area)
        fb = cu.floor_band(L["층"])
        if fb != "1층":
            X[i, k["fl"] + fl.index(fb)] = 1
        if L["세부유형"] in ty:
            X[i, k["ty"] + ty.index(L["세부유형"])] = 1
        if a is None:
            X[i, k["age"] + na - 1] = 1
        else:
            ab = bar.age_bin(a)
            if ab:
                X[i, k["age"] + ab - 1] = 1
        X[i, k["fe"] + fes.index(fe_key(L))] = 1
        y[i] = math.log(r / area)
        cl.append((L["구"], L["법정동"], L["사용승인일"]))
    b, s, r2, G = bar.ols_cluster(X, y, cl)
    labels = ["~60", "60~100", "100~150", "150~250", "250~"]
    cnt = Counter(int(np.searchsorted(BUS_EDGES, db, side="left")) for _, db, *_ in rows)
    med = {j: float(np.median([db for _, db, *_ in rows if int(np.searchsorted(BUS_EDGES, db, side="left")) == j])) for j in range(nb + 1)}
    out = [{"정류장거리": labels[0], "매물": cnt[0], "가운데_m": round(med[0]), "차이_%": 0.0}]
    for j in range(nb):
        out.append({"정류장거리": labels[j + 1], "매물": cnt[j + 1], "가운데_m": round(med[j + 1]), "차이_%": round(100 * (math.exp(b[j]) - 1), 1),
                    "95%_%": [round(100 * (math.exp(b[j] - 1.96 * s[j]) - 1), 1), round(100 * (math.exp(b[j] + 1.96 * s[j]) - 1), 1)]})
    sub = [{"역거리": ["250~500", "500~850", "850~"][j], "차이_%": round(100 * (math.exp(b[nb + j]) - 1), 1)} for j in range(ns)]
    return {"n": len(rows), "건물군집": G, "R2": round(float(r2), 3), "구간": out, "통제_역거리": sub}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cats = se.CATS
    S, src = ls.store_rows()
    lat = np.array([s[0] for s in S])
    lon = np.array([s[1] for s in S])
    lab = np.array([s[2] or "" for s in S], dtype=object)
    d = nearest_small(lat, lon, stops())

    edges = list(np.quantile(d, [i / 10 for i in range(1, 10)]))
    b = ls.bins_of(d, edges)
    tt = ls.test_table(b, lab, 10, cats)
    ps = [ls.chi2_sf_any(tt[c]["chi2"], 9) for c in cats]
    for c, p, ph in zip(cats, ps, ls.holm(ps)):
        tt[c]["p"], tt[c]["Holm_p"] = p, ph
    sr, m, pi, cnt = ls.shrunk_sr(b, lab, 10, cats)
    centers = [float(np.median(d[b == j])) for j in range(10)]
    curves = {c: ls.curve(sr[c], centers) for c in cats}

    listings, ext, bld, use, cfs, cost = we.load()
    ld = {L["매물번호"]: se.num(L["정류소거리_m"]) for L in listings}
    labeled = [L["매물번호"] for L in listings if use[L["매물번호"]]["cats"] and ld[L["매물번호"]] is not None]
    cur = np.array([se.interp(se.BP["버스"], ld[k]) for k in labeled])
    auc = {}
    for c in cats:
        y = np.array([1 if c in use[k]["cats"] else 0 for k in labeled])
        cand = np.array([se.interp(curves[c], ld[k]) for k in labeled])
        auc[c] = {"지금": round(ls.fast_auc(cur, y), 3), "점포선택비": round(ls.fast_auc(cand, y), 3)}

    hed = {"법정동": hedonic_bus(listings, lambda L: (L["구"], L["법정동"])), "구": hedonic_bus(listings, lambda L: L["구"])}
    lv = np.array([v for v in ld.values() if v is not None])
    q = lambda a, p: round(float(np.quantile(a, p)))
    out = {"meta": {"작성": "2026-11-26", "정답지": src + " (약국 제외)", "정류장": "대구BIS·군위 5,963곳 (국토부 버스정류장 위치정보 20261109)",
                    "점포_정류장거리_분위_m": {p: q(d, x) for p, x in (("10%", .1), ("50%", .5), ("90%", .9), ("99%", .99))},
                    "매물_정류장거리_분위_m": {p: q(lv, x) for p, x in (("10%", .1), ("50%", .5), ("90%", .9), ("99%", .99))},
                    "400m_넘는_비율_%": {"점포": round(100 * float((d > 400).mean()), 1), "매물": round(100 * float((lv > 400).mean()), 1)},
                    "10분위_경계_m": [round(x) for x in edges], "m": m},
           "①업종차이": tt, "②선택비_10분위": {c: [round(x, 3) for x in sr[c]] for c in cats},
           "③판별력_매물라벨": auc, "④헤도닉_정류장거리": hed}
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print(json.dumps(out["meta"], ensure_ascii=False))
    for c in cats:
        print(c, tt[c]["n"], "w", tt[c]["w"], "Holm %.1e" % tt[c]["Holm_p"], "·".join("%.2f" % x for x in sr[c]), "| AUC", auc[c]["지금"], "→", auc[c]["점포선택비"])
    for fe, h in hed.items():
        print("헤도닉", fe, "R2", h["R2"], [(g["정류장거리"], g["가운데_m"], g["매물"], g["차이_%"], g.get("95%_%")) for g in h["구간"]], "| 역 통제", h["통제_역거리"])


if __name__ == "__main__":
    sys.exit(main())
