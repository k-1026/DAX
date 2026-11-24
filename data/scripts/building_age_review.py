"""건물 연식 보완 (공간 › 건물 연식, 2026-11-24). 엔진은 바꾸지 않는다.

지금 방식 (scoring_engine.BP["건물연식"])
  - 경과연수(사용승인일 → 2026-11-10) 5년 100 · 10년 85 · 20년 65 · 30년 45 · 40년 30, 사이 선형 보간, 40년 넘으면 30
  - 판정: 오래될수록 낮음(방향) "부분", 40년에서 최저 "부분", 연도별 점수값 "없음"

이 스크립트
  ① 방향·크기: 헤도닉 회귀로 "같은 동·층·면적·상가 유형이면 연식에 따라 임대료가 얼마나 다른가"
       log(환산 월임대료 ÷ 전용면적) = 연식 구간 + 법정동 + 층 구간 + log 면적 + 세부유형
       환산 월임대료 = 월세 + 보증금 × 1% (비용 인자와 같은 정의)
       표준오차: 같은 건물(구·법정동·사용승인일이 같은 매물)끼리 묶은 군집 강건 표준오차
       강건성: 법정동 대신 구 고정효과, 월세만 쓴 경우
  ② 40년 최저: 40년 넘는 구간(40~45, 45~50, 50년 이상)에서 계수가 더 내려가는지
  ③ 점수 후보: 시장이 매기는 연식 가치 = exp(계수). 점수 = 100 × exp(계수) ÷ 최대 exp(계수) (층 (나)와 같은 최댓값 대비 비율)
       계수가 단조 감소가 아니면 매물 수 가중 단조 회귀(PAVA)로 고친 값도 기록
  ④ 업종마다 다른가: 연식 5분위로 업종 대 나머지 2×5 독립성 카이제곱, Cohen w, Holm (층·면적과 같은 방식)
  ⑤ 총점 영향: 건물 연식 점수만 바꿔 순위 비교

출력  data/09.스코어링/건물연식_보완.json
실행  py -I data/scripts/building_age_review.py
"""
import json
import math
import os
import sys
from collections import Counter
from datetime import date
from statistics import median

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classify_use as cu  # noqa: E402
import scoring_engine as se  # noqa: E402
import factor_sensitivity as fs  # noqa: E402
import weight_estimation as we  # noqa: E402
from area_fit_review import chi2_sf, groups_of, qcuts, bin_of  # noqa: E402

OUT_JSON = os.path.join(se.OUT, "건물연식_보완.json")
EDGES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]          # 0~5 기준, 50년 이상 마지막
LABELS = ["0~5"] + [f"{a}~{b}" for a, b in zip(EDGES, EDGES[1:])] + ["50~"]


def age_of(L):
    try:
        return (se.TODAY - date.fromisoformat(L["사용승인일"])).days / 365.25
    except ValueError:
        return None


def age_bin(a):
    for i, e in enumerate(EDGES):
        if a < e:
            return i
    return len(EDGES)


def ols_cluster(X, y, cl):
    XtX_inv = np.linalg.pinv(X.T @ X)
    b = XtX_inv @ X.T @ y
    u = y - X @ b
    meat = np.zeros((X.shape[1], X.shape[1]))
    groups = {}
    for i, g in enumerate(cl):
        groups.setdefault(g, []).append(i)
    for idx in groups.values():
        s = X[idx].T @ u[idx]
        meat += np.outer(s, s)
    G, n, k = len(groups), len(y), X.shape[1]
    c = G / (G - 1) * (n - 1) / (n - k)
    V = c * XtX_inv @ meat @ XtX_inv
    r2 = 1 - (u @ u) / ((y - y.mean()) @ (y - y.mean()))
    return b, np.sqrt(np.diag(V)), r2, G


def hedonic(rows, fe_key, rent_kind):
    data = []
    for L in rows:
        a, area = age_of(L), se.num(L["전용면적"])
        m, d = se.num(L["월세"]), se.num(L["보증금"])
        if a is None or not area or m is None or d is None:
            continue
        r = se.converted_rent(L) if rent_kind == "환산" else m
        if not r or r <= 0:
            continue
        data.append((L, a, area, r))
    fe_levels = sorted({fe_key(L) for L, *_ in data})
    fl_levels = ["2층", "3층이상", "지하", None]
    ty_levels = sorted({L["세부유형"] for L, *_ in data})[1:]
    cols = [f"연식_{lb}" for lb in LABELS[1:]] + ["log면적"] + [f"층_{x}" for x in fl_levels] + \
           [f"유형_{x}" for x in ty_levels] + [f"FE_{x}" for x in fe_levels]
    X = np.zeros((len(data), len(cols)))
    y = np.zeros(len(data))
    cl = []
    for i, (L, a, area, r) in enumerate(data):
        j = age_bin(a)
        if j:
            X[i, j - 1] = 1
        X[i, len(LABELS) - 1] = math.log(area)
        fb = cu.floor_band(L["층"])
        if fb != "1층":
            X[i, len(LABELS) + fl_levels.index(fb)] = 1
        if L["세부유형"] in ty_levels:
            X[i, len(LABELS) + len(fl_levels) + ty_levels.index(L["세부유형"])] = 1
        X[i, len(LABELS) + len(fl_levels) + len(ty_levels) + fe_levels.index(fe_key(L))] = 1
        y[i] = math.log(r / area)
        cl.append((L["구"], L["법정동"], L["사용승인일"]))
    b, se_, r2, G = ols_cluster(X, y, cl)
    k = len(LABELS) - 1
    n_bin = Counter(age_bin(a) for _, a, _, _ in data)
    coef = [0.0] + list(b[:k])
    ses = [0.0] + list(se_[:k])
    return {"n": len(data), "건물군집": G, "R2": round(float(r2), 3),
            "구간": [{"연식": LABELS[j], "매물": n_bin[j], "계수": round(float(coef[j]), 3), "표준오차": round(float(ses[j]), 3),
                    "임대료차이_%": round(100 * (math.exp(coef[j]) - 1), 1),
                    "95%구간_%": [round(100 * (math.exp(coef[j] - 1.96 * ses[j]) - 1), 1), round(100 * (math.exp(coef[j] + 1.96 * ses[j]) - 1), 1)]}
                   for j in range(len(LABELS))],
            "log면적": round(float(b[k]), 3)}, [age_of(L) for L, *_ in data]


def pava_decreasing(v, w):
    """가중 단조 감소 회귀."""
    blocks = [[x, ww, 1] for x, ww in zip(v, w)]
    i = 0
    while i < len(blocks) - 1:
        if blocks[i][0] < blocks[i + 1][0]:
            a, b = blocks[i], blocks[i + 1]
            tw = a[1] + b[1]
            blocks[i] = [(a[0] * a[1] + b[0] * b[1]) / tw, tw, a[2] + b[2]]
            del blocks[i + 1]
            i = max(i - 1, 0)
        else:
            i += 1
    out = []
    for x, _, c in blocks:
        out += [x] * c
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    listings, ext, bld, use, cfs, cost = we.load()
    ages = {L["매물번호"]: age_of(L) for L in listings}
    have = [k for k, a in ages.items() if a is not None]

    main_fit, _ = hedonic(listings, lambda L: (L["구"], L["법정동"]), "환산")
    rob_gu, _ = hedonic(listings, lambda L: L["구"], "환산")
    rob_m, _ = hedonic(listings, lambda L: (L["구"], L["법정동"]), "월세")

    # ③ 점수 후보
    bins = main_fit["구간"]
    coef = [x["계수"] for x in bins]
    w = [x["매물"] for x in bins]
    mono = pava_decreasing(coef, w)
    centers = []
    for j in range(len(LABELS)):
        v = sorted(a for a in ages.values() if a is not None and age_bin(a) == j)
        centers.append(median(v))
    raw_score = [100 * math.exp(c) / max(math.exp(x) for x in coef) for c in coef]
    mono_score = [100 * math.exp(c) / max(math.exp(x) for x in mono) for c in mono]
    now_score = [se.interp(se.BP["건물연식"], c) for c in centers]

    def cand(a, ys):
        if a is None:
            return None
        if a <= centers[0]:
            return ys[0]
        for x0, y0, x1, y1 in zip(centers, ys, centers[1:], ys[1:]):
            if a <= x1:
                return y0 + (y1 - y0) * (a - x0) / (x1 - x0)
        return ys[-1]

    # ④ 업종마다 다른가 (연식 5분위)
    c5 = qcuts([ages[k] for k in have], 5)
    all5 = Counter(bin_of(ages[k], c5) for k in have)
    N = len(have)
    grp = groups_of(have, use)
    test = {}
    for g, ks in grp.items():
        c = Counter(bin_of(ages[k], c5) for k in ks)
        n, nr = len(ks), N - len(ks)
        rest = {j: all5[j] - c[j] for j in range(5)}
        chi = sum((row[j] - rt * all5[j] / N) ** 2 / (rt * all5[j] / N) for row, rt in ((c, n), (rest, nr)) for j in range(5))
        wv = math.sqrt(sum((c[j] / n - rest[j] / nr) ** 2 / (rest[j] / nr) for j in range(5)))
        sr = [round((c[j] / n) / (all5[j] / N), 2) for j in range(5)]
        test[g] = {"n": n, "χ2": round(chi, 1), "p": chi2_sf(chi, 4), "Cohen_w": round(wv, 3),
                   "효과크기": "큼" if wv >= .5 else "중간" if wv >= .3 else "작음" if wv >= .1 else "무시할 수준", "선택비_5분위": sr}
    order = sorted(test, key=lambda g: test[g]["p"])
    run = 0.0
    for r, g in enumerate(order):
        run = max(run, min(1.0, (len(order) - r) * test[g]["p"]))
        test[g]["p_Holm"] = run

    # ⑤ 총점 영향
    basis = se.build_basis(listings, use)
    full = we.factors_with(basis, [L["매물번호"] for L in listings], None, ext, bld, cfs, cost)
    coord = {L["매물번호"]: se.has_coord(L) for L in listings}
    impact = {}
    for c in se.CATS:
        base = {}
        for k, fac in full[c].items():
            t, u = fs.aggregate(fac, c)
            base[k] = t if se.recommendable(u, coord[k]) else None
        alt = {}
        for k, fac in full[c].items():
            if base[k] is None:
                alt[k] = None
                continue
            f2 = dict(fac)
            f2["건물연식"] = cand(ages[k], mono_score)
            alt[k] = fs.aggregate(f2, c)[0]
        impact[c] = fs.compare(base, alt)

    out = {"meta": {"작성": "2026-11-24", "기준일": str(se.TODAY), "연식있는매물": len(have),
                    "연식없음": len(listings) - len(have), "연식_분위_5_25_50_75_95": [round(se.quantile(sorted(ages[k] for k in have), p), 1) for p in (5, 25, 50, 75, 95)],
                    "100년넘음": sum(1 for k in have if ages[k] > 100), "5분위_경계": [round(x, 1) for x in c5]},
           "①헤도닉_기본(동·환산)": main_fit, "①강건성_구": rob_gu, "①강건성_월세만": rob_m,
           "③점수": {"구간": LABELS, "가운데연식": [round(x, 1) for x in centers], "지금": [round(x) for x in now_score],
                    "후보_원래": [round(x) for x in raw_score], "후보_단조": [round(x) for x in mono_score]},
           "④업종별": test, "⑤총점영향": impact}
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)

    print("작성:", OUT_JSON)
    print(out["meta"])
    for name in ("①헤도닉_기본(동·환산)", "①강건성_구", "①강건성_월세만"):
        f = out[name]
        print(f"\n{name} n={f['n']} 건물={f['건물군집']} R2={f['R2']} log면적={f['log면적']}")
        print(" | ".join(f"{b['연식']}: {b['임대료차이_%']}% {b['95%구간_%']} ({b['매물']})" for b in f["구간"]))
    s = out["③점수"]
    print("\n③ 구간", s["구간"], "\n가운데 연식", s["가운데연식"], "\n지금", s["지금"], "\n후보 원래", s["후보_원래"], "\n후보 단조", s["후보_단조"])
    print("\n④ 업종 | n | p(Holm) | w | 선택비 5분위(새 → 오래됨)")
    for g, t in test.items():
        print(g, t["n"], "<0.001" if t["p_Holm"] < .001 else round(t["p_Holm"], 3), t["Cohen_w"], t["효과크기"], t["선택비_5분위"])
    print("\n⑤ 총점 영향 (순위상관, 상위10, 상위50, 평균변화)")
    for c, v in impact.items():
        print(c, v["순위상관"], v["상위10유지"], v["상위50유지"], v["평균변화"])


if __name__ == "__main__":
    sys.exit(main())
