"""지하 층 점수 범위와 순위 영향 (D10 확인, 2026-11-25). 엔진은 바꾸지 않는다.

지하 층 점수를 범위 아래 · 가운데(수축값) · 위로 바꿨을 때 총점·순위가 얼마나 움직이는지 본다.
설정: 공간 인자 새 식(층 (나) 수축 · 면적 11구간 · 연식 헤도닉), 공간 안 비중 D1(최소 10). 다른 인자·그룹 가중치 그대로.
범위 두 가지: (A) 수축 전 원래 비율 Wilson 95% (대략)  (B) 수축과 같은 틀의 베타 사후 95% (지하 m 사용)
출력  09.스코어링/지하점수_범위_순위.json
실행  py -I data/scripts/basement_range_rank.py
"""
import json
import math
import os
import sys

import numpy as np


class Beta:
    @staticmethod
    def ppf(q, a, b):
        x = np.linspace(1e-7, 0.2, 400001)
        lp = (a - 1) * np.log(x) + (b - 1) * np.log1p(-x) + math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
        cdf = np.cumsum(np.exp(lp)) * (x[1] - x[0])
        return float(np.interp(q, cdf, x))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classify_use as cu  # noqa: E402
import scoring_engine as se  # noqa: E402
import factor_sensitivity as fs  # noqa: E402
import weight_estimation as we  # noqa: E402
from area_fit_review import build_curves, qcuts  # noqa: E402
from building_age_review import age_of  # noqa: E402
from space_scale_check import B4, floor_sr, area_curve_val  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
listings, ext, bld, use, cfs, cost = we.load()
ids = [L["매물번호"] for L in listings]
band = {L["매물번호"]: cu.floor_band(L["층"]) for L in listings}
area = {L["매물번호"]: se.num(L["전용면적"]) for L in listings}
age = {L["매물번호"]: age_of(L) for L in listings}
ag = json.load(open(os.path.join(se.OUT, "건물연식_보완.json"), encoding="utf-8"))["③점수"]
cx, cy = ag["가운데연식"], ag["후보_단조"]
m_b = json.load(open(os.path.join(se.OUT, "층점수_수축.json"), encoding="utf-8"))["meta"]["구간별_m_베타이항(사용)"]["지하"]
d1w = json.load(open(os.path.join(se.OUT, "공간_그룹안비중_D1_최소비중_영향.json"), encoding="utf-8"))["best_w"]


def age_score(a):
    if a is None:
        return None
    if a <= cx[0]:
        return cy[0]
    for x0, y0, x1, y1 in zip(cx, cy, cx[1:], cy[1:]):
        if a <= x1:
            return y0 + (y1 - y0) * (a - x0) / (x1 - x0)
    return cy[-1]


def wilson(c, n, z=1.96):
    p = c / n
    d = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return mid - h, mid + h


banded = [k for k in ids if band[k]]
N = len(banded)
pi_b = sum(1 for k in banded if band[k] == "지하") / N
srt = sorted(area[k] for k in ids if area[k])
cuts = sorted(qcuts(srt, 10) + [se.quantile(srt, 95)])
fsr = floor_sr(banded, band, use)
curves, *_ = build_curves(ids, area, use, cuts)
basis = se.build_basis(listings, use)
full = we.factors_with(basis, ids, {L["매물번호"]: L for L in listings}, ext, bld, cfs, cost)
coord = {L["매물번호"]: se.has_coord(L) for L in listings}

out = {}
for c in se.CATS:
    sr = fsr[c]
    mx = max(sr)
    n = sum(1 for k in banded if c in use[k]["cats"])
    cb = sum(1 for k in banded if c in use[k]["cats"] and band[k] == "지하")
    lo_a, hi_a = wilson(cb, n)
    a_, b_ = cb + m_b * pi_b, n - cb + m_b * (1 - pi_b)
    lo_b, hi_b = Beta.ppf(0.025, a_, b_), Beta.ppf(0.975, a_, b_)
    sc = lambda q: min(100.0, 100 * (q / pi_b) / mx)
    mid = 100 * sr[B4.index("지하")] / mx
    scen = {"A_아래": sc(lo_a), "가운데": mid, "A_위": sc(hi_a), "B_아래": sc(lo_b), "B_위": sc(hi_b)}
    old = se.PRESET[c]
    se.PRESET[c] = dict(old, s=dict(old["s"], 공간=list(d1w[c]["10"])))
    base_fac = {}
    for k, f in full[c].items():
        f2 = dict(f)
        f2["층"] = 100 * sr[B4.index(band[k])] / mx if band[k] else None
        f2["면적적합도"] = 100 * area_curve_val(area[k], curves[c]) / max(curves[c][1]) if area[k] else None
        f2["건물연식"] = age_score(age[k])
        base_fac[k] = f2
    tot = {}
    for name, v in scen.items():
        t = {}
        for k, f in base_fac.items():
            f2 = f if band[k] != "지하" else dict(f, 층=v)
            tt, u = fs.aggregate(f2, c)
            if se.recommendable(u, coord[k]):
                t[k] = tt
        tot[name] = t
    se.PRESET[c] = old
    rk = {name: {k: i + 1 for i, k in enumerate(sorted(t, key=lambda k: -t[k]))} for name, t in tot.items()}
    base_ids = [k for k in rk["가운데"] if band[k] == "지하"]
    M = len(rk["가운데"])
    rows = sorted(base_ids, key=lambda k: rk["가운데"][k])
    detail = [{"id": k, "총점": {nm: round(tot[nm][k], 1) for nm in scen}, "순위": {nm: rk[nm][k] for nm in scen}} for k in rows]
    top = lambda nm, K: set(sorted(tot[nm], key=lambda k: -tot[nm][k])[:K])
    summ = {}
    for pair in (("A_아래", "A_위"), ("B_아래", "B_위")):
        lo, hi = pair
        moves = [rk[lo][k] - rk[hi][k] for k in base_ids]
        summ[lo[0]] = {"점수": [round(scen[lo]), round(mid), round(scen[hi])],
                       "지하매물": len(base_ids), "추천대상": M,
                       "순위폭_중앙값": sorted(moves)[len(moves) // 2] if moves else 0, "순위폭_최대": max(moves) if moves else 0,
                       "상위10_지하수": [len([k for k in top(nm, 10) if band[k] == "지하"]) for nm in (lo, "가운데", hi)],
                       "상위50_지하수": [len([k for k in top(nm, 50) if band[k] == "지하"]) for nm in (lo, "가운데", hi)],
                       "상위10유지(아래vs위)": len(top(lo, 10) & top(hi, 10)), "상위50유지(아래vs위)": len(top(lo, 50) & top(hi, 50)),
                       "총점차_최대": round(max(tot[hi][k] - tot[lo][k] for k in base_ids), 1) if base_ids else 0}
    out[c] = {"지하매물수_업종": cb, "업종매물": n, "층실효비중": round(old["g"][1] * d1w[c]["10"][0] / 100, 1),
              "요약": summ, "상위지하5": detail[:5]}
    print(c, json.dumps({k: v for k, v in out[c].items() if k != "상위지하5"}, ensure_ascii=False))
    for d in detail[:3]:
        print("   ", d["순위"], d["총점"])
json.dump(out, open(os.path.join(se.OUT, "지하점수_범위_순위.json"), "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
