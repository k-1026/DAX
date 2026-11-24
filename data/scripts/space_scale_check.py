"""D5 판단: 최저점 40 유지(가) vs 없앰(나)이 공간 그룹 점수 판별력에 주는 영향 (2026-11-24). 엔진은 바꾸지 않는다.

공간 그룹 점수 = 층·면적·연식의 가중 평균 (빈칸은 남은 인자로 재분배)
  층   : 수축 선택비(층점수_수축과 같은 방식), 5겹 교차로 학습 매물만으로 계산
  면적 : 11구간(10분위 + 95%) 수축 선택비 (D7), 5겹 교차
  연식 : (가) 헤도닉 곡선 100·75·70·70·57·57·50·47… (모든 안 공통)
  변환 : (가) 40 + 60 × 선택비 ÷ 최대 / (나) 100 × 선택비 ÷ 최대   (층·면적 같이)
라벨  : 중개사 추천용도로 분류된 매물, 이 업종 = 1, 다른 업종 = 0 (그룹 안 비중 추정과 같은 대리 라벨)
① 지금 비중(PRESET 공간)으로 AUC 비교
② 층 비중을 0~100(5 간격)으로 바꿔 가며(면적:연식 비율은 지금대로) 각 안의 최고 AUC와 그때 비중
③ (가) = 40 + 0.6 × (나) 이므로 (가)의 층 비중 w는 (나)의 층 비중 0.6w와 같은 효과인지 확인
출력  09.스코어링/공간_점수범위_검토.json
"""
import json
import math
import os
import random
import sys
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classify_use as cu  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402
from area_fit_review import build_curves, qcuts  # noqa: E402
from building_age_review import age_of  # noqa: E402

B4 = ("1층", "2층", "3층이상", "지하")
MGRID = [round(10 ** (x / 20), 2) for x in range(0, 101)]
OUT = os.path.join(se.OUT, "공간_점수범위_검토.json")
K, SEED = 5, 20261124


def bb(c, n, a, b):
    return math.lgamma(c + a) + math.lgamma(n - c + b) - math.lgamma(n + a + b) + math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)


def floor_sr(ids, band, use):
    allc = Counter(band[k] for k in ids)
    N = sum(allc[b] for b in B4)
    pi = [allc[b] / N for b in B4]
    cnt = {c: [Counter(band[k] for k in ids if c in use[k]["cats"])[b] for b in B4] for c in se.CATS}
    m = []
    for j in range(4):
        ll = {mm: sum(bb(cnt[c][j], sum(cnt[c]), mm * pi[j], mm * (1 - pi[j])) for c in se.CATS) for mm in MGRID}
        m.append(max(ll, key=ll.get))
    out = {}
    for c in se.CATS:
        n = sum(cnt[c])
        q = [(x + m[j] * pi[j]) / (n + m[j]) for j, x in enumerate(cnt[c])]
        t = sum(q)
        out[c] = [qq / t / p for qq, p in zip(q, pi)]
    return out


def conv(sr, x, mode):
    mx = max(sr)
    return 100 * x / mx if mode == "나" else 40 + 60 * x / mx


def area_curve_val(a, curve):
    centers, sr = curve
    x = math.log(a)
    if x <= centers[0]:
        return sr[0]
    for x0, y0, x1, y1 in zip(centers, sr, centers[1:], sr[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return sr[-1]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    listings, ext, bld, use, cfs, cost = we.load()
    ids = [L["매물번호"] for L in listings]
    band = {L["매물번호"]: cu.floor_band(L["층"]) for L in listings}
    area = {L["매물번호"]: se.num(L["전용면적"]) for L in listings}
    age = {L["매물번호"]: age_of(L) for L in listings}
    ag = json.load(open(os.path.join(se.OUT, "건물연식_보완.json"), encoding="utf-8"))["③점수"]
    centers, ys = ag["가운데연식"], ag["후보_단조"]

    def age_score(a):
        if a is None:
            return None
        if a <= centers[0]:
            return ys[0]
        for x0, y0, x1, y1 in zip(centers, ys, centers[1:], ys[1:]):
            if a <= x1:
                return y0 + (y1 - y0) * (a - x0) / (x1 - x0)
        return ys[-1]

    have_a = [k for k in ids if area[k]]
    srt = sorted(area[k] for k in have_a)
    cuts = sorted(qcuts(srt, 10) + [se.quantile(srt, 95)])

    rnd = random.Random(SEED)
    sh = ids[:]
    rnd.shuffle(sh)
    fold = {k: i % K for i, k in enumerate(sh)}
    raw = {c: {} for c in se.CATS}      # 매물별 (층 선택비, 층 최대, 면적 선택비, 면적 최대) — OOF
    for f in range(K):
        train = [k for k in ids if fold[k] != f]
        fs_ = floor_sr([k for k in train if band[k]], band, use)
        curves, *_ = build_curves(train, area, use, cuts)
        for k in ids:
            if fold[k] != f:
                continue
            for c in se.CATS:
                fsr = fs_[c][B4.index(band[k])] if band[k] else None
                asr = area_curve_val(area[k], curves[c]) if area[k] else None
                raw[c][k] = (fsr, max(fs_[c]), asr, max(curves[c][1]))

    labeled = [k for k in ids if use[k]["cats"]]

    def group_scores(c, mode, w):
        out = []
        for k in labeled:
            fsr, fmx, asr, amx = raw[c][k]
            fv = None if fsr is None else (100 * fsr / fmx if mode == "나" else 40 + 60 * fsr / fmx)
            av = None if asr is None else (100 * asr / amx if mode == "나" else 40 + 60 * asr / amx)
            v, _ = se.wavg([(w[0], fv), (w[1], av), (w[2], age_score(age[k]))])
            out.append(v if v is not None else 0.0)
        return np.array(out)

    res = {}
    for c in se.CATS:
        y = np.array([1 if c in use[k]["cats"] else 0 for k in labeled])
        cur = se.PRESET[c]["s"]["공간"]
        r = {"지금비중": cur}
        for mode in ("가", "나"):
            r["AUC_지금비중_" + mode] = round(we.auc(group_scores(c, mode, cur), y), 4)
        rest = cur[1] + cur[2]
        for mode in ("가", "나"):
            grid = {}
            for wf in range(0, 101, 5):
                w = [wf, (100 - wf) * cur[1] / rest, (100 - wf) * cur[2] / rest]
                grid[wf] = we.auc(group_scores(c, mode, w), y)
            best = max(grid, key=grid.get)
            r["격자_" + mode] = {str(k): round(v, 4) for k, v in grid.items()}
            r["최고_" + mode] = {"층비중": best, "AUC": round(grid[best], 4)}
        res[c] = r

    json.dump({"meta": {"작성": "2026-11-24", "면적구간": [round(x, 1) for x in cuts], "교차겹": K, "시드": SEED}, "업종": res},
              open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print("작성:", OUT)
    print("업종 | 지금 비중(층·면적·연식) | AUC 지금비중 (가) → (나) | 최고 (가): 층비중 AUC | 최고 (나): 층비중 AUC")
    for c, r in res.items():
        print(c, r["지금비중"], r["AUC_지금비중_가"], "→", r["AUC_지금비중_나"], "|", r["최고_가"], "|", r["최고_나"])


if __name__ == "__main__":
    sys.exit(main())
