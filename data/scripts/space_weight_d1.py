"""D1 공간 그룹 안 비중 (층·면적·연식), (나) 하한 없음 기준 (2026-11-24). 엔진은 바꾸지 않는다.

인자 점수 (5겹 교차, 자기 라벨이 점수표에 안 들어감)
  층 = 100 × 수축 선택비 ÷ 최대, 면적 = 11구간 수축 선택비 (100 × ÷ 최대), 연식 = 헤도닉 곡선
라벨  중개사 추천용도: 이 업종 = 1, 다른 업종 = 0
비교 세 가지 (모두 같은 5겹으로 평가)
  ① 지금 비중 (PRESET)
  ② FR 비중: 학습 4겹에서 인자별 빈도비 강도 → 비중 (weight_estimation.fr_strength, 순위 기반이라 점수 범위와 무관)
  ③ AUC 최적 비중: 학습 4겹에서 5 간격 격자(합 100, 231개) 중 AUC 최고 → 남은 1겹에서 평가 (중첩 교차검증)
안정성  겹마다 고른 비중의 범위, 전체 자료 부트스트랩 200회로 ③ 비중 분포
출력  09.스코어링/공간_그룹안비중_D1.json
"""
import json
import math
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classify_use as cu  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402
from area_fit_review import build_curves, qcuts  # noqa: E402
from building_age_review import age_of  # noqa: E402
from space_scale_check import B4, floor_sr, area_curve_val  # noqa: E402

OUT = os.path.join(se.OUT, "공간_그룹안비중_D1.json")
K, SEED, NB = 5, 20261124, 200
GRID = [(a, b, 100 - a - b) for a in range(0, 101, 5) for b in range(0, 101 - a, 5)]


def fast_auc(s, y):
    order = np.argsort(s, kind="mergesort")
    ss = s[order]
    r = np.empty(len(s))
    i = 0
    n = len(s)
    ranks = np.arange(1, n + 1, dtype=float)
    # 같은 값 평균 순위
    _, start, cnt = np.unique(ss, return_index=True, return_counts=True)
    for st, c in zip(start, cnt):
        ranks[st:st + c] = st + (c + 1) / 2
    r[order] = ranks
    n1 = y.sum()
    n0 = n - n1
    return (r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)


def combine(F, M, w):
    """F: 인자 점수 (n×3), M: 값 있음 (n×3). 빈칸은 재분배."""
    W = M * np.array(w, dtype=float)
    tw = W.sum(1)
    v = (np.nan_to_num(F) * W).sum(1)
    return np.where(tw > 0, v / np.where(tw > 0, tw, 1), 0.0)


def best_grid(F, M, y):
    best, bw = -1, None
    for w in GRID:
        a = fast_auc(combine(F, M, w), y)
        if a > best:
            best, bw = a, w
    return bw, best


def fr_weights(F, M, y):
    s = []
    for j in range(3):
        m = M[:, j]
        s.append(we.fr_strength(F[m, j], y[m]) if m.sum() else 0.0)
    s = np.array(s)
    return list(s / s.sum() * 100) if s.sum() > 0 else [100 / 3] * 3


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    listings, ext, bld, use, cfs, cost = we.load()
    ids = [L["매물번호"] for L in listings]
    band = {L["매물번호"]: cu.floor_band(L["층"]) for L in listings}
    area = {L["매물번호"]: se.num(L["전용면적"]) for L in listings}
    age = {L["매물번호"]: age_of(L) for L in listings}
    ag = json.load(open(os.path.join(se.OUT, "건물연식_보완.json"), encoding="utf-8"))["③점수"]
    cx, cy = ag["가운데연식"], ag["후보_단조"]

    def age_score(a):
        if a is None:
            return np.nan
        if a <= cx[0]:
            return cy[0]
        for x0, y0, x1, y1 in zip(cx, cy, cx[1:], cy[1:]):
            if a <= x1:
                return y0 + (y1 - y0) * (a - x0) / (x1 - x0)
        return cy[-1]

    srt = sorted(area[k] for k in ids if area[k])
    cuts = sorted(qcuts(srt, 10) + [se.quantile(srt, 95)])
    rnd = random.Random(SEED)
    sh = ids[:]
    rnd.shuffle(sh)
    fold = {k: i % K for i, k in enumerate(sh)}
    fac = {c: {} for c in se.CATS}
    for f in range(K):
        train = [k for k in ids if fold[k] != f]
        fsr = floor_sr([k for k in train if band[k]], band, use)
        curves, *_ = build_curves(train, area, use, cuts)
        for k in ids:
            if fold[k] != f:
                continue
            for c in se.CATS:
                fv = 100 * fsr[c][B4.index(band[k])] / max(fsr[c]) if band[k] else np.nan
                av = 100 * area_curve_val(area[k], curves[c]) / max(curves[c][1]) if area[k] else np.nan
                fac[c][k] = (fv, av, age_score(age[k]))

    labeled = [k for k in ids if use[k]["cats"]]
    fl = np.array([fold[k] for k in labeled])
    res = {}
    rng = np.random.default_rng(SEED)
    for c in se.CATS:
        F = np.array([fac[c][k] for k in labeled], dtype=float)
        M = ~np.isnan(F)
        y = np.array([1 if c in use[k]["cats"] else 0 for k in labeled])
        cur = se.PRESET[c]["s"]["공간"]
        pred = {"지금": np.zeros(len(y)), "FR": np.zeros(len(y)), "AUC최적": np.zeros(len(y))}
        chosen, frs = [], []
        for f in range(K):
            tr, te = fl != f, fl == f
            pred["지금"][te] = combine(F[te], M[te], cur)
            wfr = fr_weights(F[tr], M[tr], y[tr])
            frs.append([round(x) for x in wfr])
            pred["FR"][te] = combine(F[te], M[te], wfr)
            wb, _ = best_grid(F[tr], M[tr], y[tr])
            chosen.append(wb)
            pred["AUC최적"][te] = combine(F[te], M[te], wb)
        auc = {k: round(fast_auc(v, y), 4) for k, v in pred.items()}
        w_all, a_all = best_grid(F, M, y)
        boot = []
        for _ in range(NB):
            i = rng.integers(0, len(y), len(y))
            boot.append(best_grid(F[i], M[i], y[i])[0])
        boot = np.array(boot)
        res[c] = {"양성": int(y.sum()), "지금비중": cur, "AUC_교차": auc,
                  "FR비중_겹별": frs, "FR비중_전체": [round(x) for x in fr_weights(F, M, y)],
                  "AUC최적_겹별": chosen, "AUC최적_전체": list(w_all),
                  "부트스트랩_중앙값": [int(x) for x in np.median(boot, 0)],
                  "부트스트랩_90%": [[int(x) for x in np.percentile(boot[:, j], [5, 95])] for j in range(3)]}
        print(c, cur, auc, "| FR", res[c]["FR비중_전체"], "| 최적", list(w_all), "겹별", chosen,
              "| 부트 중앙", res[c]["부트스트랩_중앙값"], "90%", res[c]["부트스트랩_90%"], flush=True)
    json.dump({"meta": {"작성": "2026-11-24", "격자": "5 간격 231개", "교차겹": K, "부트스트랩": NB, "시드": SEED}, "업종": res},
              open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print("작성:", OUT)


if __name__ == "__main__":
    sys.exit(main())
