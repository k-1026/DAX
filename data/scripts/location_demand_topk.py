"""입지 5단계 재검토: 배후 수요 공통 곡선을 넣으면 상위 추천 후보가 실제로 좋아지는가 (2026-11-26). 엔진은 바꾸지 않는다.

목적이 "후보 추리기"라서 전체 AUC와 함께 상위 K개 중 적합 후보 비율(정밀도)을 본다.

검증 자료: 중개사 추천용도·특징 라벨(classify_use v2). 입지 점수는 이 라벨을 쓰지 않으므로(헤도닉·실제 점포로 만듦) 별도 검증이 된다.
  - 표본: 좌표가 있고 라벨이 하나 이상 있는 매물. 적합 = 그 업종 라벨, 부적합 = 다른 업종만 라벨
  - 라벨 없는 매물은 적합 여부를 모르므로 뺌
비교 점수
  ① 입지 그룹 점수 (주 지표): D11~D14 결정 곡선(지하철 대경선 포함 · 버스 · 60:40 · 활성도 200m) + 배후 수요 변형, 지금 입지 그룹 안 비중
  ② 비용 + 공간 + 입지 (업종 적합 제외, 점수_v2 그룹 점수 사용): 실제 순위에 가까운 보조 지표.
     업종 적합은 라벨을 그대로 쓰므로 뺌. 공간 층·면적 곡선도 라벨로 만들었지만 변형 사이에 똑같이 들어가 비교는 공정
배후 수요 변형 (나머지 5개 업종 = 식음료·소매·뷰티·공연문화·사무업무)
  V0 지금 식 (백분위)  V1 공통 6~18세 300m 곡선  V2 공통 20~49세 300m 곡선  V3 배후 수요 없음(입지 = 교통 + 활성도, 비중 재분배)
  참고: 교육·운동시설·의료는 업종별 곡선(6~18세·6~18세·종사자 300m) vs 지금 식 vs 없음
지표: AUC, 상위 10 · 20 · 50 · 100 적합 비율, 구별 상위 10 적합 비율 평균. 변형 차이는 매물 부트스트랩 1,000회 95% 구간

출력  09.스코어링/배후수요_상위후보_검증.json
실행  py -I data/scripts/location_demand_topk.py
"""
import csv
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import external_factors as ef  # noqa: E402
import location_activity_review as lar  # noqa: E402
import location_daegyeong_check as ldc  # noqa: E402
import location_demand_review as ldr  # noqa: E402
import location_subway_review as ls  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT = os.path.join(se.OUT, "배후수요_상위후보_검증.json")
D11 = [(163, 100.0), (355, 85.6), (633, 72.8)]
D12 = [(41, 100.0), (82, 92.4), (120, 92.4), (183, 90.6), (285, 78.5)]
D14 = [(44, 70.5), (76, 71.1), (121, 72.3), (165, 81.4), (194, 90.0), (229, 92.7), (446, 100.0)]
COMMON = {"V1_공통_6~18세": "6~18세_300m", "V2_공통_20~49세": "20~49세_300m"}
SPEC_CURVE = {"교육": ("6~18세", "pop_6_18"), "운동시설": ("6~18세", "pop_6_18"), "의료": ("종사자", "workers")}
FIVE = ["식음료", "소매", "뷰티", "공연문화", "사무업무"]
KS = [10, 20, 50, 100]
B = 1000


def prec_at(score, y, k):
    o = np.argsort(-score, kind="mergesort")[:k]
    return float(y[o].mean())


def gu_prec(score, y, gu, k=10):
    vals = []
    for g in np.unique(gu):
        m = gu == g
        if m.sum() >= k:
            vals.append(prec_at(score[m], y[m], k))
    return float(np.mean(vals)), len(vals)


def metrics(score, y, gu):
    out = {"AUC": round(ls.fast_auc(score, y), 3)}
    for k in KS:
        out["상위%d" % k] = round(prec_at(score, y, k), 3)
    g, ng = gu_prec(score, y, gu)
    out["구별상위10_평균"] = round(g, 3)
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cand = json.load(open(os.path.join(se.OUT, "배후수요_보완_후보.json"), encoding="utf-8"))
    common_curves = {v: [tuple(p) for p in cand["공통_시장가치_후보"][k]["곡선"]] for v, k in COMMON.items()}
    spec_curves = {c: [tuple(p) for p in cand["업종별_후보"][c][nm]["곡선"]] for c, (nm, _) in SPEC_CURVE.items()}

    pops = ef.load_population()
    pts, vals, stat = ef.build_oa_points(pops)
    plon = np.array([p[0] for p in pts])
    plat = np.array([p[1] for p in pts])
    W = np.array([[vals[p[2]][k] for k in ldr.KEYS] for p in pts])
    px, py = lar.proj(plat, plon)
    S, src = ls.store_rows()
    sx, sy = lar.proj(np.array([s[0] for s in S]), np.array([s[1] for s in S]))

    metro, dk, M, K = ldc.station_rows()
    both = np.vstack([M, K])
    listings, ext, bld, use, cfs, cost = we.load()
    v2 = {r["매물번호"]: r for r in csv.DictReader(open(os.path.join(se.OUT, "점수_v2.csv"), encoding="utf-8-sig", newline=""))}
    keys, lat, lon, dbus, gu = [], [], [], [], []
    for L in listings:
        la, lo, db = se.num(L["위도"]), se.num(L["경도"]), se.num(L["정류소거리_m"])
        if la is None or lo is None or not use[L["매물번호"]]["cats"]:
            continue
        keys.append(L["매물번호"])
        lat.append(la)
        lon.append(lo)
        dbus.append(db)
        gu.append(L["구"])
    lat, lon, gu = np.array(lat), np.array(lon), np.array(gu)
    dsub = ls.nearest_dist(lat, lon, both)
    S_ = np.array([se.interp(D11, x) for x in dsub])
    B_ = np.array([se.interp(D12, x) if x is not None else np.nan for x in dbus])
    lx, ly = lar.proj(lat, lon)
    act = lar.counts_at(lx, ly, sx, sy, [200])[:, 0]
    A_ = np.array([se.interp(D14, x) for x in act])
    lv = ldr.sums_at(lx, ly, px, py, W, [300])[0]
    pop = {k: lv[:, j] for j, k in enumerate(ldr.KEYS)}
    n = len(keys)

    def transit(c):
        sw = 0.6                                                          # D13: 전 업종 60 : 40
        return np.where(np.isnan(B_), S_, sw * S_ + (1 - sw) * np.nan_to_num(B_))

    def demand(c, variant):
        if variant == "V0_지금":
            return np.array([se.num(ext[k].get("배후수요_" + c)) if ext.get(k) and ext[k].get("배후수요_" + c) not in ("", None) else np.nan for k in keys], float)
        if variant == "V3_없음":
            return np.full(n, np.nan)
        if variant in common_curves:
            col = "pop_6_18" if "6~18" in variant else "pop_20_49"
            return np.array([se.interp(common_curves[variant], x) for x in pop[col]])
        if variant == "업종별":
            return np.array([se.interp(spec_curves[c], x) for x in pop[SPEC_CURVE[c][1]]])
        raise ValueError(variant)

    def loc_score(c, variant):
        w = se.PRESET[c]["s"]["입지"]
        T, D = transit(c), demand(c, variant)
        num_ = w[0] * T + w[1] * A_ + np.where(np.isnan(D), 0, w[2] * D)
        den = w[0] + w[1] + np.where(np.isnan(D), 0, w[2])
        return num_ / den

    def other_score(c, loc):
        g = se.PRESET[c]["g"]
        parts = []
        for gi, name in enumerate(["비용", "공간"]):
            parts.append((g[gi], np.array([se.num(v2[k].get(name + "_" + c)) if k in v2 else None for k in keys], dtype=float)))
        parts.append((g[2], loc))
        num_ = sum(w * np.nan_to_num(x) for w, x in parts)
        den = sum(w * (~np.isnan(x)) for w, x in parts)
        return num_ / den

    rng = np.random.default_rng(20261126)
    boot_idx = [rng.integers(0, n, n) for _ in range(B)]

    def boot_diff(sa, sb, y, fn):
        d = []
        for ii in boot_idx:
            d.append(fn(sa[ii], y[ii], gu[ii]) - fn(sb[ii], y[ii], gu[ii]))
        return [round(float(np.quantile(d, .025)), 3), round(float(np.quantile(d, .975)), 3)]

    f_auc = lambda s, y, g: ls.fast_auc(s, y)
    f_p50 = lambda s, y, g: prec_at(s, y, 50)
    f_gu10 = lambda s, y, g: gu_prec(s, y, g)[0]

    res = {}
    for c in se.CATS:
        y = np.array([1 if c in use[k]["cats"] else 0 for k in keys])
        variants = ["V0_지금", *COMMON, "V3_없음"] if c in FIVE else ["V0_지금", "업종별", "V3_없음"]
        r = {"표본": n, "적합": int(y.sum()), "적합_비율(무작위 기준)": round(float(y.mean()), 3)}
        sc = {}
        for v in variants:
            loc = loc_score(c, v)
            tot = other_score(c, loc)
            sc[v] = (loc, tot)
            r[v] = {"입지점수": metrics(loc, y, gu), "비용+공간+입지": metrics(tot, y, gu)}
        ref = "V3_없음"
        r["차이_95%"] = {}
        for v in variants:
            if v == ref:
                continue
            r["차이_95%"][v + " − 없음"] = {
                "입지_AUC": boot_diff(sc[v][0], sc[ref][0], y, f_auc), "입지_상위50": boot_diff(sc[v][0], sc[ref][0], y, f_p50),
                "입지_구별상위10": boot_diff(sc[v][0], sc[ref][0], y, f_gu10),
                "합계_AUC": boot_diff(sc[v][1], sc[ref][1], y, f_auc), "합계_상위50": boot_diff(sc[v][1], sc[ref][1], y, f_p50),
                "합계_구별상위10": boot_diff(sc[v][1], sc[ref][1], y, f_gu10)}
        res[c] = r

    out = {"meta": {"작성": "2026-11-26", "검증자료": "중개사 추천용도·특징 라벨 (classify_use v2), 좌표·라벨 있는 매물", "표본": n,
                    "구": sorted(set(gu.tolist())), "부트스트랩": B,
                    "입지_그룹안_비중": {c: se.PRESET[c]["s"]["입지"] for c in se.CATS}, "그룹_비중": {c: se.PRESET[c]["g"] for c in se.CATS},
                    "읽는법": "적합 비율이 무작위 기준보다 높을수록 좋음. 차이_95%가 0을 포함하면 구분 안 됨"},
           "결과": res}
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    for c, r in res.items():
        print("\n==", c, "표본", r["표본"], "적합", r["적합"], "무작위", r["적합_비율(무작위 기준)"])
        for v in r:
            if v.startswith("V") or v == "업종별":
                print("  ", v, "입지", r[v]["입지점수"], "| 합계", r[v]["비용+공간+입지"])
        for v, d in r["차이_95%"].items():
            print("   Δ", v, d)


if __name__ == "__main__":
    sys.exit(main())
