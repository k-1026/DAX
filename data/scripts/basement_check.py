"""층 ⑤ 확인: 수축 선택비에서 지하 점수가 2층보다 높게 나오는 업종 (2026-11-25). 엔진은 바꾸지 않는다.

① 지하 > 2층인 업종: 원래 개수로 2층·지하 선택비 95% 구간(Wilson), 2층 대 지하 정확 이항검정
   (2층·지하 매물만 놓고 "2층 비율"이 전체 비율과 다른가 = 두 선택비가 같은가)
② 시장 가치: 연식 헤도닉 회귀(building_age_review.hedonic)의 층 구간 계수로 지하 대 2층 ㎡당 임대료 차이
출력  09.스코어링/지하점수_확인.json
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import building_age_review as bar  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT = os.path.join(se.OUT, "지하점수_확인.json")


def wilson(c, n, z=1.96):
    p = c / n
    den = 1 + z * z / n
    ctr = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return ctr - h, ctr + h


def binom_two_sided(x, m, p0):
    pr = [math.comb(m, k) * p0 ** k * (1 - p0) ** (m - k) for k in range(m + 1)]
    return sum(v for v in pr if v <= pr[x] * (1 + 1e-9))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    d = json.load(open(os.path.join(se.OUT, "층점수_수축.json"), encoding="utf-8"))
    pi = d["meta"]["전체_층비율"]
    rows1 = {}
    for name, t in d["업종"].items():
        if t["점수_나"][3] <= t["점수_나"][1]:
            continue
        n, c = t["n"], t["개수"]
        r = {"n": n, "점수_나_2층": t["점수_나"][1], "점수_나_지하": t["점수_나"][3]}
        for b in ("2층", "지하"):
            lo, hi = wilson(c[b], n)
            r[b] = {"개수": c[b], "선택비": round(c[b] / n / pi[b], 2), "95%": [round(lo / pi[b], 2), round(hi / pi[b], 2)]}
        p0 = pi["2층"] / (pi["2층"] + pi["지하"])
        r["2층대지하_p"] = round(binom_two_sided(c["2층"], c["2층"] + c["지하"], p0), 3)
        rows1[name] = r
        print(name, r, flush=True)

    # ② 헤도닉 층 계수: ols_cluster 결과를 가로채 층 열을 꺼냄
    cap = {}
    orig = bar.ols_cluster

    def spy(X, y, cl):
        b, s, r2, G = orig(X, y, cl)
        cap["b"], cap["se"], cap["V"] = b, s, None
        return b, s, r2, G
    bar.ols_cluster = spy
    listings = we.load()[0]
    res, _ = bar.hedonic(listings, lambda L: (L["구"], L["법정동"]), "환산")
    k = len(bar.LABELS) - 1
    fl = ["2층", "3층이상", "지하"]
    b = cap["b"][k + 1:k + 1 + len(fl)]
    s = cap["se"][k + 1:k + 1 + len(fl)]
    floor = {f: {"계수": round(float(bb), 3), "1층대비_%": round(100 * (math.exp(bb) - 1), 1),
                 "95%_%": [round(100 * (math.exp(bb - 1.96 * ss) - 1), 1), round(100 * (math.exp(bb + 1.96 * ss) - 1), 1)]}
             for f, bb, ss in zip(fl, b, s)}
    # 지하 대 2층 (공분산 없이 보수적 근사: 두 표준오차 제곱합)
    diff = float(b[2] - b[0])
    sd = float(math.sqrt(s[2] ** 2 + s[0] ** 2))
    floor["지하대2층"] = {"차이_%": round(100 * (math.exp(diff) - 1), 1),
                       "95%_%(근사)": [round(100 * (math.exp(diff - 1.96 * sd) - 1), 1), round(100 * (math.exp(diff + 1.96 * sd) - 1), 1)]}
    print("헤도닉 층 계수 (n", res["n"], "):", floor)

    # ③ 순위 영향: 층 점수 (나)를 쓰되 지하 ≤ 2층 상한을 걸면 (대분류, 지금 그룹 가중치·다른 인자 그대로)
    import classify_use as cu
    import factor_sensitivity as fs
    _, ext, bld, use, cfs, cost = we.load()
    band = {L["매물번호"]: cu.floor_band(L["층"]) for L in listings}
    coord = {L["매물번호"]: se.has_coord(L) for L in listings}
    basis = se.build_basis(listings, use)
    full = we.factors_with(basis, list(band), {L["매물번호"]: L for L in listings}, ext, bld, cfs, cost)
    B4 = ("1층", "2층", "3층이상", "지하")
    impact = {}
    for c in se.CATS:
        sc = d["업종"][c]["점수_나"]
        if sc[3] <= sc[1]:
            continue
        capd = sc[:3] + [min(sc[3], sc[1])]
        tot = {}
        for name, tab in (("나", sc), ("나_지하상한", capd)):
            t = dict(zip(B4, tab))
            tot[name] = {}
            for k, fac in full[c].items():
                u = fs.aggregate(fac, c)[1]
                if not se.recommendable(u, coord[k]):
                    tot[name][k] = None
                    continue
                f2 = dict(fac)
                f2["층"] = t.get(band[k]) if band[k] else None
                tot[name][k] = fs.aggregate(f2, c)[0]
        top50 = sorted((k for k, v in tot["나"].items() if v is not None), key=lambda k: -tot["나"][k])[:50]
        impact[c] = {**fs.compare(tot["나"], tot["나_지하상한"]),
                     "상위50_중_지하": sum(1 for k in top50 if band[k] == "지하"),
                     "지하_매물수": sum(1 for k, v in tot["나"].items() if v is not None and band[k] == "지하")}
        print(c, "지하 상한 영향:", impact[c], flush=True)
    json.dump({"meta": {"작성": "2026-11-25", "전체_층비율": pi, "지하_m": d["meta"]["구간별_m_베타이항(사용)"]["지하"]},
               "①지하가_2층보다_높은_업종": rows1, "②헤도닉_층계수": floor, "③지하상한_순위영향": impact},
              open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print("작성:", OUT)


if __name__ == "__main__":
    sys.exit(main())
