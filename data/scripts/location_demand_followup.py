"""입지 5단계 보충: 배후 수요 후보 지표의 반경·점수 곡선 (2026-11-26). 엔진은 바꾸지 않는다.

location_demand_review.py 결과에서
- 점포로 업종 신호가 뚜렷한 업종(교육·운동시설·의료·뷰티): 후보 지표의 점포 AUC를 반경 300 · 500 · 800m로 비교하고,
  가장 잘 가르는 반경에서 업종별 점포 선택비 곡선(층·면적과 같은 수축 선택비, 100 × ÷ 최대)을 만들어
  매물 라벨 AUC를 지금 점수와 비교
- 신호가 없는 업종(식음료·소매·공연문화·사무업무)용 시장 가치 공통 곡선 후보: 헤도닉(역·정류장·활성도 200m·법정동)
  계수 → 100 × exp ÷ 최대, 단조 증가 정리

출력  09.스코어링/배후수요_보완_후보.json
실행  py -I data/scripts/location_demand_followup.py
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import building_age_review as bar  # noqa: E402
import external_factors as ef  # noqa: E402
import location_activity_review as lar  # noqa: E402
import location_daegyeong_check as ldc  # noqa: E402
import location_demand_review as ldr  # noqa: E402
import location_subway_review as ls  # noqa: E402
import location_transit_ratio as ltr  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT = os.path.join(se.OUT, "배후수요_보완_후보.json")
CAND = {"교육": ["pop_6_18"], "운동시설": ["pop_6_18", "pop_20_49"], "의료": ["workers", "pop_20_49", "pop_total"], "뷰티": ["pop_total", "pop_20_49"]}
RADII = [300, 500, 800]
COMMON = ["pop_total", "pop_6_18", "pop_20_49"]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cats = se.CATS
    pops = ef.load_population()
    pts, vals, stat = ef.build_oa_points(pops)
    plon = np.array([p[0] for p in pts])
    plat = np.array([p[1] for p in pts])
    W = np.array([[vals[p[2]][k] for k in ldr.KEYS] for p in pts])
    px, py = lar.proj(plat, plon)
    S, src = ls.store_rows()
    slat = np.array([s[0] for s in S])
    slon = np.array([s[1] for s in S])
    lab = np.array([s[2] or "" for s in S], dtype=object)
    sx, sy = lar.proj(slat, slon)
    sv = ldr.sums_at(sx, sy, px, py, W, RADII)
    classified = lab != ""

    metro, dk, M, K = ldc.station_rows()
    both = np.vstack([M, K])
    listings, ext, bld, use, cfs, cost = we.load()
    rows, lat, lon, dbus, keys = [], [], [], [], []
    for L in listings:
        la, lo, area, r, db = se.num(L["위도"]), se.num(L["경도"]), se.num(L["전용면적"]), se.converted_rent(L), se.num(L["정류소거리_m"])
        if la is None or lo is None or db is None or not area or not r or r <= 0:
            continue
        rows.append((L, area, r, bar.age_of(L)))
        lat.append(la)
        lon.append(lo)
        dbus.append(db)
        keys.append(L["매물번호"])
    lat, lon, dbus = np.array(lat), np.array(lon), np.array(dbus)
    lx, ly = lar.proj(lat, lon)
    lv = ldr.sums_at(lx, ly, px, py, W, RADII)
    kidx = {k: i for i, k in enumerate(keys)}
    labeled = [k for k in keys if use[k]["cats"]]
    li = np.array([kidx[k] for k in labeled])

    spec = {}
    for c, cand in CAND.items():
        y = (lab[classified] == c).astype(int)
        res = {}
        for k in cand:
            j = ldr.KEYS.index(k)
            aucs = {"%dm" % rr: round(ls.fast_auc(sv[ri, classified, j], y), 3) for ri, rr in enumerate(RADII)}
            ri = int(np.argmax([aucs["%dm" % rr] for rr in RADII]))
            v = sv[ri, :, j]
            edges = list(np.quantile(v, [i / 10 for i in range(1, 10)]))
            b = ls.bins_of(v, edges)
            sr, m, pi, cnt = ls.shrunk_sr(b, lab, 10, se.CATS)
            centers = [float(np.median(v[b == q])) for q in range(10)]
            curve = ls.curve(sr[c], centers)
            yl = np.array([1 if c in use[kk]["cats"] else 0 for kk in labeled])
            cur = np.array([se.num(ext[kk].get("배후수요_" + c)) if ext.get(kk) else np.nan for kk in labeled], float)
            cur = np.where(np.isnan(cur), np.nanmedian(cur), cur)
            cand_s = np.array([se.interp(curve, x) for x in lv[ri, li, j]])
            t = ls.test_table(b, lab, 10, [c])[c]
            res[ldr.NAMES[k]] = {"점포AUC_반경별": aucs, "고른_반경": RADII[ri], "w": t["w"],
                                "선택비_10분위": [round(x, 3) for x in sr[c]], "곡선": [(round(x), round(s_, 1)) for x, s_ in curve],
                                "매물라벨AUC_지금": round(ls.fast_auc(cur, yl), 3), "매물라벨AUC_곡선": round(ls.fast_auc(cand_s, yl), 3)}
        spec[c] = res

    # 공통 곡선 후보 (시장 가치)
    sx_, sy_ = sx, sy
    act200 = lar.counts_at(lx, ly, sx_, sy_, [200])[:, 0].astype(float)
    dsub = ls.nearest_dist(lat, lon, both)
    e_act = sorted(set(np.quantile(act200, [i / 10 for i in range(1, 10)]).tolist()))
    base = [(ltr.SUB_EDGES_J, dsub), (ltr.BUS_EDGES, dbus), (e_act, act200)]
    fe = lambda L: (L["구"], L["법정동"])
    common = {}
    for k in COMMON:
        j = ldr.KEYS.index(k)
        v = lv[0, :, j]
        e = sorted(set(np.quantile(v, [i / 10 for i in range(1, 10)]).tolist()))
        coefs, ses, r2, G = ltr.fit(rows, base + [(e, v)], fe)
        c_ = coefs[3]
        bins = np.searchsorted(e, v, side="left")
        cntb = [int((bins == q).sum()) for q in range(len(e) + 1)]
        raw = [100 * math.exp(x) / math.exp(max(c_)) for x in c_]
        mono = bar.pava_decreasing(raw[::-1], cntb[::-1])[::-1]
        med = [float(np.median(v[bins == q])) for q in range(len(e) + 1)]
        pts_ = []
        for x, s_ in zip(med, mono):
            if pts_ and abs(s_ - pts_[-1][1]) < 1e-9:
                continue
            pts_.append((round(x), round(s_, 1)))
        common[ldr.NAMES[k] + "_300m"] = {"점수_원래": [round(x, 1) for x in raw], "점수_단조": [round(x, 1) for x in mono],
                                         "구간_가운데": [round(x) for x in med], "곡선": pts_}

    out = {"meta": {"작성": "2026-11-26", "정답지": src}, "업종별_후보": spec, "공통_시장가치_후보": common}
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    for c, res in spec.items():
        for k, r in res.items():
            print(c, k, r["점포AUC_반경별"], "고른", r["고른_반경"], "w", r["w"], "| 라벨AUC 지금", r["매물라벨AUC_지금"], "→ 곡선", r["매물라벨AUC_곡선"], "|", r["곡선"])
    for k, r in common.items():
        print("공통", k, r["곡선"])


if __name__ == "__main__":
    sys.exit(main())
