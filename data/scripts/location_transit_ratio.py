"""입지 3단계: 지하철 : 버스 비율 (교통 안 비율, 2026-11-26). 엔진은 바꾸지 않는다.

지금 식: 교통 = 지하철 60 + 버스 40 (사무업무 70 : 30). 비교판 판정: 비율값 부분(선행 연구·이용량 종합, 직접 근거 없음).

D11·D12와 같은 순서
① 업종마다 지하철·버스 의존이 다른가: 1·2단계 실제 점포 효과 크기(Cohen w)를 나란히 놓고 봄
② 매물 라벨 AUC: 비율을 30:70 ~ 90:10으로 바꿔 교통 점수의 판별력이 업종마다 달라지는가
③ 시장 가치: 역 거리(대경선 포함)·정류장 거리 구간을 한 헤도닉에 같이 넣어 두 효과를 동시에 추정.
   그 예측 임대료 차이(교통 프리미엄)를 가장 잘 재현하는 비율 w를 찾음:
   교통 = w × 지하철 점수 + (1 − w) × 버스 점수 와 100 × exp(역 계수 + 정류장 계수) ÷ 최대 의 상관·오차
   (D11·D12 곡선은 둘 다 "100 × exp(계수) ÷ 최대"라 1점 ≈ 임대료 1% 차이. 같은 단위끼리 더하는 셈)
참고: 설명력 나눔(지하철 구간을 뺐을 때·버스 구간을 뺐을 때 R² 감소)

출력  09.스코어링/교통비율_보완.json
실행  py -I data/scripts/location_transit_ratio.py
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import building_age_review as bar  # noqa: E402
import classify_use as cu  # noqa: E402
import location_daegyeong_check as ldc  # noqa: E402
import location_subway_review as ls  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT = os.path.join(se.OUT, "교통비율_보완.json")
SUB_EDGES = ls.CUR_EDGES                 # D11 곡선용 (250 · 500 · 850 · 1500 · 2000)
SUB_EDGES_J = [250, 500, 850]            # 동시 추정용 (850m 뒤 평평)
BUS_EDGES = [60, 100, 150, 250]          # D12와 같음
W_GRID = [round(x, 2) for x in np.arange(0.0, 1.0001, 0.05)]


def design(rows, blocks, fe_key):
    """blocks: [(edges, dist 배열)]. 앞쪽 열에 블록별 구간 더미, 뒤에 면적·층·유형·연식·고정효과."""
    fes = sorted({fe_key(L) for L, *_ in rows})
    fl = ["2층", "3층이상", "지하", None]
    ty = sorted({L["세부유형"] for L, *_ in rows})[1:]
    na = len(bar.LABELS)
    starts, k = [], 0
    for edges, _ in blocks:
        starts.append(k)
        k += len(edges)
    k_area = k
    k_fl = k_area + 1
    k_ty = k_fl + len(fl)
    k_age = k_ty + len(ty)
    k_fe = k_age + na
    X = np.zeros((len(rows), k_fe + len(fes)))
    y = np.zeros(len(rows))
    cl = []
    for i, (L, area, r, a) in enumerate(rows):
        for (edges, dist), s0 in zip(blocks, starts):
            j = int(np.searchsorted(edges, dist[i], side="left"))
            if j:
                X[i, s0 + j - 1] = 1
        X[i, k_area] = math.log(area)
        fb = cu.floor_band(L["층"])
        if fb != "1층":
            X[i, k_fl + fl.index(fb)] = 1
        if L["세부유형"] in ty:
            X[i, k_ty + ty.index(L["세부유형"])] = 1
        if a is None:
            X[i, k_age + na - 1] = 1
        else:
            ab = bar.age_bin(a)
            if ab:
                X[i, k_age + ab - 1] = 1
        X[i, k_fe + fes.index(fe_key(L))] = 1
        y[i] = math.log(r / area)
        cl.append((L["구"], L["법정동"], L["사용승인일"]))
    return X, y, cl, starts


def fit(rows, blocks, fe_key):
    X, y, cl, starts = design(rows, blocks, fe_key)
    b, s, r2, G = bar.ols_cluster(X, y, cl)
    coefs = [np.concatenate([[0.0], b[s0:s0 + len(e)]]) for (e, _), s0 in zip(blocks, starts)]
    ses = [np.concatenate([[0.0], s[s0:s0 + len(e)]]) for (e, _), s0 in zip(blocks, starts)]
    return coefs, ses, float(r2), G


def curve_from(coef, dist, edges):
    """100 × exp(계수) ÷ 최대 → 매물 수 가중 단조 감소 → 구간 가운데(매물 중앙값)에 점."""
    bins = np.searchsorted(edges, dist, side="left")
    cnt = [int((bins == j).sum()) for j in range(len(edges) + 1)]
    raw = [100 * math.exp(c) / math.exp(max(coef)) for c in coef]
    mono = bar.pava_decreasing(raw, cnt)
    centers = [float(np.median(dist[bins == j])) if cnt[j] else None for j in range(len(edges) + 1)]
    # 마지막으로 값이 내려가는 점까지만 기준점, 그 뒤는 평평
    pts = []
    for j, (x, v) in enumerate(zip(centers, mono)):
        if x is None:
            continue
        if pts and abs(v - pts[-1][1]) < 1e-9:
            continue
        pts.append((round(x), round(v, 1)))
    return pts, [round(v, 1) for v in raw], [round(v, 1) for v in mono], cnt, [round(x) if x else None for x in centers]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
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
    dsub_old = ls.nearest_dist(lat, lon, M)
    dsub = ls.nearest_dist(lat, lon, both)
    fe = lambda L: (L["구"], L["법정동"])

    # 곡선 다시 만들기 (D11: 역만, D12: 역 통제 + 정류장) — 결정한 값과 같은지 확인용
    c_old, *_ = fit(rows, [(SUB_EDGES, dsub_old)], fe)
    d11_old = curve_from(c_old[0], dsub_old, SUB_EDGES)
    c_new, *_ = fit(rows, [(SUB_EDGES, dsub)], fe)
    d11_new = curve_from(c_new[0], dsub, SUB_EDGES)
    cj, sj, r2_j, G = fit(rows, [(SUB_EDGES_J, dsub), (BUS_EDGES, dbus)], fe)
    d12 = curve_from(cj[1], dbus, BUS_EDGES)

    S = np.array([se.interp(d11_new[0], x) for x in dsub])
    B = np.array([se.interp(d12[0], x) for x in dbus])
    # 목표: 동시 추정의 교통 프리미엄 (850m 뒤·250m 뒤 평평, 단조 정리한 곡선과 같은 틀)
    bs = np.searchsorted(SUB_EDGES_J, dsub, side="left")
    bb = np.searchsorted(BUS_EDGES, dbus, side="left")
    prem = np.exp(cj[0][bs] + cj[1][bb])
    target = 100 * prem / prem.max()
    fitw = []
    for w in W_GRID:
        T = w * S + (1 - w) * B
        corr = float(np.corrcoef(T, target)[0, 1]) if T.std() > 0 else None
        # 선형으로 맞춘 뒤 남는 오차 (점)
        A = np.vstack([T, np.ones_like(T)]).T
        coef, *_ = np.linalg.lstsq(A, target, rcond=None)
        rmse = float(np.sqrt(np.mean((A @ coef - target) ** 2)))
        fitw.append({"지하철_비중": w, "상관": round(corr, 4) if corr is not None else None, "오차_점": round(rmse, 2)})
    best = max(fitw, key=lambda x: x["상관"] or -1)

    # 부트스트랩 (건물 군집 단위): 최적 w의 흔들림
    rng = np.random.default_rng(20261126)
    cl_keys = [(L["구"], L["법정동"], L["사용승인일"]) for L, *_ in rows]
    uniq = sorted(set(cl_keys))
    idx_of = {}
    for i, g in enumerate(cl_keys):
        idx_of.setdefault(g, []).append(i)
    boots = []
    for _ in range(200):
        pick = rng.choice(len(uniq), len(uniq), replace=True)
        ii = np.concatenate([idx_of[uniq[p]] for p in pick])
        rr = [rows[i] for i in ii]
        cb, *_ = fit(rr, [(SUB_EDGES_J, dsub[ii]), (BUS_EDGES, dbus[ii])], fe)
        cs, *_ = fit(rr, [(SUB_EDGES, dsub[ii])], fe)
        sb = curve_from(cs[0], dsub[ii], SUB_EDGES)[0]
        bb_ = curve_from(cb[1], dbus[ii], BUS_EDGES)[0]
        Sb = np.array([se.interp(sb, x) for x in dsub[ii]])
        Bb = np.array([se.interp(bb_, x) for x in dbus[ii]])
        pr = np.exp(cb[0][np.searchsorted(SUB_EDGES_J, dsub[ii], side="left")] + cb[1][np.searchsorted(BUS_EDGES, dbus[ii], side="left")])
        tg = 100 * pr / pr.max()
        cs_ = [float(np.corrcoef(w * Sb + (1 - w) * Bb, tg)[0, 1]) if (w * Sb + (1 - w) * Bb).std() > 0 else -1 for w in W_GRID]
        boots.append(W_GRID[int(np.argmax(cs_))])
    boots = np.array(boots)

    # 참고: 설명력 나눔 (R² 감소)
    _, _, r2_nosub, _ = fit(rows, [(BUS_EDGES, dbus)], fe)
    _, _, r2_nobus, _ = fit(rows, [(SUB_EDGES_J, dsub)], fe)
    _, _, r2_none, _ = fit(rows, [], fe)

    # ② 매물 라벨 AUC: 비율별 교통 점수
    kidx = {k: i for i, k in enumerate(keys)}
    labeled = [k for k in keys if use[k]["cats"]]
    li = np.array([kidx[k] for k in labeled])
    auc = {}
    for c in se.CATS:
        y = np.array([1 if c in use[k]["cats"] else 0 for k in labeled])
        auc[c] = {str(w): round(ls.fast_auc(w * S[li] + (1 - w) * B[li], y), 3) for w in (0.3, 0.5, 0.6, 0.7, 0.9)}

    a = json.load(open(os.path.join(se.OUT, "지하철거리_보완.json"), encoding="utf-8"))
    b = json.load(open(os.path.join(se.OUT, "버스거리_보완.json"), encoding="utf-8"))
    w_tab = {c: {"지하철_w": a["②업종차이"][c]["w"], "버스_w": b["①업종차이"][c]["w"]} for c in se.CATS}

    pct = lambda v: round(100 * (math.exp(v) - 1), 1)
    out = {"meta": {"작성": "2026-11-26", "매물": len(rows), "건물군집": G, "역": "대구교통공사 + 대경선 (11-26 결정)",
                    "읽는법": "③ 상관이 가장 높은 지하철 비중이 시장 가치와 가장 잘 맞는 비율. 부트스트랩 범위가 넓으면 그 범위 안 비율은 구분 안 됨"},
           "곡선_확인": {"D11_역만": {"점": d11_old[0], "구간점수_단조": d11_old[2]},
                     "D11_대경선포함": {"점": d11_new[0], "구간점수_원래": d11_new[1], "구간점수_단조": d11_new[2], "매물": d11_new[3], "가운데_m": d11_new[4]},
                     "D12_버스": {"점": d12[0], "구간점수_원래": d12[1], "구간점수_단조": d12[2], "매물": d12[3], "가운데_m": d12[4]}},
           "동시추정": {"R2": round(r2_j, 4), "역_차이_%": {k: pct(v) for k, v in zip(["250~500", "500~850", "850~"], cj[0][1:])},
                    "정류장_차이_%": {k: pct(v) for k, v in zip(["60~100", "100~150", "150~250", "250~"], cj[1][1:])}},
           "①업종_효과크기": w_tab,
           "②판별력_비율별": auc,
           "③비율별_맞춤": fitw, "③최적": best,
           "③부트스트랩_최적비중": {"반복": len(boots), "중앙값": float(np.median(boots)), "90%": [float(np.quantile(boots, .05)), float(np.quantile(boots, .95))]},
           "참고_설명력": {"교통없음_R2": round(r2_none, 4), "버스만_R2": round(r2_nosub, 4), "지하철만_R2": round(r2_nobus, 4), "둘다_R2": round(r2_j, 4),
                      "지하철_고유": round(r2_j - r2_nosub, 4), "버스_고유": round(r2_j - r2_nobus, 4)}}
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k not in ("③비율별_맞춤",)}, ensure_ascii=False, indent=1))
    for r in fitw[::2]:
        print(r)


if __name__ == "__main__":
    sys.exit(main())
