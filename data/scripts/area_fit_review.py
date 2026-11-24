"""면적 적합도 보완 3단계 (공간 › 면적 적합도, 2026-11-23). 엔진은 바꾸지 않는다.

지금 방식 (scoring_engine.area_fit)
  - 목표 = 그 업종으로 분류된 매물의 전용면적 중앙값 (희망 면적을 넣으면 그 값)
  - 차이 = (실제 − 목표) ÷ 목표.  넓음 (0.2→100, 0.5→70, 1.0→40, 2.0→10), 좁음 (0.2→100, 0.3→60, 0.5→20, 0.6→0)
  - 판정: 목표 = 중앙값 "부분", 넓음·좁음 비대칭 구간값 "없음"

이 스크립트
  ① 면적이 업종을 가르는가: 전체 매물 면적 5분위로 나눠 업종 대 나머지 2×5 독립성 카이제곱(자유도 4),
     Cohen's w, Holm 보정 18개 (층 검정 1단계와 같은 방식)
  ② 중앙값이 대표값으로 맞는가: 업종 매물 면적 분포(25%·50%·75%)와, 선택비가 가장 높은 면적 구간이 중앙값 근처인지
     넓은 쪽·좁은 쪽으로 선택비가 얼마나 빨리 떨어지는지 (지금 식의 비대칭이 데이터와 맞는지)
  ③ 대안: 면적 10분위 구간별 수축 선택비 (층 2단계와 같은 식, 구간별 베타-이항 m, 세부 업종은 대분류 쪽으로)
     점수 = 100 × 선택비' ÷ 최대 (구간 가운데 면적 사이는 log 면적으로 선형 보간). 40 + 60 × 도 함께 기록
  ④ 판별력: 5겹 교차(자기 라벨 제외)로 지금 식과 대안의 AUC (업종 매물 대 다른 업종 매물)
  ⑤ 총점 영향: 면적 적합도만 바꿔 순위 비교
  ⑥ 희망 면적을 넣은 경우: 대안 곡선을 희망 면적이 업종 중앙값 자리에 오도록 옮겨 쓰는 안의 예시

출력  data/09.스코어링/면적적합도_보완.json
실행  py -I data/scripts/area_fit_review.py
"""
import json
import math
import os
import random
import sys
from collections import Counter
from statistics import median

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classify_use as cu  # noqa: E402
import scoring_engine as se  # noqa: E402
import factor_sensitivity as fs  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT_JSON = os.path.join(se.OUT, "면적적합도_보완.json")
K, SEED = 5, 20261123
MGRID = [round(10 ** (x / 20), 2) for x in range(0, 101)]


def qcuts(vals, q):
    s = sorted(vals)
    return [se.quantile(s, 100 * i / q) for i in range(1, q)]


def bin_of(a, cuts):
    for i, c in enumerate(cuts):
        if a <= c:
            return i
    return len(cuts)


def chi2_sf(x, df):
    """짝수 자유도 카이제곱 위꼬리 확률."""
    t, s = math.exp(-x / 2), 0.0
    term = 1.0
    for i in range(df // 2):
        if i:
            term *= (x / 2) / i
        s += term
    return min(1.0, t * s)


def bb_loglik(c, n, a, b):
    return (math.lgamma(c + a) + math.lgamma(n - c + b) - math.lgamma(n + a + b)
            + math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b))


def groups_of(ids, use):
    g = {c: [k for k in ids if c in use[k]["cats"]] for c in se.CATS}
    for c, (b1, b2, _) in cu.SPLIT.items():
        for sub in (b1, b2):
            g[c + se.SUB_SEP + sub] = [k for k in ids if sub in use[k]["subs"].get(c, [])]
    return g


def build_curves(ids, area, use, cuts):
    """ids 매물로 10분위 수축 선택비 곡선을 만든다. 반환: {업종: (가운데 log면적 목록, 선택비' 목록)}, m, 원래 선택비"""
    nb = len(cuts) + 1
    have = [k for k in ids if area[k]]
    allc = Counter(bin_of(area[k], cuts) for k in have)
    N = len(have)
    pi = [allc[j] / N for j in range(nb)]
    centers = []
    for j in range(nb):
        v = [math.log(area[k]) for k in have if bin_of(area[k], cuts) == j]
        centers.append(median(v))
    grp = groups_of(have, use)
    cnt = {g: [Counter(bin_of(area[k], cuts) for k in ks)[j] for j in range(nb)] for g, ks in grp.items()}
    m = []
    for j in range(nb):
        ll = {mm: sum(bb_loglik(cnt[c][j], sum(cnt[c]), mm * pi[j], mm * (1 - pi[j])) for c in se.CATS) for mm in MGRID}
        m.append(max(ll, key=ll.get))

    def shrink(c, prior):
        n = sum(c)
        q = [(x + m[j] * pr) / (n + m[j]) for j, (x, pr) in enumerate(zip(c, prior))]
        t = sum(q)
        return [x / t for x in q]

    share = {c: shrink(cnt[c], pi) for c in se.CATS}
    for g in grp:
        if se.SUB_SEP in g:
            share[g] = shrink(cnt[g], share[g.split(se.SUB_SEP)[0]])
    sr = {g: [q / p for q, p in zip(share[g], pi)] for g in grp}
    raw = {g: [(c / sum(cnt[g])) / p if sum(cnt[g]) else None for c, p in zip(cnt[g], pi)] for g in grp}
    return {g: (centers, sr[g]) for g in grp}, m, raw, cnt, pi


def curve_score(a, curve, mode="나", shift=1.0):
    if not a:
        return None
    centers, sr = curve
    mx = max(sr)
    ys = [100 * s / mx if mode == "나" else 40 + 60 * s / mx for s in sr]
    x = math.log(a * shift)
    if x <= centers[0]:
        return ys[0]
    for (x0, y0), (x1, y1) in zip(zip(centers, ys), zip(centers[1:], ys[1:])):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return ys[-1]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    listings, ext, bld, use, cfs, cost = we.load()
    ids = [L["매물번호"] for L in listings]
    area = {L["매물번호"]: se.num(L["전용면적"]) for L in listings}
    have = [k for k in ids if area[k]]
    basis = se.build_basis(listings, use)
    grp = groups_of(have, use)

    # ① 면적이 업종을 가르는가 (5분위)
    c5 = qcuts([area[k] for k in have], 5)
    all5 = Counter(bin_of(area[k], c5) for k in have)
    N = len(have)
    test = {}
    for g, ks in grp.items():
        c = Counter(bin_of(area[k], c5) for k in ks)
        n = len(ks)
        rest = {j: all5[j] - c[j] for j in range(5)}
        nr = N - n
        chi = sum((row[j] - rt * all5[j] / N) ** 2 / (rt * all5[j] / N) for row, rt in ((c, n), (rest, nr)) for j in range(5))
        w = math.sqrt(sum((c[j] / n - rest[j] / nr) ** 2 / (rest[j] / nr) for j in range(5)))
        test[g] = {"n": n, "χ2": round(chi, 1), "p": chi2_sf(chi, 4), "Cohen_w": round(w, 3),
                   "효과크기": "큼" if w >= .5 else "중간" if w >= .3 else "작음" if w >= .1 else "무시할 수준"}
    order = sorted(test, key=lambda g: test[g]["p"])
    run = 0.0
    for r, g in enumerate(order):
        run = max(run, min(1.0, (len(order) - r) * test[g]["p"]))
        test[g]["p_Holm"] = run

    # ③ 10분위 수축 선택비 곡선 (전체 자료)
    c10 = qcuts([area[k] for k in have], 10)
    curves, m10, raw10, cnt10, pi10 = build_curves(ids, area, use, c10)
    cent_area = [round(math.exp(x), 1) for x in curves[se.CATS[0]][0]]

    # ② 중앙값과 선택비 꼭대기, 좁은 쪽·넓은 쪽 기울기
    shape = {}
    for g, ks in grp.items():
        a = sorted(area[k] for k in ks)
        med = basis[g]["area"]
        centers, sr = curves[g]
        top = max(range(10), key=lambda j: sr[j])
        # 중앙값에서 절반 크기(0.5배)·두 배(2배)일 때 대안 점수 → 좁은 쪽과 넓은 쪽 중 어디서 더 떨어지나
        s_med = curve_score(med, curves[g])
        shape[g] = {"n": len(ks), "면적_25_50_75": [round(se.quantile(a, p), 1) for p in (25, 50, 75)],
                    "선택비_최고구간": j_label(top, c10), "최고구간_가운데면적": cent_area[top],
                    "대안점수_중앙값": round(s_med), "대안점수_0.5배": round(curve_score(med * .5, curves[g])),
                    "대안점수_2배": round(curve_score(med * 2, curves[g])),
                    "지금점수_0.5배": round(se.area_fit(med * .5, med)), "지금점수_2배": round(se.area_fit(med * 2, med))}

    # ④ 판별력 (5겹 교차, 업종 매물 대 다른 업종 매물)
    rnd = random.Random(SEED)
    sh = ids[:]
    rnd.shuffle(sh)
    fold = {k: i % K for i, k in enumerate(sh)}
    oof_now = {g: {} for g in grp}
    oof_alt = {g: {} for g in grp}
    for f in range(K):
        train = [k for k in ids if fold[k] != f]
        test_ids = [k for k in have if fold[k] == f]
        b_f = se.build_basis([L for L in listings if fold[L["매물번호"]] != f], use)
        cv_f, _, _, _, _ = build_curves(train, area, use, c10)
        for g in grp:
            for k in test_ids:
                oof_now[g][k] = se.area_fit(area[k], b_f[g]["area"])
                oof_alt[g][k] = curve_score(area[k], cv_f[g])
    labeled = [k for k in have if use[k]["cats"]]
    disc = {}
    for g in grp:
        cat, sub = (g.split(se.SUB_SEP) + [None])[:2]
        member = (lambda k: cat in use[k]["cats"]) if sub is None else (lambda k: sub in use[k]["subs"].get(cat, []))
        # 기본: 업종 라벨이 있는 매물 전체에서 이 업종(세부 업종) 매물 대 나머지
        y = np.array([1 if member(k) else 0 for k in labeled])
        a_now = we.auc(np.array([oof_now[g][k] for k in labeled]), y)
        a_alt = we.auc(np.array([oof_alt[g][k] for k in labeled]), y)
        disc[g] = {"양성": int(y.sum()), "AUC_지금": round(a_now, 3), "AUC_대안": round(a_alt, 3)}
        if sub is not None:   # 참고: 같은 대분류 안에서 이 세부 업종 대 다른 세부 업종
            pool = [k for k in labeled if cat in use[k]["cats"]]
            y2 = np.array([1 if member(k) else 0 for k in pool])
            disc[g]["대분류안_AUC_지금"] = round(we.auc(np.array([oof_now[g][k] for k in pool]), y2), 3)
            disc[g]["대분류안_AUC_대안"] = round(we.auc(np.array([oof_alt[g][k] for k in pool]), y2), 3)

    # ⑤ 총점 영향 (대분류 8개, 면적 적합도만 교체)
    full = we.factors_with(basis, ids, None, ext, bld, cfs, cost)
    coord = {L["매물번호"]: se.has_coord(L) for L in listings}
    impact = {}
    for c in se.CATS:
        base = {}
        for k, fac in full[c].items():
            t, u = fs.aggregate(fac, c)
            base[k] = t if se.recommendable(u, coord[k]) else None
        impact[c] = {}
        for mode in ("나", "가"):
            alt = {}
            for k, fac in full[c].items():
                if base[k] is None:
                    alt[k] = None
                    continue
                f2 = dict(fac)
                f2["면적적합도"] = curve_score(area[k], curves[c], mode)
                alt[k] = fs.aggregate(f2, c)[0]
            impact[c][mode] = fs.compare(base, alt)

    # ⑥ 희망 면적 예시: 곡선을 (중앙값 ÷ 희망) 배로 옮김
    want_ex = {}
    for c, want in (("식음료", 50.0), ("교육", 200.0), ("사무업무", 60.0)):
        med = basis[c]["area"]
        rows = []
        for a in (want * .5, want * .7, want, want * 1.5, want * 2, want * 3):
            rows.append({"면적": round(a, 1), "지금": round(se.area_fit(a, want)),
                         "대안": round(curve_score(a, curves[c], "나", med / want))})
        want_ex[c] = {"희망": want, "업종중앙값": med, "표": rows}

    tables = {}
    for g in grp:
        centers, sr = curves[g]
        mx = max(sr)
        tables[g] = {"개수": cnt10[g], "선택비_원래": [None if x is None else round(x, 2) for x in raw10[g]],
                     "선택비_수축": [round(x, 2) for x in sr], "점수_나": [round(100 * s / mx) for s in sr],
                     "점수_가": [round(40 + 60 * s / mx) for s in sr]}

    out = {"meta": {"작성": "2026-11-23", "면적있는매물": N, "5분위_경계": [round(x, 1) for x in c5],
                    "10분위_경계": [round(x, 1) for x in c10], "10분위_가운데면적": cent_area, "구간별_m": m10,
                    "교차겹": K, "시드": SEED},
           "①검정": test, "②모양": shape, "③선택비곡선": tables, "④판별력": disc, "⑤총점영향": impact, "⑥희망면적예시": want_ex}
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)

    print("작성:", OUT_JSON)
    print("면적 있는 매물", N, "| 5분위 경계", out["meta"]["5분위_경계"])
    print("10분위 경계", out["meta"]["10분위_경계"], "\n가운데 면적", cent_area, "\n구간별 m", m10)
    f = lambda p: "<0.001" if p < 0.001 else f"{p:.3f}"
    print("\n① 업종 | n | χ² | p(Holm) | w 크기")
    for g, t in test.items():
        print(g, t["n"], t["χ2"], f(t["p_Holm"]), t["Cohen_w"], t["효과크기"])
    print("\n② 업종 | 면적 25·50·75 | 선택비 최고 구간(가운데) | 대안 점수 0.5배·중앙값·2배 | 지금 0.5배·2배")
    for g, s in shape.items():
        print(g, s["면적_25_50_75"], s["선택비_최고구간"], s["최고구간_가운데면적"],
              (s["대안점수_0.5배"], s["대안점수_중앙값"], s["대안점수_2배"]), (s["지금점수_0.5배"], s["지금점수_2배"]))
    print("\n③ 업종 | 10분위 점수(나)")
    for g, t in tables.items():
        print(g, t["점수_나"], "| 원래 선택비", t["선택비_원래"])
    print("\n④ 업종 | 양성 | AUC 지금 → 대안")
    for g, d in disc.items():
        print(g, d["양성"], d["AUC_지금"], "→", d["AUC_대안"], "| 대분류 안", d.get("대분류안_AUC_지금"), "→", d.get("대분류안_AUC_대안"))
    print("\n⑤ 총점 영향 (순위상관, 상위10, 상위50, 평균변화)")
    for c in se.CATS:
        print(c, {o: (v["순위상관"], v["상위10유지"], v["상위50유지"], v["평균변화"]) for o, v in impact[c].items()})
    print("\n⑥ 희망 면적 예시")
    for c, e in want_ex.items():
        print(c, "희망", e["희망"], "중앙값", e["업종중앙값"], [(r["면적"], r["지금"], r["대안"]) for r in e["표"]])


def j_label(j, cuts):
    lo = "0" if j == 0 else f"{cuts[j - 1]:.0f}"
    hi = "" if j == len(cuts) else f"{cuts[j]:.0f}"
    return f"{lo}~{hi}㎡"


if __name__ == "__main__":
    sys.exit(main())
