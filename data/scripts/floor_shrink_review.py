"""층 점수식 보완 2단계: 수축 선택비 (공간 › 층, 2026-11-23). 엔진은 바꾸지 않는다.

문제 (1단계 floor_test_review.py에서 확인)
  - 매물이 적은 업종은 선택비가 우연에 크게 흔들린다(예: 배달전문 2층·3층 0건 → 선택비 0 → 40점).
  - p ≥ 0.05면 층 인자를 통째로 끈다(공연문화, 전시장·쇼룸). "확신 없음"을 "차이 없음"으로 취급하는 절벽.
  - 지하는 근거 없이 모두 40점(공연문화만 보류). 하한 40도 근거 없음.

방법: 수축(shrinkage) 선택비
  - 업종 매물의 층 비율을 전체 비율 쪽으로 당긴다:  비율' = (업종 개수 + M × 전체 비율) ÷ (업종 매물 수 + M)
    = 디리클레 사전분포의 사후 평균(가법 평활). 매물이 많으면 거의 그대로, 적으면 전체 쪽으로 많이 당겨진다.
  - 선택비' = 비율' ÷ 전체 비율.  지하를 포함한 4구간으로 계산해 지하 40점 고정도 대체한다.
  - 당기는 세기는 사람이 정하지 않고 데이터로 정한다. 층 구간마다 따로 정한다(베타-이항 경험적 베이즈):
      층 구간 b마다, 대분류 8개의 개수에 대한 베타-이항 주변우도를 최대로 하는 m_b
      → 업종 간 차이가 큰 구간(1층·3층+)은 약하게, 업종 간 차이보다 우연이 큰 구간(지하)은 강하게 당겨진다.
      (하나의 M을 디리클레-다항으로 고르는 방식도 함께 기록. 그 방식은 M=5로 지하를 거의 당기지 못함)
  - 당기는 중심: 대분류는 전체 비율, 세부 업종은 소속 대분류의 수축된 비율(계층형).
  - 구간별로 당긴 뒤 네 구간 합이 1이 되게 다시 나눈다.
  - 점수 변환 두 가지를 비교한다.
      (가) 지금 식 유지:   40 + 60 × 선택비' ÷ 최대 선택비'
      (나) 하한 없이:     100 × 선택비' ÷ 최대 선택비'   (최댓값 대비 비율 정규화, COINr n_fracmax)
  - 업종별로 층 점수만 바꿔 총점을 다시 매기고, 지금 순위와 비교한다(그룹 가중치·다른 인자는 그대로).

출력  data/09.스코어링/층점수_수축.json
실행  py -I data/scripts/floor_shrink_review.py
"""
import csv
import json
import math
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classify_use as cu  # noqa: E402
import scoring_engine as se  # noqa: E402
import factor_sensitivity as fs  # noqa: E402
import weight_estimation as we  # noqa: E402

B4 = ("1층", "2층", "3층이상", "지하")
GRID = [1, 2, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000]
OUT_JSON = os.path.join(se.OUT, "층점수_수축.json")


def dm_loglik(counts, alpha):
    """디리클레-다항 주변 로그우도 (다항 계수 상수항 제외)."""
    n, a0 = sum(counts), sum(alpha)
    return math.lgamma(a0) - math.lgamma(n + a0) + sum(math.lgamma(c + a) - math.lgamma(a) for c, a in zip(counts, alpha))


def loo_loglik(counts, alpha):
    n, a0 = sum(counts), sum(alpha)
    return sum(c * math.log((c - 1 + a) / (n - 1 + a0)) for c, a in zip(counts, alpha) if c > 0)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    listings, ext, bld, use, cfs, cost = we.load()
    band = {L["매물번호"]: cu.floor_band(L["층"]) for L in listings}
    allc = Counter(band.values())
    N = sum(allc[b] for b in B4)
    pi = [allc[b] / N for b in B4]

    groups = [(c, [k for k in band if c in use[k]["cats"]]) for c in se.CATS]
    subs = []
    for c, (b1, b2, _) in cu.SPLIT.items():
        for sub in (b1, b2):
            subs.append((c + se.SUB_SEP + sub, [k for k in band if sub in use[k]["subs"].get(c, [])]))
    counts = {name: [Counter(band[k] for k in ks)[b] for b in B4] for name, ks in groups + subs}

    # M 고르기: 대분류 8개로 (세부 업종은 대분류와 겹쳐 중복 계산이 되므로 제외)
    ml = {M: sum(dm_loglik(counts[c], [M * p for p in pi]) for c in se.CATS) for M in GRID}
    loo = {M: sum(loo_loglik(counts[c], [M * p for p in pi]) for c in se.CATS) for M in GRID}
    M_ml = max(ml, key=ml.get)
    M_loo = max(loo, key=loo.get)
    M = M_ml

    # 구간별 베타-이항 경험적 베이즈
    def bb_loglik(c, n, a, b):
        return (math.lgamma(n + 1) - math.lgamma(c + 1) - math.lgamma(n - c + 1)
                + math.lgamma(c + a) + math.lgamma(n - c + b) - math.lgamma(n + a + b)
                + math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b))
    MGRID = [round(10 ** (x / 20), 2) for x in range(0, 101)]          # 1 ~ 100,000 (로그 간격)
    m_bin = {}
    for j, b in enumerate(B4):
        ll = {m: sum(bb_loglik(counts[c][j], sum(counts[c]), m * pi[j], m * (1 - pi[j])) for c in se.CATS) for m in MGRID}
        m_bin[b] = max(ll, key=ll.get)

    def shrink(cnt, prior):
        n = sum(cnt)
        q = [(c + m_bin[b] * pr) / (n + m_bin[b]) for c, b, pr in zip(cnt, B4, prior)]
        t = sum(q)
        return [x / t for x in q]

    shrunk_share = {c: shrink(counts[c], pi) for c in se.CATS}
    for name, _ in subs:
        shrunk_share[name] = shrink(counts[name], shrunk_share[name.split(se.SUB_SEP)[0]])

    basis = se.build_basis(listings, use)
    tables = {}
    for name, cnt in counts.items():
        n = sum(cnt)
        raw = [(c / n) / p if n else None for c, p in zip(cnt, pi)]
        shr = [q / p for q, p in zip(shrunk_share[name], pi)]
        mx = max(shr)
        cur = basis[name]["floor"] if name in basis else None
        tables[name] = {"n": n, "개수": dict(zip(B4, cnt)),
                        "선택비_원래": [round(x, 3) for x in raw], "선택비_수축": [round(x, 3) for x in shr],
                        "점수_지금": cur, "점수_지금_참고표": basis[name]["floor_ref"] if name in basis else None,
                        "점수_가": [round(40 + 60 * s / mx) for s in shr], "점수_나": [round(100 * s / mx) for s in shr]}

    # 총점 영향 (대분류 8개)
    full = we.factors_with(basis, list(band), {L["매물번호"]: L for L in listings}, ext, bld, cfs, cost)
    impact = {}
    coord = {L["매물번호"]: se.has_coord(L) for L in listings}
    for c in se.CATS:
        base = {}
        for k, fac in full[c].items():
            t, u = fs.aggregate(fac, c)
            base[k] = t if se.recommendable(u, coord[k]) else None
        impact[c] = {}
        for opt in ("가", "나"):
            tab = dict(zip(B4, tables[c]["점수_" + opt]))
            alt = {}
            for k, fac in full[c].items():
                if base[k] is None:
                    alt[k] = None
                    continue
                f2 = dict(fac)
                f2["층"] = tab.get(band[k]) if band[k] else None
                alt[k] = fs.aggregate(f2, c)[0]
            impact[c][opt] = fs.compare(base, alt)

    out = {"meta": {"작성": "2026-11-23", "전체_층비율": dict(zip(B4, [round(p, 4) for p in pi])), "M_후보": GRID,
                    "M_주변우도_디리클레": M_ml, "M_교차검증_디리클레": M_loo, "구간별_m_베타이항(사용)": m_bin,
                    "주변우도": {str(k): round(v, 2) for k, v in ml.items()}, "교차검증_로그우도": {str(k): round(v, 2) for k, v in loo.items()}},
           "업종": tables, "총점영향": impact}
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)

    print("작성:", OUT_JSON)
    print("전체 층 비율 (1층·2층·3층+·지하):", [round(100 * p, 1) for p in pi])
    print("하나의 M (디리클레): 주변우도", M_ml, "교차검증", M_loo, "| 구간별 m (베타-이항, 사용):", m_bin)
    print("\n업종 | n | 선택비 원래 → 수축 (1층·2층·3층+·지하) | 점수 지금 | (가) 지금 식 | (나) 하한 없이")
    for name, t in tables.items():
        f2 = lambda xs: "·".join("-" if x is None else f"{x:.2f}" for x in xs)
        print(f"{name} | {t['n']} | {f2(t['선택비_원래'])} → {f2(t['선택비_수축'])} | {t['점수_지금']} | {t['점수_가']} | {t['점수_나']}")
    print("\n총점 영향 (순위 상관, 상위 10 유지, 평균 변화)")
    for c in se.CATS:
        print(c, {o: (v["순위상관"], v["상위10유지"], v["평균변화"]) for o, v in impact[c].items()})


if __name__ == "__main__":
    sys.exit(main())
