"""입지 인자 일관성 검증: 업종별 곡선 vs 시장 가치 공통 곡선 vs 없음 (2026-11-26). 엔진은 바꾸지 않는다.

D14(활성도)는 업종 차이가 작다고 공통 곡선, D15(배후 수요)는 업종별 곡선을 검토해 기준이 어긋난다는 지적에 따라,
사용자가 정한 "후보 추리기" 기준(상위 후보 적합 비율 + 전체 AUC)을 교통 · 활성도 · 배후 수요에 똑같이 적용한다.

기준점(모든 업종): 교통 = D11 · D12 · 60 : 40 공통, 활성도 = D14 200m 공통, 배후 수요 = 없음
한 인자씩 바꿈
  T_없음 / A_없음   교통 또는 활성도를 뺌 (입지 그룹 안에서 비중 재분배)
  T_업종별   지하철을 업종별 점포 선택비 곡선(1단계 10분위, 수축)으로, 버스는 공통
  A_업종별   활성도를 업종별 점포 선택비 곡선(4단계, 300m 10분위)으로
  D_전체인구 / D_6~18세 / D_20~49세   배후 수요 시장 가치 공통 곡선(300m)
  D_업종별   배후 수요 업종별 점포 선택비 곡선(300m). 지표: 교육·운동시설 6~18세, 의료 종사자, 뷰티 전체 인구, 나머지는 지금 지표
비교 점수: 비용 + 공간 + 입지 (업종 적합 제외, location_demand_topk.py와 같음)
지표: AUC, 상위 50, 구별 상위 10 평균. 기준점 대비 차이의 매물 부트스트랩 1,000회 95% 구간

출력  09.스코어링/입지_일관성_검증.json
실행  py -I data/scripts/location_unified_check.py
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
import location_demand_topk as ldt  # noqa: E402
import location_subway_review as ls  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT = os.path.join(se.OUT, "입지_일관성_검증.json")
DSPEC = {"교육": ["pop_6_18"], "운동시설": ["pop_6_18"], "의료": ["workers"], "뷰티": ["pop_total"],
         "식음료": ["pop_20_59", "workers"], "소매": ["pop_total"], "공연문화": ["pop_20_39"], "사무업무": ["workers"]}
COMMON_D = {"D_전체인구": ("전체 인구_300m", "pop_total"), "D_6~18세": ("6~18세_300m", "pop_6_18"), "D_20~49세": ("20~49세_300m", "pop_20_49")}
B = 1000


def sr_curve_from_store(values, lab, c):
    edges = list(np.quantile(values, [i / 10 for i in range(1, 10)]))
    b = ls.bins_of(values, edges)
    sr, *_ = ls.shrunk_sr(b, lab, 10, se.CATS)
    centers = [float(np.median(values[b == q])) for q in range(10)]
    return ls.curve(sr[c], centers)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cand = json.load(open(os.path.join(se.OUT, "배후수요_보완_후보.json"), encoding="utf-8"))
    sub = json.load(open(os.path.join(se.OUT, "지하철거리_보완.json"), encoding="utf-8"))
    sub_centers = sub["meta"]["구간_가운데_m"]
    sub_curves = {c: [(x, y) for x, y in zip(sub_centers, sub["③선택비_10분위"][c]["점수"])] for c in se.CATS}
    common_d = {v: [tuple(p) for p in cand["공통_시장가치_후보"][k]["곡선"]] for v, (k, _) in COMMON_D.items()}

    pops = ef.load_population()
    pts, vals, _ = ef.build_oa_points(pops)
    W = np.array([[vals[p[2]][k] for k in ldr.KEYS] for p in pts])
    px, py = lar.proj(np.array([p[1] for p in pts]), np.array([p[0] for p in pts]))
    S, src = ls.store_rows()
    lab = np.array([s[2] or "" for s in S], dtype=object)
    sx, sy = lar.proj(np.array([s[0] for s in S]), np.array([s[1] for s in S]))
    s_act = lar.counts_at(sx, sy, sx, sy, [300], exclude_self=True)[:, 0].astype(float)
    s_pop = ldr.sums_at(sx, sy, px, py, W, [300])[0]

    def store_ind(c):
        return sum(s_pop[:, ldr.KEYS.index(k)] for k in DSPEC[c])

    act_curves = {c: sr_curve_from_store(s_act, lab, c) for c in se.CATS}
    dem_curves = {c: sr_curve_from_store(store_ind(c), lab, c) for c in se.CATS}

    metro, dk, M, K = ldc.station_rows()
    both = np.vstack([M, K])
    listings, ext, bld, use, cfs, cost = we.load()
    v2 = {r["매물번호"]: r for r in csv.DictReader(open(os.path.join(se.OUT, "점수_v2.csv"), encoding="utf-8-sig", newline=""))}
    keys, lat, lon, dbus, gu = [], [], [], [], []
    for L in listings:
        la, lo = se.num(L["위도"]), se.num(L["경도"])
        if la is None or lo is None or not use[L["매물번호"]]["cats"]:
            continue
        keys.append(L["매물번호"])
        lat.append(la)
        lon.append(lo)
        dbus.append(se.num(L["정류소거리_m"]))
        gu.append(L["구"])
    lat, lon, gu = np.array(lat), np.array(lon), np.array(gu)
    n = len(keys)
    dsub = ls.nearest_dist(lat, lon, both)
    Bs = np.array([se.interp(ldt.D12, x) if x is not None else np.nan for x in dbus])
    lx, ly = lar.proj(lat, lon)
    lc = lar.counts_at(lx, ly, sx, sy, [200, 300])
    l_pop = ldr.sums_at(lx, ly, px, py, W, [300])[0]

    def transit(S_):
        return np.where(np.isnan(Bs), S_, 0.6 * S_ + 0.4 * np.nan_to_num(Bs))

    def parts(c, variant):
        S_ = np.array([se.interp(sub_curves[c] if variant == "T_업종별" else ldt.D11, x) for x in dsub])
        T = transit(S_) if variant != "T_없음" else np.full(n, np.nan)
        if variant == "A_없음":
            A = np.full(n, np.nan)
        elif variant == "A_업종별":
            A = np.array([se.interp(act_curves[c], x) for x in lc[:, 1]])
        else:
            A = np.array([se.interp(ldt.D14, x) for x in lc[:, 0]])
        if variant in common_d:
            col = ldr.KEYS.index(COMMON_D[variant][1])
            D = np.array([se.interp(common_d[variant], x) for x in l_pop[:, col]])
        elif variant == "D_업종별":
            ind = sum(l_pop[:, ldr.KEYS.index(k)] for k in DSPEC[c])
            D = np.array([se.interp(dem_curves[c], x) for x in ind])
        else:
            D = np.full(n, np.nan)
        return T, A, D

    def total(c, variant):
        w = se.PRESET[c]["s"]["입지"]
        T, A, D = parts(c, variant)
        num_ = sum(np.where(np.isnan(x), 0, wi * x) for wi, x in zip(w, (T, A, D)))
        den = sum(np.where(np.isnan(x), 0, wi) for wi, x in zip(w, (T, A, D)))
        loc = np.where(den > 0, num_ / np.maximum(den, 1e-9), np.nan)
        g = se.PRESET[c]["g"]
        ps = [(g[gi], np.array([se.num(v2[k].get(nm + "_" + c)) if k in v2 else None for k in keys], dtype=float)) for gi, nm in enumerate(["비용", "공간"])]
        ps.append((g[2], loc))
        return sum(wt * np.nan_to_num(x) for wt, x in ps) / sum(wt * (~np.isnan(x)) for wt, x in ps)

    rng = np.random.default_rng(20261126)
    boot = [rng.integers(0, n, n) for _ in range(B)]
    fns = {"AUC": lambda s, y, g: ls.fast_auc(s, y), "상위50": lambda s, y, g: ldt.prec_at(s, y, 50),
           "구별상위10": lambda s, y, g: ldt.gu_prec(s, y, g)[0]}
    variants = ["기준", "T_없음", "T_업종별", "A_없음", "A_업종별", *COMMON_D, "D_업종별"]
    res = {}
    for c in se.CATS:
        y = np.array([1 if c in use[k]["cats"] else 0 for k in keys])
        sc = {v: total(c, v) for v in variants}
        r = {"무작위": round(float(y.mean()), 3)}
        for v in variants:
            r[v] = {m: round(f(sc[v], y, gu), 3) for m, f in fns.items()}
            if v != "기준":
                ci = {}
                for m, f in fns.items():
                    d = [f(sc[v][ii], y[ii], gu[ii]) - f(sc["기준"][ii], y[ii], gu[ii]) for ii in boot]
                    lo_, hi_ = float(np.quantile(d, .025)), float(np.quantile(d, .975))
                    ci[m] = [round(lo_, 3), round(hi_, 3), "오름" if lo_ > 0 else ("내림" if hi_ < 0 else "구분 안 됨")]
                r[v]["기준대비_95%"] = ci
        res[c] = r
        print("\n==", c, "무작위", r["무작위"], "기준", r["기준"])
        for v in variants[1:]:
            print("  ", v, {m: r[v][m] for m in fns}, {m: r[v]["기준대비_95%"][m][2] for m in fns})

    out = {"meta": {"작성": "2026-11-26", "표본": n, "부트스트랩": B, "기준": "교통 D11·D12·60:40 공통, 활성도 D14 200m 공통, 배후 수요 없음",
                    "배후수요_업종별_지표": DSPEC, "비교점수": "비용 + 공간 + 입지 (업종 적합 제외)"},
           "결과": res}
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.exit(main())
