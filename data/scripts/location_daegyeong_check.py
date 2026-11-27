"""입지 1단계 보충: 대경선 역을 지하철 거리에 넣을지 (2026-11-26). 엔진은 바꾸지 않는다.

D11·D12와 같은 기준(③ 시장 가치)으로 판단한다.
A. 헤도닉 두 개를 같은 틀로 돌려 비교: 역 거리 = 대구교통공사 역만(지금 매물 파일과 같음) vs 대경선 역 포함.
   인자 수가 같으므로 AIC 차이 = n·ln(RSS_빼기 / RSS_넣기). 양수면 넣은 쪽이 임대료를 더 잘 설명.
B. 대경선 단독 역(서대구 등)이 가장 가까운 매물에 따로 표시(더미)를 넣은 헤도닉:
   계수가 0 근처면 "대경선 역 근처도 도시철도 역 근처와 같은 값"이라 같은 거리 점수를 줘도 됨.
C. 거리 구간이 바뀌는 매물만 따로: 빼기 모형의 잔차 평균. 양수면 실제 임대료가 "역에서 멀다"고 본 예측보다 높음 → 넣는 쪽 지지.
D. 점포 쪽 참고: 역 반경 300m 안 점포 수, 대경선 단독 역 vs 대구교통공사 역 분포.

출력  09.스코어링/대경선_포함_검토.json
실행  py -I data/scripts/location_daegyeong_check.py
"""
import csv
import json
import math
import os
import sys
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import building_age_review as bar  # noqa: E402
import classify_use as cu  # noqa: E402
import location_subway_review as ls  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT = os.path.join(se.OUT, "대경선_포함_검토.json")
EDGES = ls.CUR_EDGES                     # 250 · 500 · 850 · 1500 · 2000 (D11 헤도닉과 같은 구간)
LABELS = ["~250", "250~500", "500~850", "850~1500", "1500~2000", "2000~"]
SOLO_M = 300                             # 대경선 역에서 이 거리 안에 대구교통공사 역이 있으면 같은 자리(대구역·동대구역)


def station_rows():
    rows = list(csv.DictReader(open(os.path.join(ls.TP, "대구_도시철도역.csv"), encoding="utf-8-sig")))
    metro = [r for r in rows if r["운영기관명"] == "대구교통공사"]
    dk = [r for r in rows if r["운영기관명"] != "대구교통공사"]
    arr = lambda rs: np.array([[float(r["위도"]), float(r["경도"])] for r in rs])
    return metro, dk, arr(metro), arr(dk)


def hedonic(rows, dist, fe_key, extra=None):
    """rows: (L, area, rent, age). dist: 매물별 역 거리. extra: 매물별 0/1 더미(없으면 None)."""
    nb = len(EDGES)
    fes = sorted({fe_key(L) for L, *_ in rows})
    fl = ["2층", "3층이상", "지하", None]
    ty = sorted({L["세부유형"] for L, *_ in rows})[1:]
    na = len(bar.LABELS)
    k_area, k_fl = nb, nb + 1
    k_ty = k_fl + len(fl)
    k_age = k_ty + len(ty)
    k_ex = k_age + na
    k_fe = k_ex + (1 if extra is not None else 0)
    X = np.zeros((len(rows), k_fe + len(fes)))
    y = np.zeros(len(rows))
    cl = []
    for i, (L, area, r, a) in enumerate(rows):
        j = int(np.searchsorted(EDGES, dist[i], side="left"))
        if j:
            X[i, j - 1] = 1
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
        if extra is not None:
            X[i, k_ex] = extra[i]
        X[i, k_fe + fes.index(fe_key(L))] = 1
        y[i] = math.log(r / area)
        cl.append((L["구"], L["법정동"], L["사용승인일"]))
    b, s, r2, G = bar.ols_cluster(X, y, cl)
    u = y - X @ b
    pct = lambda v: round(100 * (math.exp(v) - 1), 1)
    out = {"n": len(rows), "건물군집": G, "R2": round(float(r2), 4), "RSS": float(u @ u),
           "구간_차이_%": {LABELS[j + 1]: pct(b[j]) for j in range(nb)}}
    if extra is not None:
        out["대경선단독_더미"] = {"차이_%": pct(b[k_ex]), "95%_%": [pct(b[k_ex] - 1.96 * s[k_ex]), pct(b[k_ex] + 1.96 * s[k_ex])],
                             "해당_매물": int(sum(extra))}
    return out, u


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    metro, dk, M, K = station_rows()
    # 대경선 단독 역: 300m 안에 대구교통공사 역이 없는 대경선 역
    dk_gap = ls.nearest_dist(K[:, 0], K[:, 1], M)
    solo = [i for i in range(len(dk)) if dk_gap[i] > SOLO_M]
    solo_names = [dk[i]["역사명"] for i in solo]
    both = np.vstack([M, K])

    listings, *_ = we.load()
    rows, lat, lon = [], [], []
    for L in listings:
        la, lo, area, r = se.num(L["위도"]), se.num(L["경도"]), se.num(L["전용면적"]), se.converted_rent(L)
        if la is None or lo is None or not area or not r or r <= 0:
            continue
        rows.append((L, area, r, bar.age_of(L)))
        lat.append(la)
        lon.append(lo)
    lat, lon = np.array(lat), np.array(lon)
    d_out = ls.nearest_dist(lat, lon, M)
    d_in = ls.nearest_dist(lat, lon, both)
    # 가장 가까운 역이 대경선 단독 역인 매물
    d_solo = ls.nearest_dist(lat, lon, K[solo]) if solo else np.full(len(lat), np.inf)
    near_solo = (d_solo < d_out - 1).astype(int)
    near_solo_500 = ((d_solo < d_out - 1) & (d_solo <= 500)).astype(int)
    bin_out = np.searchsorted(EDGES, d_out, side="left")
    bin_in = np.searchsorted(EDGES, d_in, side="left")
    moved = bin_out != bin_in
    # 구간 바뀌는 매물이 어느 대경선 역 때문인지 (가장 가까운 대경선 역)
    near_dk = np.array([int(np.argmin((K[:, 0] - a) ** 2 + (K[:, 1] - b) ** 2)) for a, b in zip(lat, lon)])
    groups = {"서대구역(단독)": moved & np.isin(near_dk, solo), "대구역·동대구역(1호선과 같은 자리)": moved & ~np.isin(near_dk, solo)}

    res = {}
    for fe_name, fe_key in (("법정동", lambda L: (L["구"], L["법정동"])), ("구", lambda L: L["구"])):
        h_out, u_out = hedonic(rows, d_out, fe_key)
        h_in, u_in = hedonic(rows, d_in, fe_key)
        h_dum, _ = hedonic(rows, d_in, fe_key, extra=list(near_solo_500))
        n = len(rows)
        d_aic = n * math.log(h_out["RSS"] / h_in["RSS"])
        mv = u_out[moved]
        mv_in = u_in[moved]
        se_mv = float(mv.std(ddof=1) / math.sqrt(len(mv))) if len(mv) > 1 else None
        res[fe_name] = {
            "A_빼기": {k: v for k, v in h_out.items() if k != "RSS"},
            "A_넣기": {k: v for k, v in h_in.items() if k != "RSS"},
            "A_AIC차이_빼기−넣기": round(d_aic, 2),
            "B_대경선단독_더미모형": h_dum["대경선단독_더미"], "B_구간_차이_%": h_dum["구간_차이_%"],
            "C_구간바뀌는_매물": {"매물": int(moved.sum()),
                             "빼기모형_잔차평균_%": round(100 * (math.exp(float(mv.mean())) - 1), 1) if len(mv) else None,
                             "빼기모형_95%_%": [round(100 * (math.exp(float(mv.mean()) - 1.96 * se_mv) - 1), 1),
                                              round(100 * (math.exp(float(mv.mean()) + 1.96 * se_mv) - 1), 1)] if se_mv else None,
                             "넣기모형_잔차평균_%": round(100 * (math.exp(float(mv_in.mean())) - 1), 1) if len(mv_in) else None,
                             "역별": {g: {"매물": int(m.sum()),
                                        "빼기모형_잔차평균_%": round(100 * (math.exp(float(u_out[m].mean())) - 1), 1) if m.sum() else None,
                                        "넣기모형_잔차평균_%": round(100 * (math.exp(float(u_in[m].mean())) - 1), 1) if m.sum() else None}
                                    for g, m in groups.items()}}}

    # D. 점포 쪽: 역 반경 300m 안 점포 수
    S, src = ls.store_rows()
    slat = np.array([s[0] for s in S])
    slon = np.array([s[1] for s in S])

    def count_within(pt, radius=300):
        box = (np.abs(slat - pt[0]) < 0.004) & (np.abs(slon - pt[1]) < 0.005)
        R = 6371008.8
        la1, lo1 = math.radians(pt[0]), math.radians(pt[1])
        la2, lo2 = np.radians(slat[box]), np.radians(slon[box])
        a = np.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
        return int((2 * R * np.arcsin(np.sqrt(a)) <= radius).sum())

    metro_cnt = np.array([count_within(p) for p in M])
    solo_cnt = {dk[i]["역사명"]: count_within(K[i]) for i in solo if 35.6 < K[i, 0] < 36.0 and 128.45 < K[i, 1] < 128.7}
    pct_rank = {k: round(100 * float((metro_cnt < v).mean()), 1) for k, v in solo_cnt.items()}

    trans = Counter((LABELS[a], LABELS[b]) for a, b, m in zip(bin_out, bin_in, moved) if m)
    out = {"meta": {"작성": "2026-11-26", "매물": len(rows), "대경선_역": [r["역사명"] for r in dk],
                    "대경선_단독역(대구교통공사 역 300m 밖)": solo_names,
                    "가장가까운역이_대경선단독역_매물": int(near_solo.sum()), "그중_500m_안": int(near_solo_500.sum()),
                    "구간_바뀌는_매물": int(moved.sum()), "구간_이동": {f"{a}→{b}": c for (a, b), c in trans.most_common()},
                    "읽는법": "A: AIC차이 > 2 넣기 지지, < −2 빼기 지지, 그 사이 구분 안 됨(Burnham·Anderson). "
                              "B: 대경선 단독 역 500m 안 더미 차이가 0 근처면 같은 거리 점수를 줘도 됨. "
                              "C: 빼기 모형 잔차가 양수면 실제 임대료가 '역에서 멀다'는 예측보다 높음."},
           "헤도닉": res,
           "D_점포": {"정답지": src, "역_300m_안_점포수_대구교통공사_분위": {p: int(np.quantile(metro_cnt, x)) for p, x in (("25%", .25), ("50%", .5), ("75%", .75))},
                    "대경선_단독역_300m_안_점포수": solo_cnt, "대구교통공사역_중_이보다_적은_비율_%": pct_rank}}
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    sys.exit(main())
