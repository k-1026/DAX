"""입지 5단계: 배후 수요 (2026-11-26). 엔진은 바꾸지 않는다.

지금 식 (external_factors.py, 집계구 방식 v1.1): 업종 반경(300m / 교육·사무업무·운동시설 500m) 안 업종별 지표 합 → 좌표 있는 대구 매물 중 백분위.
  식음료 20~59세 50 + 종사자 50 · 소매 전체 인구 · 뷰티 20~49세 · 공연문화 20~39세 · 교육 6~18세
  의료 전체 50 + 65세 이상 50 · 운동시설 20~49세 · 사무업무 종사자
비교판 판정: 백분위 정규화 있음, 반경 500m 부분, 업종별 연령 지표 없음(가설).

D11~D14와 같은 순서
① 업종마다 배후 인구 구성이 다른가 (= 업종별 연령 지표에 근거가 있나):
   실제 점포마다 500m 안 인구·종사자 합과 연령 비율(그 연령 ÷ 전체 인구)을 재고,
   업종 대 나머지(분류된 점포) AUC를 지표마다 계산. 업종마다 가장 잘 가르는 지표 = 그 업종의 실제 배후 고객 신호
   + 지금 지표 10분위 Cohen w
② 매물 라벨 AUC: 지금 점수 vs 다른 지표
③ 시장 가치: 헤도닉(역·정류장 거리 + 상권 활성도 200m 10분위 + 법정동 고정)에 지표 합 10분위를 넣음.
   반경 300 · 500 · 800 · 1000m, 지표 7개를 같은 틀로 비교 (AIC 개선)

출력  09.스코어링/배후수요_보완.json
실행  py -I data/scripts/location_demand_review.py
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
import location_subway_review as ls  # noqa: E402
import location_transit_ratio as ltr  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT = os.path.join(se.OUT, "배후수요_보완.json")
KEYS = ["pop_total", "pop_6_18", "pop_20_39", "pop_20_49", "pop_20_59", "pop_65p", "workers"]
NAMES = {"pop_total": "전체 인구", "pop_6_18": "6~18세", "pop_20_39": "20~39세", "pop_20_49": "20~49세",
         "pop_20_59": "20~59세", "pop_65p": "65세 이상", "workers": "종사자"}
AGE = ["pop_6_18", "pop_20_39", "pop_20_49", "pop_20_59", "pop_65p"]
STORE_R = 500
RADII = [300, 500, 800, 1000]


def sums_at(qx, qy, px, py, W, radii):
    """질의점마다 반경 안 표본점 값 합. 반환 (len(radii), n질의, 지표수)."""
    cell = max(radii)
    gx, gy = np.floor(px / cell).astype(int), np.floor(py / cell).astype(int)
    buckets = {}
    for i, key in enumerate(zip(gx, gy)):
        buckets.setdefault(key, []).append(i)
    buckets = {k: np.array(v) for k, v in buckets.items()}
    qgx, qgy = np.floor(qx / cell).astype(int), np.floor(qy / cell).astype(int)
    qcells = {}
    for i, key in enumerate(zip(qgx, qgy)):
        qcells.setdefault(key, []).append(i)
    out = np.zeros((len(radii), len(qx), W.shape[1]))
    r2 = np.array(radii, float) ** 2
    for (cx, cy), qi in qcells.items():
        cand = [buckets[(cx + a, cy + b)] for a in (-1, 0, 1) for b in (-1, 0, 1) if (cx + a, cy + b) in buckets]
        if not cand:
            continue
        cand = np.concatenate(cand)
        qi = np.array(qi)
        for s0 in range(0, len(qi), 400):
            q = qi[s0:s0 + 400]
            d2 = (qx[q][:, None] - px[cand][None, :]) ** 2 + (qy[q][:, None] - py[cand][None, :]) ** 2
            for k, rr in enumerate(r2):
                out[k, q] = (d2 <= rr).astype(float) @ W[cand]
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cats = se.CATS
    pops = ef.load_population()
    pts, vals, stat = ef.build_oa_points(pops)
    plon = np.array([p[0] for p in pts])
    plat = np.array([p[1] for p in pts])
    W = np.array([[vals[p[2]][k] for k in KEYS] for p in pts])
    px, py = lar.proj(plat, plon)

    # ① 점포 쪽
    S, src = ls.store_rows()
    slat = np.array([s[0] for s in S])
    slon = np.array([s[1] for s in S])
    lab = np.array([s[2] or "" for s in S], dtype=object)
    sx, sy = lar.proj(slat, slon)
    sv = sums_at(sx, sy, px, py, W, [STORE_R])[0]
    tot = sv[:, 0]
    share = {k: np.where(tot > 0, sv[:, KEYS.index(k)] / np.maximum(tot, 1), np.nan) for k in AGE}
    classified = lab != ""
    store_auc = {}
    for c in cats:
        y = (lab[classified] == c).astype(int)
        row = {}
        for j, k in enumerate(KEYS):
            row["합_" + NAMES[k]] = round(ls.fast_auc(sv[classified, j], y), 3)
        for k in AGE:
            v = share[k][classified]
            ok = ~np.isnan(v)
            row["비율_" + NAMES[k]] = round(ls.fast_auc(v[ok], y[ok]), 3)
        store_auc[c] = row
    # 지금 지표(500m 합, 가중 평균은 백분위 평균이라 여기서는 지표 합의 순위 평균으로 근사)
    cur_store = {}
    rank = {k: np.argsort(np.argsort(sv[:, j])) / len(sv) for j, k in enumerate(KEYS)}
    for c in cats:
        spec = ef.DEMAND_SPEC_OA[c]
        v = sum(w * rank[k] for k, w in spec)
        edges = list(np.quantile(v, [i / 10 for i in range(1, 10)]))
        b = ls.bins_of(v, edges)
        t = ls.test_table(b, lab, 10, [c])[c]
        y = (lab[classified] == c).astype(int)
        cur_store[c] = {"지표": " + ".join("%s %d" % (NAMES[k], round(100 * w)) for k, w in spec), "w": t["w"],
                        "AUC": round(ls.fast_auc(v[classified], y), 3)}

    # 매물
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
    dsub = ls.nearest_dist(lat, lon, both)
    lx, ly = lar.proj(lat, lon)
    act200 = lar.counts_at(lx, ly, sx, sy, [200])[:, 0].astype(float)
    lv = sums_at(lx, ly, px, py, W, RADII)
    # 외부인자 파일 값과 같은지 (300·500m 전체 인구)
    chk = {}
    for ri, rr in ((0, 300), (1, 500)):
        given = np.array([se.num(ext.get(k, {}).get("반경pop_total_%dm" % rr)) or np.nan for k in keys], float)
        ok = ~np.isnan(given)
        rel = np.abs(lv[ri, ok, 0] - given[ok]) / np.maximum(given[ok], 1)
        chk["%dm" % rr] = {"n": int(ok.sum()), "1%_안_같음_%": round(100 * float((rel <= 0.01).mean()), 1)}

    # ② 매물 라벨 AUC
    kidx = {k: i for i, k in enumerate(keys)}
    labeled = [k for k in keys if use[k]["cats"]]
    li = np.array([kidx[k] for k in labeled])
    auc = {}
    for c in cats:
        y = np.array([1 if c in use[k]["cats"] else 0 for k in labeled])
        cur = np.array([se.num(ext[k].get("배후수요_" + c)) if ext.get(k) else np.nan for k in labeled], float)
        cur = np.where(np.isnan(cur), np.nanmedian(cur), cur)
        ri = RADII.index(ef.RADIUS[c])
        row = {"지금": round(ls.fast_auc(cur, y), 3)}
        for j, k in enumerate(KEYS):
            row["합_" + NAMES[k]] = round(ls.fast_auc(lv[ri, li, j], y), 3)
        tt = lv[ri, li, 0]
        for k in AGE:
            row["비율_" + NAMES[k]] = round(ls.fast_auc(np.where(tt > 0, lv[ri, li, KEYS.index(k)] / np.maximum(tt, 1), 0), y), 3)
        auc[c] = row

    # ③ 헤도닉
    e_act = sorted(set(np.quantile(act200, [i / 10 for i in range(1, 10)]).tolist()))
    base = [(ltr.SUB_EDGES_J, dsub), (ltr.BUS_EDGES, dbus), (e_act, act200)]
    fe_dong = lambda L: (L["구"], L["법정동"])
    fe_gu = lambda L: L["구"]
    X0, y0, *_ = ltr.design(rows, base, fe_dong)
    tss = float(((y0 - y0.mean()) ** 2).sum())
    n = len(rows)
    hed = {}
    for fe_name, fe in (("법정동", fe_dong), ("구", fe_gu)):
        _, _, r2b, _ = ltr.fit(rows, base, fe)
        res = {"기준_R2": round(r2b, 4)}
        for ri, rr in enumerate(RADII):
            for j, k in enumerate(KEYS):
                v = lv[ri, :, j]
                e = sorted(set(np.quantile(v, [i / 10 for i in range(1, 10)]).tolist()))
                coefs, ses, r2, G = ltr.fit(rows, base + [(e, v)], fe)
                c = coefs[3]
                d_aic = n * math.log((1 - r2b) / (1 - r2)) - 2 * len(e)
                res["%s_%dm" % (NAMES[k], rr)] = {"AIC_개선": round(d_aic, 1), "R2": round(r2, 4),
                                                 "차이_%": [round(100 * (math.exp(x) - 1), 1) for x in c],
                                                 "최고10%_95%": [round(100 * (math.exp(c[-1] - 1.96 * ses[3][-1]) - 1), 1),
                                                               round(100 * (math.exp(c[-1] + 1.96 * ses[3][-1]) - 1), 1)]}
        hed[fe_name] = res
    corr_act = {"%s_%dm" % (NAMES[k], rr): round(float(np.corrcoef(np.log1p(lv[ri, :, j]), np.log1p(act200))[0, 1]), 3)
                for ri, rr in enumerate(RADII) for j, k in enumerate(KEYS)}

    out = {"meta": {"작성": "2026-11-26", "정답지": src + " (약국 제외)", "점포": len(S), "분류된_점포": int(classified.sum()), "매물": n,
                    "인구": "행안부 주민등록 2026-10 행정동 연령 → SGIS 집계구 10세 비율로 배분, 종사자 SGIS 2024 (기존 자료)",
                    "집계구": stat, "외부인자_값과_같은지": chk, "상권활성도200m와_상관_log": corr_act,
                    "읽는법": "① AUC 0.5 = 구분 못함, 0.6 넘으면 뚜렷. 업종마다 가장 높은 지표가 실제 배후 고객 신호. ③ AIC 개선 10 넘으면 뚜렷"},
           "①점포_지표별_AUC_500m": store_auc, "①지금지표_점포": cur_store,
           "②매물라벨_AUC": auc, "③헤도닉": hed}
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print(json.dumps({k: out["meta"][k] for k in ("점포", "분류된_점포", "매물", "외부인자_값과_같은지")}, ensure_ascii=False))
    print("\n① 점포 AUC (500m)")
    for c in cats:
        r = store_auc[c]
        best = max(r, key=lambda x: abs(r[x] - 0.5))
        print(c, "지금", cur_store[c], "| 가장 가르는:", best, r[best], "|", r)
    print("\n② 매물 라벨 AUC")
    for c in cats:
        r = auc[c]
        best = max((x for x in r if x != "지금"), key=lambda x: r[x])
        print(c, "지금", r["지금"], "| 가장 높은:", best, r[best])
    print("\n③ 헤도닉 AIC 개선 (법정동 / 구)")
    for k in hed["법정동"]:
        if k == "기준_R2":
            continue
        print(k, hed["법정동"][k]["AIC_개선"], "/", hed["구"][k]["AIC_개선"], "| 차이%", hed["법정동"][k]["차이_%"])


if __name__ == "__main__":
    sys.exit(main())
