"""인자·그룹 계산식을 바꾸면 총점과 순위가 얼마나 움직이는지 계산한다 (v2 엔진 기준).

방법
  - 배점(영향 계수): 인자 점수가 1점 바뀔 때 총점이 바뀌는 양 = 그룹 가중치 × 그룹 안 세부 비중 ÷ 10,000
    (결측이 없을 때. 결측이 있으면 같은 그룹 안에서 비중을 다시 나누므로 남은 인자의 계수가 커진다)
  - 인자 제거 시험: 그 인자를 결측으로 두고(엔진 규칙대로 같은 그룹 안에서 재분배) 총점을 다시 계산한다.
    "계산식을 아무리 바꿔도 이 인자가 순위에 줄 수 있는 영향"의 실측 크기다.
  - 그룹 제거 시험: 그룹 전체를 빼고 다시 계산한다.
  - 기본 조건: 월세 상한 300만 원(화면 기본값), 보증금 상한 미입력, 희망 면적 미입력.
    임대료 부담+보증금은 이 조건의 후보(월세 ≤ 300만)를 줄 세운 분위수로 점수를 매긴다.

출력  data/09.스코어링/인자민감도_v2.json
실행  py -I data/scripts/factor_sensitivity.py
"""
import csv
import json
import os
import sys
from statistics import median

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scoring_engine as se  # noqa: E402

RENT_CAP = 300.0
DEPOSIT_CAP = None
OUT_JSON = os.path.join(se.OUT, "인자민감도_v2.json")


def aggregate(fac, cat):
    p = se.PRESET[cat]
    groups = {g: se.wavg([(w, fac[n]) for w, n in zip(p["s"][g], se.FACTORS[g])])[0] for g in se.GROUPS}
    total, _ = se.wavg([(p["g"][gi], groups[g]) for gi, g in enumerate(se.GROUPS)])
    used = sum(p["g"][gi] * w / 100 for gi, g in enumerate(se.GROUPS) for w, n in zip(p["s"][g], se.FACTORS[g]) if fac[n] is not None)
    return total, used


def rank(v):
    o = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(o):
        j = i
        while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]:
            j += 1
        for k in range(i, j + 1):
            r[o[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(x, y):
    rx, ry = rank(x), rank(y)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** .5
    return num / den


def compare(base, alt):
    ids = [k for k in base if base[k] is not None and alt.get(k) is not None]
    d = sorted(abs(alt[k] - base[k]) for k in ids)
    top = lambda s, n: set(sorted(ids, key=lambda k: -s[k])[:n])
    return {"순위상관": round(spearman([base[k] for k in ids], [alt[k] for k in ids]), 3),
            "평균변화": round(sum(d) / len(d), 2), "p90변화": round(d[int(.9 * (len(d) - 1))], 2), "최대변화": round(d[-1], 2),
            "상위10유지": len(top(base, 10) & top(alt, 10)), "상위50유지": len(top(base, 50) & top(alt, 50))}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(se.LISTING_CSV, encoding="utf-8-sig", newline="") as f:
        listings = list(csv.DictReader(f))
    ext = {r["매물번호"]: r for r in csv.DictReader(open(se.EXT_CSV, encoding="utf-8-sig", newline=""))}
    bld = {r["매물번호"]: r for r in csv.DictReader(open(se.BLD_CSV, encoding="utf-8-sig", newline=""))}
    use = {L["매물번호"]: se.classify_listing(L) for L in listings}
    basis = se.build_basis(listings, use)
    gd, gg = {}, {}
    for L in listings:
        r, a = se.num(L["월세"]), se.num(L["전용면적"])
        if r and a:
            gd.setdefault((L["구"], L["법정동"], L["층"].startswith("1층")), []).append(r / a)
            gg.setdefault((L["구"], L["층"].startswith("1층")), []).append(r / a)
    value_ref = {"dong": {k: median(v) for k, v in gd.items() if len(v) >= se.VALUE_MIN_N}, "gu": {k: median(v) for k, v in gg.items()}}

    cost_score, _ = se.make_cost_scorer(listings, RENT_CAP, DEPOSIT_CAP)
    coord = {L["매물번호"]: se.has_coord(L) for L in listings}
    facs = {c: {} for c in se.CATS}
    for L in listings:
        cf = se.common_factors(L, value_ref, use[L["매물번호"]])
        for c in se.CATS:
            _, _, fac, _ = se.score_listing(cf, ext.get(L["매물번호"]), bld.get(L["매물번호"]), c, basis, cost_score.get(L["매물번호"]), None)
            facs[c][L["매물번호"]] = fac

    out = {"조건": {"월세상한": RENT_CAP, "보증금상한": DEPOSIT_CAP, "희망면적": None}, "업종": {}}
    allf = [n for g in se.GROUPS for n in se.FACTORS[g]]
    for c in se.CATS:
        p = se.PRESET[c]
        base, cov = {}, {}
        for k, fac in facs[c].items():
            t, u = aggregate(fac, c)
            base[k] = t if se.recommendable(u, coord[k]) else None
            cov[k] = u
        res = {"배점": {}, "인자제거": {}, "그룹제거": {}, "인자_결측률": {}}
        for gi, g in enumerate(se.GROUPS):
            for w, n in zip(p["s"][g], se.FACTORS[g]):
                res["배점"][n] = round(p["g"][gi] * w / 100, 2)
        for n in allf:
            res["인자_결측률"][n] = round(100 * sum(1 for f in facs[c].values() if f[n] is None) / len(facs[c]), 1)
            alt = {}
            for k, fac in facs[c].items():
                f2 = dict(fac)
                f2[n] = None
                t, _ = aggregate(f2, c)
                alt[k] = t if base[k] is not None else None   # 추천 대상 판정은 원래대로 두고 점수만 비교
            res["인자제거"][n] = compare(base, alt) if res["인자_결측률"][n] < 100 else None
        for g in se.GROUPS:
            alt = {}
            for k, fac in facs[c].items():
                f2 = dict(fac)
                for n in se.FACTORS[g]:
                    f2[n] = None
                t, _ = aggregate(f2, c)
                alt[k] = t if base[k] is not None else None
            res["그룹제거"][g] = compare(base, alt)
        out["업종"][c] = res
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    for c, r in out["업종"].items():
        print("##", c)
        for n in allf:
            x = r["인자제거"][n]
            print(f"  {n:6s} 배점 {r['배점'][n]:5.2f} 결측 {r['인자_결측률'][n]:5.1f}% | " +
                  ("항상 결측" if x is None else f"순위상관 {x['순위상관']:.3f} 평균 {x['평균변화']:.2f} p90 {x['p90변화']:.2f} 최대 {x['최대변화']:.2f} 상위10 {x['상위10유지']} 상위50 {x['상위50유지']}"))
        for g, x in r["그룹제거"].items():
            print(f"  [{g}] 순위상관 {x['순위상관']:.3f} 평균 {x['평균변화']:.2f} 최대 {x['최대변화']:.2f} 상위10 {x['상위10유지']}")


if __name__ == "__main__":
    sys.exit(main())
