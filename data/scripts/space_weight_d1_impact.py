"""D1 최소 비중 검토 (2026-11-25). 엔진은 바꾸지 않는다.

(1) 최소 비중 0·5·10·15·20별 교차 AUC (space_weight_d1과 같은 인자 점수·라벨·5겹, 중첩 교차검증)
(2) 전체 순위 영향: 공간 인자를 새 식(층 (나)·면적 11구간·연식 헤도닉 공통 곡선)으로 바꾼 뒤,
    공간 안 비중만 지금 / AUC 최적 / 최소 10으로 바꿔 총점 순위 비교 (다른 인자·그룹 가중치 그대로)
출력  09.스코어링/공간_그룹안비중_D1_최소비중_영향.json
실행  py -I data/scripts/space_weight_d1_impact.py
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classify_use as cu  # noqa: E402
import scoring_engine as se  # noqa: E402
import factor_sensitivity as fs  # noqa: E402
import weight_estimation as we  # noqa: E402
import space_weight_d1 as d1  # noqa: E402
from area_fit_review import build_curves, qcuts  # noqa: E402
from building_age_review import age_of  # noqa: E402
from space_scale_check import B4, floor_sr, area_curve_val  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
MINS = [0, 5, 10, 15, 20]

# (1) 최소 비중별 교차 AUC (5겹 중첩, space_weight_d1과 같은 점수·겹)
labeled, fl, fac, use = d1.build_factors()
cv = {}
best_w = {}
for c in se.CATS:
    F = np.array([fac[c][k] for k in labeled], dtype=float)
    M = ~np.isnan(F)
    y = np.array([1 if c in use[k]["cats"] else 0 for k in labeled])
    cv[c], best_w[c] = {}, {}
    for mn in MINS:
        grid = [w for w in d1.GRID if min(w) >= mn]
        pred = np.zeros(len(y))
        for f in range(d1.K):
            tr, te = fl != f, fl == f
            bw = max(grid, key=lambda w: d1.fast_auc(d1.combine(F[tr], M[tr], w), y[tr]))
            pred[te] = d1.combine(F[te], M[te], bw)
        cv[c][mn] = round(d1.fast_auc(pred, y), 4)
        best_w[c][mn] = max(grid, key=lambda w: d1.fast_auc(d1.combine(F, M, w), y))
    print("AUC", c, cv[c], "비중", best_w[c], flush=True)

# (2) 전체 순위 영향: 새 공간 인자(층 (나)·면적 11구간·연식 헤도닉)로 바꾼 뒤 공간 안 비중만 바꿔 총점 비교
listings, ext, bld, use, cfs, cost = we.load()
ids = [L["매물번호"] for L in listings]
band = {L["매물번호"]: cu.floor_band(L["층"]) for L in listings}
area = {L["매물번호"]: se.num(L["전용면적"]) for L in listings}
age = {L["매물번호"]: age_of(L) for L in listings}
ag = json.load(open(os.path.join(se.OUT, "건물연식_보완.json"), encoding="utf-8"))["③점수"]
cx, cy = ag["가운데연식"], ag["후보_단조"]


def age_score(a):
    if a is None:
        return None
    if a <= cx[0]:
        return cy[0]
    for x0, y0, x1, y1 in zip(cx, cy, cx[1:], cy[1:]):
        if a <= x1:
            return y0 + (y1 - y0) * (a - x0) / (x1 - x0)
    return cy[-1]


srt = sorted(area[k] for k in ids if area[k])
cuts = sorted(qcuts(srt, 10) + [se.quantile(srt, 95)])
fsr = floor_sr([k for k in ids if band[k]], band, use)
curves, *_ = build_curves(ids, area, use, cuts)
basis = se.build_basis(listings, use)
full = we.factors_with(basis, ids, {L["매물번호"]: L for L in listings}, ext, bld, cfs, cost)
coord = {L["매물번호"]: se.has_coord(L) for L in listings}
d1j = json.load(open(d1.OUT, encoding="utf-8"))["업종"]


def totals(c, fac_new, wsp):
    old = se.PRESET[c]
    se.PRESET[c] = dict(old, s=dict(old["s"], 공간=list(wsp)))
    out = {}
    for k, f in fac_new.items():
        t, u = fs.aggregate(f, c)
        out[k] = t if se.recommendable(u, coord[k]) else None
    se.PRESET[c] = old
    return out


impact = {}
for c in se.CATS:
    fac_new = {}
    for k, f in full[c].items():
        f2 = dict(f)
        f2["층"] = 100 * fsr[c][B4.index(band[k])] / max(fsr[c]) if band[k] else None
        f2["면적적합도"] = 100 * area_curve_val(area[k], curves[c]) / max(curves[c][1]) if area[k] else None
        f2["건물연식"] = age_score(age[k])
        fac_new[k] = f2
    W = {"지금": se.PRESET[c]["s"]["공간"], "AUC최적": d1j[c]["AUC최적_전체"], "최소10": best_w[c][10]}
    T = {n: totals(c, fac_new, w) for n, w in W.items()}
    impact[c] = {"비중": {n: list(w) for n, w in W.items()}, "공간그룹비중": se.PRESET[c]["g"][1],
                 "최소10_vs_최적": fs.compare(T["AUC최적"], T["최소10"]),
                 "최소10_vs_지금": fs.compare(T["지금"], T["최소10"]),
                 "최적_vs_지금": fs.compare(T["지금"], T["AUC최적"])}
    print("순위", c, json.dumps(impact[c], ensure_ascii=False), flush=True)

json.dump({"meta": {"작성": "2026-11-25", "최소비중_후보": MINS, "교차겹": d1.K, "시드": d1.SEED},
           "cv_auc": {c: {str(m): float(a) for m, a in v.items()} for c, v in cv.items()},
           "best_w": {c: {str(m): list(w) for m, w in v.items()} for c, v in best_w.items()}, "impact": impact},
          open(os.path.join(se.OUT, "공간_그룹안비중_D1_최소비중_영향.json"), "w", encoding="utf-8", newline="\n"),
          ensure_ascii=False, indent=1)
