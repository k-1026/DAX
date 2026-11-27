"""입지 4단계: 상권 활성도 (2026-11-26). 엔진은 바꾸지 않는다.

지금 식 (external_factors.py): 업종 반경(식음료·소매·뷰티·공연문화·의료 300m, 교육·사무업무·운동시설 500m) 안
전체 상가 수 → 좌표 있는 대구 매물 중 백분위 = 점수.
비교판 판정: 백분위 정규화 있음, 반경 300m 부분(서울시 상권분석서비스 옛 동심원 예시), 상가 수 = 활성도 없음(대리 지표).

D11~D13과 같은 순서
① 업종마다 상가 밀도 선호가 다른가: 실제 점포마다 300m 안 다른 점포 수 10분위, 업종 대 나머지 Cohen w, Holm
② 매물 라벨 AUC: 지금 점수 vs 업종별 점포 선택비 곡선
③ 시장 가치: 헤도닉(역·정류장 거리 구간 통제 + 법정동 고정)에 상가 수 10분위 구간을 넣음
   - 반경 100 · 200 · 300 · 500 · 800m를 같은 틀로 돌려 AIC로 어느 반경이 임대료를 가장 잘 설명하는지 비교
   - "상가 수 = 활성도" 확인: 같은 동 안에서 상가가 많은 곳이 실제로 임대료가 높은가(상권 가치가 임대료에 드러나는가)
   - 가장 잘 맞는 반경의 구간 계수 → 100 × exp(계수) ÷ 최대, 단조 증가 정리 → 공통 곡선 후보

출력  09.스코어링/상권활성도_보완.json
실행  py -I data/scripts/location_activity_review.py
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import building_age_review as bar  # noqa: E402
import external_factors as ef  # noqa: E402
import location_daegyeong_check as ldc  # noqa: E402
import location_subway_review as ls  # noqa: E402
import location_transit_ratio as ltr  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT = os.path.join(se.OUT, "상권활성도_보완.json")
RADII = [100, 200, 300, 500, 800]
STORE_R = 300


def proj(lat, lon):
    return np.asarray(lon) * ef.M_PER_DEG_LON, np.asarray(lat) * ef.M_PER_DEG_LAT


def counts_at(qx, qy, sx, sy, radii, exclude_self=False):
    """질의점마다 반경 안 점포 수 (격자 = 최대 반경)."""
    cell = max(radii)
    gx, gy = np.floor(sx / cell).astype(int), np.floor(sy / cell).astype(int)
    buckets = {}
    for i, key in enumerate(zip(gx, gy)):
        buckets.setdefault(key, []).append(i)
    buckets = {k: np.array(v) for k, v in buckets.items()}
    qgx, qgy = np.floor(qx / cell).astype(int), np.floor(qy / cell).astype(int)
    out = np.zeros((len(qx), len(radii)), dtype=int)
    qcells = {}
    for i, key in enumerate(zip(qgx, qgy)):
        qcells.setdefault(key, []).append(i)
    r2 = np.array(radii, float) ** 2
    for (cx, cy), qi in qcells.items():
        cand = [buckets[(cx + a, cy + b)] for a in (-1, 0, 1) for b in (-1, 0, 1) if (cx + a, cy + b) in buckets]
        qi = np.array(qi)
        if not cand:
            continue
        cand = np.concatenate(cand)
        for s0 in range(0, len(qi), 500):
            q = qi[s0:s0 + 500]
            d2 = (qx[q][:, None] - sx[cand][None, :]) ** 2 + (qy[q][:, None] - sy[cand][None, :]) ** 2
            for k, rr in enumerate(r2):
                out[q, k] = (d2 <= rr).sum(1)
    if exclude_self:
        out -= 1
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cats = se.CATS
    S, src = ls.store_rows()
    slat = np.array([s[0] for s in S])
    slon = np.array([s[1] for s in S])
    lab = np.array([s[2] or "" for s in S], dtype=object)
    sx, sy = proj(slat, slon)

    # ① 점포 쪽: 점포마다 300m 안 다른 점포 수
    sc = counts_at(sx, sy, sx, sy, [STORE_R], exclude_self=True)[:, 0]
    edges = list(np.quantile(sc, [i / 10 for i in range(1, 10)]))
    b = ls.bins_of(sc, edges)
    tt = ls.test_table(b, lab, 10, cats)
    ps = [ls.chi2_sf_any(tt[c]["chi2"], 9) for c in cats]
    for c, p, ph in zip(cats, ps, ls.holm(ps)):
        tt[c]["p"], tt[c]["Holm_p"] = p, ph
    sr, m, pi, cnt = ls.shrunk_sr(b, lab, 10, cats)
    centers = [float(np.median(sc[b == j])) for j in range(10)]
    curves = {c: ls.curve(sr[c], centers) for c in cats}

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
    lx, ly = proj(lat, lon)
    lc = counts_at(lx, ly, sx, sy, RADII)
    # 매물 파일(외부인자)의 300·500m 상가 수와 같은지 확인
    chk = {}
    for k, rr in ((2, 300), (3, 500)):
        given = np.array([se.num(ext.get(key, {}).get("상가수_%dm" % rr)) or np.nan for key in keys], float)
        ok = ~np.isnan(given)
        chk["%dm" % rr] = {"n": int(ok.sum()), "같음_%": round(100 * float((np.abs(lc[ok, k] - given[ok]) <= 2).mean()), 1),
                           "차이_중앙값": float(np.median(lc[ok, k] - given[ok]))}

    # ② 매물 라벨 AUC
    kidx = {k: i for i, k in enumerate(keys)}
    labeled = [k for k in keys if use[k]["cats"]]
    li = np.array([kidx[k] for k in labeled])
    auc = {}
    for c in cats:
        y = np.array([1 if c in use[k]["cats"] else 0 for k in labeled])
        cur = np.array([se.num(ext[k].get("활성도_" + c)) if ext.get(k) else np.nan for k in labeled], float)
        cur = np.where(np.isnan(cur), np.nanmedian(cur), cur)
        cand = np.array([se.interp(curves[c], v) for v in lc[li, 2]])
        auc[c] = {"지금": round(ls.fast_auc(cur, y), 3), "점포선택비": round(ls.fast_auc(cand, y), 3), "양성": int(y.sum())}

    # ③ 시장 가치: 반경별 헤도닉 (역·정류장 통제)
    fe_dong = lambda L: (L["구"], L["법정동"])
    fe_gu = lambda L: L["구"]
    base = [(ltr.SUB_EDGES_J, dsub), (ltr.BUS_EDGES, dbus)]
    X0, y0, *_ = ltr.design(rows, base, fe_dong)
    _, _, r2_base, _ = ltr.fit(rows, base, fe_dong)
    n = len(rows)
    rss_of = lambda r2: (1 - r2) * float(((y0 - y0.mean()) ** 2).sum())
    hed = {}
    for k, rr in enumerate(RADII):
        v = lc[:, k].astype(float)
        e = sorted(set(np.quantile(v, [i / 10 for i in range(1, 10)]).tolist()))
        res = {}
        for fe_name, fe in (("법정동", fe_dong), ("구", fe_gu)):
            coefs, ses, r2, G = ltr.fit(rows, base + [(e, v)], fe)
            c = coefs[2]
            s = ses[2]
            bins = np.searchsorted(e, v, side="left")
            cntb = [int((bins == j).sum()) for j in range(len(e) + 1)]
            raw = [100 * math.exp(x) / math.exp(max(c)) for x in c]
            mono = bar.pava_decreasing(raw[::-1], cntb[::-1])[::-1]
            med = [float(np.median(v[bins == j])) if cntb[j] else None for j in range(len(e) + 1)]
            res[fe_name] = {"R2": round(r2, 4), "구간_경계": [round(x) for x in e], "구간_가운데": [round(x) if x is not None else None for x in med],
                            "매물": cntb, "차이_%": [round(100 * (math.exp(x) - 1), 1) for x in c],
                            "95%_%": [[round(100 * (math.exp(x - 1.96 * q) - 1), 1), round(100 * (math.exp(x + 1.96 * q) - 1), 1)] for x, q in zip(c, s)],
                            "점수_원래": [round(x, 1) for x in raw], "점수_단조": [round(x, 1) for x in mono]}
            if fe_name == "법정동":
                # 활성도 없는 모형과 비교 (같은 표본·고정효과). 구간 수가 반경마다 같으면 AIC를 바로 비교할 수 있음
                k_extra = len(e)
                res[fe_name]["AIC_활성도없음대비"] = round(n * math.log(rss_of(r2_base) / rss_of(r2)) - 2 * k_extra, 1)
                res[fe_name]["AIC"] = round(n * math.log(rss_of(r2) / n) + 2 * k_extra, 1)
        hed["%dm" % rr] = res

    # 매물 쪽 분포
    dist = {"%dm" % rr: {p: int(np.quantile(lc[:, k], x)) for p, x in (("10%", .1), ("50%", .5), ("90%", .9))} for k, rr in enumerate(RADII)}
    # 반경끼리 상관 (같은 신호인지)
    corr = {"%d-%d" % (RADII[i], RADII[j]): round(float(np.corrcoef(np.log1p(lc[:, i]), np.log1p(lc[:, j]))[0, 1]), 3)
            for i in range(len(RADII)) for j in range(i + 1, len(RADII))}
    # 역 거리와의 상관 (활성도가 교통과 같은 신호를 두 번 세는지)
    corr_sub = {"%dm" % rr: round(float(np.corrcoef(np.log1p(lc[:, k]), np.log(dsub + 1))[0, 1]), 3) for k, rr in enumerate(RADII)}

    out = {"meta": {"작성": "2026-11-26", "정답지": src + " (약국은 업종 라벨에서만 뺌, 상가 수에는 포함)", "점포": len(S), "매물": n,
                    "점포_300m_안_점포수_분위": {p: int(np.quantile(sc, x)) for p, x in (("10%", .1), ("50%", .5), ("90%", .9))},
                    "매물_반경별_상가수_분위": dist, "외부인자_상가수와_같은지": chk,
                    "반경끼리_상관_log": corr, "역거리와_상관_log": corr_sub, "10분위_경계_점포": [round(x) for x in edges], "m": m,
                    "기준모형_R2(역·정류장·법정동)": round(r2_base, 4)},
           "①업종차이": tt, "①선택비_10분위": {c: [round(x, 3) for x in sr[c]] for c in cats},
           "②판별력_매물라벨": auc, "③헤도닉_반경별": hed}
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print(json.dumps(out["meta"], ensure_ascii=False, indent=1))
    for c in cats:
        print(c, tt[c]["n"], "w", tt[c]["w"], "Holm %.1e" % tt[c]["Holm_p"], "·".join("%.2f" % x for x in sr[c]), "| AUC", auc[c]["지금"], "→", auc[c]["점포선택비"])
    for rr, res in hed.items():
        h = res["법정동"]
        print(rr, "R2", h["R2"], "AIC", h["AIC"], "활성도없음대비", h["AIC_활성도없음대비"], "| 차이%", h["차이_%"], "| 단조", h["점수_단조"], "| 구 고정 차이%", res["구"]["차이_%"])


if __name__ == "__main__":
    sys.exit(main())
