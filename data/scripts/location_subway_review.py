"""입지 1단계: 지하철 거리 (교통 › 지하철, 2026-11-26). 엔진은 바꾸지 않는다.

지금 식 (scoring_engine BP["지하철"]): 역 거리 250m 100 · 500m 75 · 850m 50 · 1.5km 20 · 2km 이상 10, 업종 공통.
판정: 250·500m 부분(서울 역세권 기준, 측정점 다름), 850m 부분(도보권 0.5마일 관행), 구간별 점수값 없음.

정답지: 실제 영업 점포 위치 (소상공인시장진흥공단 상가(상권)정보 대구 2026-09, 116,628곳)
  "이 업종 점포가 역 거리 구간마다 다른 점포보다 얼마나 많은가" = 선택비 (공간 단계와 같은 규칙)
  가용(비교 기준) = 좌표 있는 대구 전체 점포. 업종 매핑은 external_factors.make_classifier와 같되 약국은 뺌
  (우리 업종 분류 classify_use v2에서 약국은 8업종 밖)
교차 확인: 매물 중개사 추천용도 라벨로 같은 계산 (매물은 적어서 보조)

① 역 좌표 기준점: 매물 파일 역거리_m = 역 좌표(1점) 직선거리 (transit_points.py, 차이 중앙값 0m). 대경선 역은 빠져 있음
② 업종마다 역 거리 분포가 다른가: 전체 점포 역 거리 10분위, 업종 대 나머지 2×10 독립성 카이제곱, Cohen w, Holm 8개
③ 선택비 곡선: 10분위 구간 수축 선택비(구간별 베타-이항 m, 공간과 같은 함수) → 100 × ÷ 최대, 구간 가운데 거리 사이 선형 보간
   지금 구간(250·500·850·1500·2000m)으로도 선택비를 내어 지금 점수와 모양 비교
④ 매물 라벨로 판별력: 지금 점수 vs 점포 선택비 곡선, AUC (곡선은 매물과 다른 자료로 만들었으므로 교차검증 불필요)
⑤ 대경선 역을 넣으면 매물 역 거리가 얼마나 바뀌나
⑥ 시장 가치: 헤도닉 회귀(연식과 같은 틀 + 연식 구간)로 역 거리 구간별 ㎡당 환산 임대료 차이 (법정동 고정 / 구 고정)

출력  09.스코어링/지하철거리_보완.json
실행  py -I data/scripts/location_subway_review.py
"""
import csv
import json
import math
import os
import sys
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classify_use as cu  # noqa: E402
import external_factors as ef  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402
from area_fit_review import chi2_sf  # noqa: E402

ROOT = se.ROOT
TP = os.path.join(ROOT, "data", "08.외부데이터", "08_교통좌표")
OUT = os.path.join(se.OUT, "지하철거리_보완.json")
CUR_EDGES = [250, 500, 850, 1500, 2000]


def store_rows():
    path = ef.find_store_csv()
    cls = ef.make_classifier()
    out = []
    with ef.open_text(path) as f:
        for r in csv.DictReader(f):
            try:
                lon, lat = float(r["경도"]), float(r["위도"])
            except (TypeError, ValueError):
                continue
            c = cls(r)
            if r["상권업종소분류명"].strip() == "약국":
                c = ()
            out.append((lat, lon, c[0] if c else None))
    return out, os.path.basename(path)


def stations(with_daegyeong):
    rows = list(csv.DictReader(open(os.path.join(TP, "대구_도시철도역.csv"), encoding="utf-8-sig")))
    if not with_daegyeong:
        rows = [r for r in rows if r["운영기관명"] == "대구교통공사"]
    return np.array([[float(r["위도"]), float(r["경도"])] for r in rows]), sorted({r["역사명"] for r in rows if r["운영기관명"] != "대구교통공사"})


def nearest_dist(lat, lon, st):
    """위도·경도 배열 → 가장 가까운 역까지 직선거리(m), 하버사인."""
    R = 6371008.8
    la, lo = np.radians(lat)[:, None], np.radians(lon)[:, None]
    sla, slo = np.radians(st[:, 0])[None, :], np.radians(st[:, 1])[None, :]
    best = np.full(len(lat), np.inf)
    for i in range(0, len(lat), 20000):
        a = np.sin((sla - la[i:i + 20000]) / 2) ** 2 + np.cos(la[i:i + 20000]) * np.cos(sla) * np.sin((slo - lo[i:i + 20000]) / 2) ** 2
        best[i:i + 20000] = (2 * R * np.arcsin(np.sqrt(a))).min(1)
    return best


def bins_of(d, edges):
    return np.searchsorted(np.array(edges), d, side="left")


def test_table(b, lab, nb, cats):
    """업종 대 나머지 2×nb 독립성 카이제곱, Cohen w."""
    res = {}
    tot = np.bincount(b, minlength=nb).astype(float)
    for c in cats:
        x = np.bincount(b[lab == c], minlength=nb).astype(float)
        y = tot - x
        n = tot.sum()
        chi = 0.0
        for row in (x, y):
            exp = row.sum() * tot / n
            m = exp > 0
            chi += (((row - exp) ** 2)[m] / exp[m]).sum()
        res[c] = {"n": int(x.sum()), "chi2": round(float(chi), 1), "p": chi2_sf(chi, nb - 1) if (nb - 1) % 2 == 0 else None,
                  "w": round(math.sqrt(chi / n), 3)}
    return res


def chi2_sf_any(x, df):
    """카이제곱 생존함수 (윌슨-힐퍼티 근사, 홀수 자유도용)."""
    if df % 2 == 0:
        return chi2_sf(x, df)
    z = ((x / df) ** (1 / 3) - (1 - 2 / (9 * df))) / math.sqrt(2 / (9 * df))
    return 0.5 * math.erfc(z / math.sqrt(2))


def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    adj, run = [0] * len(ps), 0
    for k, i in enumerate(order):
        run = max(run, min(1.0, (len(ps) - k) * ps[i]))
        adj[i] = run
    return adj


def shrunk_sr(b, lab, nb, cats):
    bins = {i: int(v) for i, v in enumerate(b)}
    members = {c: [i for i in range(len(b)) if lab[i] == c] for c in cats}
    sr, m, pi, cnt = se.shrink_tables(bins, members, nb)
    return sr, m, pi, cnt


def curve(sr, centers):
    mx = max(sr)
    return [(float(x), 100 * s / mx) for x, s in zip(centers, sr)]


def fast_auc(s, y):
    s, y = np.asarray(s, float), np.asarray(y, int)
    order = np.argsort(s, kind="mergesort")
    ss = s[order]
    ranks = np.empty(len(s))
    _, start, cnt = np.unique(ss, return_index=True, return_counts=True)
    r = np.arange(1, len(s) + 1, dtype=float)
    for st_, c in zip(start, cnt):
        r[st_:st_ + c] = st_ + (c + 1) / 2
    ranks[order] = r
    n1 = y.sum()
    n0 = len(y) - n1
    return float((ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cats = se.CATS
    S, src = store_rows()
    lat = np.array([s[0] for s in S])
    lon = np.array([s[1] for s in S])
    lab = np.array([s[2] or "" for s in S], dtype=object)
    st, _ = stations(False)
    d = nearest_dist(lat, lon, st)
    print("점포", len(S), "업종별", Counter(x for x in lab if x))

    # ② 10분위 검정
    edges = list(np.quantile(d, [i / 10 for i in range(1, 10)]))
    b = bins_of(d, edges)
    tt = test_table(b, lab, 10, cats)
    ps = [chi2_sf_any(tt[c]["chi2"], 9) for c in cats]
    for c, p, ph in zip(cats, ps, holm(ps)):
        tt[c]["p"] = p
        tt[c]["Holm_p"] = ph

    # ③ 수축 선택비 곡선 (10분위) + 지금 구간
    sr, m, pi, cnt = shrunk_sr(b, lab, 10, cats)
    centers = [float(np.median(d[b == j])) for j in range(10)]
    curves = {c: curve(sr[c], centers) for c in cats}
    bc = bins_of(d, CUR_EDGES)
    src_cur, m2, pi2, _ = shrunk_sr(bc, lab, len(CUR_EDGES) + 1, cats)

    # 매물
    listings, ext, bld, use, cfs, cost = we.load()
    ids = [L["매물번호"] for L in listings]
    ld = {L["매물번호"]: se.num(L["역거리_m"]) for L in listings}
    labeled = [k for k in ids if use[k]["cats"] and ld[k] is not None]
    cur = np.array([se.interp(se.BP["지하철"], ld[k]) for k in labeled])
    auc = {}
    for c in cats:
        y = np.array([1 if c in use[k]["cats"] else 0 for k in labeled])
        cand = np.array([se.interp(curves[c], ld[k]) for k in labeled])
        auc[c] = {"지금": round(fast_auc(cur, y), 3), "점포선택비": round(fast_auc(cand, y), 3), "양성": int(y.sum())}
    # 매물 라벨로 같은 구간 선택비 (교차 확인)
    lb = {k: int(np.searchsorted(np.array(edges), ld[k], side="left")) for k in labeled}
    lmem = {c: [k for k in labeled if c in use[k]["cats"]] for c in cats}
    lsr, lm, lpi, lcnt = se.shrink_tables(lb, lmem, 10)

    # ⑤ 대경선
    st2, dk = stations(True)
    llat = np.array([se.num(L["위도"]) or np.nan for L in listings], float)
    llon = np.array([se.num(L["경도"]) or np.nan for L in listings], float)
    ok = ~np.isnan(llat)
    d1 = nearest_dist(llat[ok], llon[ok], st)
    d2 = nearest_dist(llat[ok], llon[ok], st2)
    ch = d1 - d2
    dk_res = {"대경선_역": dk, "매물수": int(ok.sum()), "거리_줄어든_매물": int((ch > 1).sum()),
              "100m넘게_줄어든_매물": int((ch > 100).sum()), "지금점수_10점넘게_오르는_매물": int(sum(
                  1 for a, b2 in zip(d1, d2) if se.interp(se.BP["지하철"], b2) - se.interp(se.BP["지하철"], a) > 10))}

    # ⑥ 시장 가치: 같은 동(또는 구)·층·면적·유형·연식에서 역 거리 구간별 ㎡당 환산 임대료 (연식 헤도닉과 같은 틀)
    import building_age_review as bar
    hed = {}
    for fe_name, fe_key in (("법정동", lambda L: (L["구"], L["법정동"])), ("구", lambda L: L["구"])):
        rows = []
        for L in listings:
            dd, area, r = se.num(L["역거리_m"]), se.num(L["전용면적"]), se.converted_rent(L)
            if dd is None or not area or not r or r <= 0:
                continue
            rows.append((L, dd, area, r, bar.age_of(L)))
        dl = ["~250", "250~500", "500~850", "850~1500", "1500~2000", "2000~"]
        fes = sorted({fe_key(L) for L, *_ in rows})
        fl = ["2층", "3층이상", "지하", None]
        ty = sorted({L["세부유형"] for L, *_ in rows})[1:]
        nbin = len(dl) - 1
        cols = nbin + 1 + len(fl) + len(ty) + len(bar.LABELS) + len(fes)   # 연식 구간 + 연식 없음 칸
        X = np.zeros((len(rows), cols))
        y = np.zeros(len(rows))
        cl = []
        for i, (L, dd, area, r, a) in enumerate(rows):
            j = int(np.searchsorted(np.array(CUR_EDGES), dd, side="left"))
            if j:
                X[i, j - 1] = 1
            X[i, nbin] = math.log(area)
            fb = cu.floor_band(L["층"])
            if fb != "1층":
                X[i, nbin + 1 + fl.index(fb)] = 1
            if L["세부유형"] in ty:
                X[i, nbin + 1 + len(fl) + ty.index(L["세부유형"])] = 1
            k0 = nbin + 1 + len(fl) + len(ty)
            if a is None:
                X[i, k0 + len(bar.LABELS) - 1] = 1
            else:
                ab = bar.age_bin(a)
                if ab:
                    X[i, k0 + ab - 1] = 1
            X[i, k0 + len(bar.LABELS) + fes.index(fe_key(L))] = 1
            y[i] = math.log(r / area)
            cl.append((L["구"], L["법정동"], L["사용승인일"]))
        bb, ss, r2, G = bar.ols_cluster(X, y, cl)
        cnt_b = Counter(int(np.searchsorted(np.array(CUR_EDGES), dd, side="left")) for _, dd, *_ in rows)
        hed[fe_name] = {"n": len(rows), "건물군집": G, "R2": round(float(r2), 3),
                        "구간": [{"역거리": dl[0], "매물": cnt_b[0], "차이_%": 0.0}] +
                               [{"역거리": dl[j + 1], "매물": cnt_b[j + 1], "차이_%": round(100 * (math.exp(bb[j]) - 1), 1),
                                 "95%_%": [round(100 * (math.exp(bb[j] - 1.96 * ss[j]) - 1), 1), round(100 * (math.exp(bb[j] + 1.96 * ss[j]) - 1), 1)]}
                                for j in range(nbin)]}
        print("헤도닉", fe_name, "고정:", [(g["역거리"], g["차이_%"], g.get("95%_%")) for g in hed[fe_name]["구간"]], "n", len(rows), "R2", round(float(r2), 3))

    q = lambda a, p: round(float(np.quantile(a, p)), 0)
    out = {"meta": {"작성": "2026-11-26", "정답지": src + " (약국 제외, 좌표 있는 점포)", "점포수": len(S),
                    "역": "대구교통공사 1·2·3호선 역 좌표 (대경선 제외, 매물 파일과 같음)",
                    "점포_역거리_분위_m": {"10%": q(d, .1), "25%": q(d, .25), "50%": q(d, .5), "75%": q(d, .75), "90%": q(d, .9)},
                    "매물_역거리_분위_m": {p: q(np.array([v for v in ld.values() if v is not None]), x) for p, x in (("10%", .1), ("50%", .5), ("90%", .9))},
                    "10분위_경계_m": [round(x) for x in edges], "구간_가운데_m": [round(x) for x in centers], "m_10분위": m},
           "②업종차이": tt,
           "③선택비_10분위": {c: {"개수": cnt[c], "선택비": [round(x, 3) for x in sr[c]], "점수": [round(y) for _, y in curves[c]]} for c in cats},
           "③선택비_지금구간": {"구간": ["~250", "250~500", "500~850", "850~1500", "1500~2000", "2000~"], "전체비율": [round(x, 4) for x in pi2],
                          "업종": {c: [round(x, 3) for x in src_cur[c]] for c in cats}},
           "④판별력_매물라벨": auc,
           "④매물라벨_선택비_10분위": {c: [round(x, 3) for x in lsr[c]] for c in cats},
           "⑤대경선": dk_res,
           "⑥헤도닉_역거리": hed}
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print(json.dumps(out["meta"], ensure_ascii=False))
    print("\n업종 | 점포 수 | w | Holm p | 10분위 선택비 (가까움 → 멂) | 점수")
    for c in cats:
        t = tt[c]
        print(c, t["n"], t["w"], "%.1e" % t["Holm_p"], "·".join("%.2f" % x for x in sr[c]), "|", "·".join(str(round(y)) for _, y in curves[c]))
    print("\n지금 구간 선택비 (~250 · ~500 · ~850 · ~1500 · ~2000 · 2000+), 전체 비율", [round(x, 3) for x in pi2])
    for c in cats:
        print(c, "·".join("%.2f" % x for x in src_cur[c]))
    print("\n매물 라벨 AUC (지금 → 점포 선택비 곡선):", {c: (v["지금"], v["점포선택비"]) for c, v in auc.items()})
    print("매물 라벨 10분위 선택비:", {c: "·".join("%.2f" % x for x in lsr[c]) for c in cats})
    print("대경선:", dk_res)


if __name__ == "__main__":
    sys.exit(main())
