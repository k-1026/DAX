"""층 분포 검정 보완 (공간 › 층, 2026-11-23). 엔진(classify_use.py · scoring_engine.py)은 바꾸지 않는다.

지금 방식 (classify_use.floor_test)
  - 업종 매물의 층 분포(1층 / 2층 / 3층 이상)를 '그 업종이 포함된 전체 매물' 분포와 비교하는 적합도 카이제곱(자유도 2)
  - 설계 문서의 V = √(χ² ÷ (n × 2)) 를 Cramér's V로 표기, 강약 판정은 기준 없이 붙임

보완 (이 스크립트)
  ① 검정: 업종 매물 대 나머지 매물의 2×3 독립성 카이제곱(자유도 2). 자기 자신이 섞인 기준과 비교하지 않는다.
     18개(대분류 8 + 세부 업종 10)를 함께 보므로 Holm 보정 p도 기록한다.
  ② 효과크기: Cohen's w = √Σ (업종 비율 − 나머지 비율)² ÷ 나머지 비율.
     표본 수와 업종이 전체에서 차지하는 몫에 영향받지 않는다. 기준 0.1 작음 · 0.3 중간 · 0.5 큼 (Cohen 1988).
     참고로 2×3 표의 Cramér's V(√(χ² ÷ N))도 기록하되, 이 값은 업종 몫이 작을수록 작아지므로 강약 판정에 쓰지 않는다.
  ③ 선택비 = 업종 비율 ÷ 전체 비율과 Bonferroni 동시 신뢰구간(층 3개 → 양측 α 0.05/3, Manly 외 2002 widesI 방식).
     구간이 1을 포함하면 "1과 구분 안 됨".
  ④ 지하: 같은 방식으로 4구간(지하 포함) 선택비와 구간을 따로 계산한다. 기대 매물 수가 5건 미만이면 "표본 부족"으로 표시.
  ⑤ 지금 방식의 값(적합도 χ², p, V)도 나란히 기록해 무엇이 바뀌는지 보여 준다.

출력  data/09.스코어링/층검정_보완.json
실행  py -I data/scripts/floor_test_review.py
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

B3 = ("1층", "2층", "3층이상")
B4 = ("지하",) + B3
OUT_JSON = os.path.join(se.OUT, "층검정_보완.json")


def norm_ppf(p):
    """표준정규 분위수 (Acklam 근사, 오차 1e-9 수준)."""
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
    pl = 0.02425
    if p < pl:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    if p > 1 - pl:
        return -norm_ppf(1 - p)
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)


def chi2_sf_df2(x):
    return math.exp(-x / 2)


def selection(c, n, allc, N, bins):
    z = norm_ppf(1 - 0.05 / (2 * len(bins)))
    out = {}
    for b in bins:
        pi = allc[b] / N
        o = c[b] / n if n else 0
        se_ = math.sqrt(o * (1 - o) / n) / pi if n else 0
        lo, hi = o / pi - z * se_, o / pi + z * se_
        out[b] = {"선택비": round(o / pi, 3), "구간": [round(lo, 3), round(hi, 3)], "1과구분": not (lo <= 1 <= hi),
                  "관측": c[b], "기대": round(n * pi, 1)}
    return out, round(z, 3)


def size_label(w):
    return "큼" if w >= 0.5 else "중간" if w >= 0.3 else "작음" if w >= 0.1 else "무시할 수준"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows = list(csv.DictReader(open(se.LISTING_CSV, encoding="utf-8-sig", newline="")))
    use = {r["매물번호"]: se.classify_listing(r) for r in rows}
    band = {r["매물번호"]: cu.floor_band(r["층"]) for r in rows}
    allc = Counter(band.values())
    N3 = sum(allc[b] for b in B3)
    N4 = sum(allc[b] for b in B4)

    groups = [(c, [k for k in band if c in use[k]["cats"]]) for c in se.CATS]
    for c, (b1, b2, _) in cu.SPLIT.items():
        for sub in (b1, b2):
            groups.append((c + " / " + sub, [k for k in band if sub in use[k]["subs"].get(c, [])]))

    res = []
    for name, ks in groups:
        c = Counter(band[k] for k in ks)
        n3 = sum(c[b] for b in B3)
        n4 = sum(c[b] for b in B4)
        # 지금 방식 (전체와 적합도)
        gof = sum((c[b] - n3 * allc[b] / N3) ** 2 / (n3 * allc[b] / N3) for b in B3)
        v_now = math.sqrt(gof / (n3 * 2))
        # ① 업종 대 나머지 2×3 독립성
        rest = {b: allc[b] - c[b] for b in B3}
        nr = sum(rest.values())
        ind = 0.0
        for row, rt in ((c, n3), (rest, nr)):
            for b in B3:
                e = rt * allc[b] / N3
                ind += (row[b] - e) ** 2 / e
        v_ind = math.sqrt(ind / N3)
        # ② Cohen's w (업종 대 나머지 분포)
        w = math.sqrt(sum((c[b] / n3 - rest[b] / nr) ** 2 / (rest[b] / nr) for b in B3))
        sr3, z3 = selection(c, n3, allc, N3, B3)
        sr4, z4 = selection(c, n4, allc, N4, B4)
        res.append({"업종": name, "n": n3, "n_지하포함": n4, "지하": c["지하"],
                    "지금": {"적합도_χ2": round(gof, 1), "p": chi2_sf_df2(gof), "V": round(v_now, 2)},
                    "보완": {"독립성_χ2": round(ind, 1), "p": chi2_sf_df2(ind), "Cohen_w": round(w, 3), "효과크기": size_label(w),
                           "CramerV_2x3": round(v_ind, 3)},
                    "선택비_3구간": sr3, "선택비_지하포함": sr4})

    # Holm 보정 (독립성 p, 18개)
    order = sorted(range(len(res)), key=lambda i: res[i]["보완"]["p"])
    m = len(res)
    running = 0.0
    for rank, i in enumerate(order):
        adj = min(1.0, (m - rank) * res[i]["보완"]["p"])
        running = max(running, adj)
        res[i]["보완"]["p_Holm"] = running
        res[i]["보완"]["유의"] = running < 0.05

    meta = {"작성": "2026-11-23", "매물": len(rows), "층_판독": {b: allc[b] for b in B4}, "판독불가": allc[None],
            "z_3구간": selection(Counter(), 1, allc, N3, B3)[1], "z_4구간": selection(Counter(), 1, allc, N4, B4)[1],
            "기준": "Cohen w 0.1 작음 · 0.3 중간 · 0.5 큼 / Holm 보정 p < 0.05 유의 / 선택비 Bonferroni 동시 구간"}
    json.dump({"meta": meta, "업종": res}, open(OUT_JSON, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)

    print("작성:", OUT_JSON)
    print("전체 층(판독):", meta["층_판독"], "판독불가", meta["판독불가"])
    f = lambda p: "<0.001" if p < 0.001 else f"{p:.3f}"
    print("\n업종 | n | 지금: χ² p V | 보완: χ² p(Holm) w 효과크기 | 선택비 1층/2층/3층+ (*=1과 구분) | 지하 선택비(관측/기대)")
    for r in res:
        a, b = r["지금"], r["보완"]
        s3 = " / ".join(f"{r['선택비_3구간'][k]['선택비']:.2f}{'*' if r['선택비_3구간'][k]['1과구분'] else ''}" for k in B3)
        g = r["선택비_지하포함"]["지하"]
        print(f"{r['업종']} | {r['n']} | {a['적합도_χ2']} {f(a['p'])} {a['V']} | {b['독립성_χ2']} {f(b['p_Holm'])} {b['Cohen_w']} {b['효과크기']} | {s3} | "
              f"{g['선택비']:.2f}{'*' if g['1과구분'] else ''} ({g['관측']}/{g['기대']}{', 표본 부족' if g['기대'] < 5 else ''})")


if __name__ == "__main__":
    sys.exit(main())
