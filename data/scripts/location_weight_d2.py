"""D2 입지 그룹 안 비중 (교통 · 상권 활성도 · 배후 수요, 2026-11-27). 엔진은 바꾸지 않는다.

입지 공통 규칙 (가) 역할 나눔(11-27)으로 정한 인자 점수를 쓴다.
  교통 = 0.6 × 지하철 + 0.4 × 버스 (지하철: 공통 D11 대경선 포함, 의료만 업종별 점포 선택비 곡선. 버스: 공통 D12)
  활성도 = 공통 D14 200m
  배후 수요 = 교육 6~18세 · 의료 종사자 업종별 곡선, 나머지 공통 20~49세 300m

비중 후보
  지금   엔진 가설 (S_DEFAULT 30·40·30, S_DEST 25·25·50, 공연문화 40·40·20, 사무업무 50·20·30)
  시장   위치 가치 = 임대료. 헤도닉(면적·층·유형·연식·법정동 고정 + 세 인자 점수)의 점수 1점당 계수에 비례.
         합성 점수 Σ w × 점수 가 임대료를 가장 잘 따라가는 비중. 전 업종 공통(공통 곡선 기준). 인자마다 최소 10
  라벨   D1(공간)과 같은 방식: 중개사 라벨 AUC 최적, 5 간격 격자, 인자마다 최소 10, 5겹 교차 검증. 업종별
  역할나눔 업종별 곡선 칸(교육 배후 수요, 의료 교통·배후 수요)은 지금 비중을 두고, 공통 곡선 칸은 남은 몫을 시장 비율로 나눔
  CRITIC 참고 (점수 흩어짐 × 다른 인자와 덜 겹침)
판정 기준 (입지 공통 규칙과 같음)
  ① 시장 가치 적합: 합성 입지 점수 하나를 헤도닉에 넣었을 때 RSS → 가장 좋은 후보 대비 ΔAIC (2 넘으면 차이 있음, 10 넘으면 뚜렷)
  ② 후보 추리기: 비용 + 공간 + 입지 점수로 라벨 AUC · 상위 50 · 구별 상위 10. 지금 대비 매물 부트스트랩 1,000회 95% 구간
     (라벨 후보는 5겹 밖 예측 점수로 잼)

출력  09.스코어링/입지_그룹안비중_D2.json
실행  py -I data/scripts/location_weight_d2.py
"""
import csv
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
import location_demand_topk as ldt  # noqa: E402
import location_subway_review as ls  # noqa: E402
import location_transit_ratio as ltr  # noqa: E402
import scoring_engine as se  # noqa: E402
import weight_estimation as we  # noqa: E402

OUT = os.path.join(se.OUT, "입지_그룹안비중_D2.json")
SPEC_D = {"교육": "pop_6_18", "의료": "workers"}
COMMON_D_KEY = "20~49세_300m"
MINW = 10
GRID = [(a, b, 100 - a - b) for a in range(MINW, 101, 5) for b in range(MINW, 101 - a, 5) if 100 - a - b >= MINW]
K, SEED, NB, B = 5, 20261127, 500, 1000


def round_to_5(w):
    """비중을 합 100, 5 간격, 인자마다 최소 10으로 맞춤."""
    w = np.maximum(np.array(w, float), 0)
    w = w / w.sum() * 100 if w.sum() > 0 else np.full(3, 100 / 3)
    best, bd = None, 1e9
    for g in GRID:
        d = float(np.abs(np.array(g) - w).sum())
        if d < bd:
            best, bd = g, d
    return list(best)


def critic(X):
    mn, mx = X.min(0), X.max(0)
    Z = (X - mn) / np.where(mx > mn, mx - mn, 1)
    R = np.nan_to_num(np.corrcoef(Z, rowvar=False))
    C = Z.std(0) * (1 - R).sum(0)
    return C / C.sum() * 100


def combine(F, w):
    T, A, D = F[:, 0], F[:, 1], F[:, 2]
    num_ = w[0] * np.nan_to_num(T, nan=0) + w[1] * A + w[2] * D
    den = np.where(np.isnan(T), 0, w[0]) + w[1] + w[2]
    return num_ / den


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cand = json.load(open(os.path.join(se.OUT, "배후수요_보완_후보.json"), encoding="utf-8"))
    common_d = [tuple(p) for p in cand["공통_시장가치_후보"][COMMON_D_KEY]["곡선"]]
    spec_d = {c: [tuple(p) for p in cand["업종별_후보"][c][nm]["곡선"]] for c, nm in (("교육", "6~18세"), ("의료", "종사자"))}
    sub = json.load(open(os.path.join(se.OUT, "지하철거리_보완.json"), encoding="utf-8"))
    med_sub = [(x, y) for x, y in zip(sub["meta"]["구간_가운데_m"], sub["③선택비_10분위"]["의료"]["점수"])]

    pops = ef.load_population()
    pts, vals, _ = ef.build_oa_points(pops)
    W = np.array([[vals[p[2]][k] for k in ldr.KEYS] for p in pts])
    px, py = lar.proj(np.array([p[1] for p in pts]), np.array([p[0] for p in pts]))
    S, _ = ls.store_rows()
    sx, sy = lar.proj(np.array([s[0] for s in S]), np.array([s[1] for s in S]))
    metro, dk, M, Kd = ldc.station_rows()
    both = np.vstack([M, Kd])

    listings, ext, bld, use, cfs, cost = we.load()
    v2 = {r["매물번호"]: r for r in csv.DictReader(open(os.path.join(se.OUT, "점수_v2.csv"), encoding="utf-8-sig", newline=""))}
    recs = []
    for L in listings:
        la, lo = se.num(L["위도"]), se.num(L["경도"])
        if la is None or lo is None:
            continue
        recs.append(L)
    lat = np.array([se.num(L["위도"]) for L in recs])
    lon = np.array([se.num(L["경도"]) for L in recs])
    dbus = [se.num(L["정류소거리_m"]) for L in recs]
    dsub = ls.nearest_dist(lat, lon, both)
    Bs = np.array([se.interp(ldt.D12, x) if x is not None else np.nan for x in dbus])
    lx, ly = lar.proj(lat, lon)
    act = lar.counts_at(lx, ly, sx, sy, [200])[:, 0]
    A_ = np.array([se.interp(ldt.D14, x) for x in act])
    pop = ldr.sums_at(lx, ly, px, py, W, [300])[0]
    col = {k: pop[:, j] for j, k in enumerate(ldr.KEYS)}
    D_common = np.array([se.interp(common_d, x) for x in col["pop_20_49"]])

    def factors(c):
        sub_curve = med_sub if c == "의료" else ldt.D11
        S_ = np.array([se.interp(sub_curve, x) for x in dsub])
        T = np.where(np.isnan(Bs), S_, 0.6 * S_ + 0.4 * np.nan_to_num(Bs))
        D = np.array([se.interp(spec_d[c], x) for x in col[SPEC_D[c]]]) if c in SPEC_D else D_common
        return np.column_stack([T, A_, D])

    F_all = {c: factors(c) for c in se.CATS}

    # ---------------- ① 시장 가치: 헤도닉 (임대료 있는 매물)
    hi, rows = [], []
    for i, L in enumerate(recs):
        area, r = se.num(L["전용면적"]), se.converted_rent(L)
        if not area or not r or r <= 0:
            continue
        hi.append(i)
        rows.append((L, area, r, bar.age_of(L)))
    hi = np.array(hi)
    fe = lambda L: (L["구"], L["법정동"])
    X0, y, cl, _ = ltr.design(rows, [], fe)
    n_h = len(y)
    Fc = np.column_stack([np.where(np.isnan(Bs), np.array([se.interp(ldt.D11, x) for x in dsub]),
                                   0.6 * np.array([se.interp(ldt.D11, x) for x in dsub]) + 0.4 * np.nan_to_num(Bs)), A_, D_common])[hi]

    def ols_rss(X):
        b, *_ = np.linalg.lstsq(X, y, rcond=None)
        u = y - X @ b
        return b, float(u @ u)

    Xf = np.hstack([Fc / 100, X0])
    b, s, r2, G = bar.ols_cluster(Xf, y, cl)
    coef = b[:3]
    # 건물 군집 부트스트랩: 계수 비례 비중의 흔들림
    groups = {}
    for i, g in enumerate(cl):
        groups.setdefault(g, []).append(i)
    gl = list(groups.values())
    rng = np.random.default_rng(SEED)
    bw = []
    for _ in range(NB):
        idx = np.concatenate([gl[j] for j in rng.integers(0, len(gl), len(gl))])
        bb, *_ = np.linalg.lstsq(Xf[idx], y[idx], rcond=None)
        c3 = np.maximum(bb[:3], 0)
        bw.append(c3 / c3.sum() * 100 if c3.sum() > 0 else np.full(3, 100 / 3))
    bw = np.array(bw)
    w_market_raw = np.maximum(coef, 0) / np.maximum(coef, 0).sum() * 100
    w_market = round_to_5(w_market_raw)
    # 설명력 나눔(샤플리): 세 점수 열을 넣고 뺀 모든 조합의 RSS 감소
    _, rss0 = ols_rss(X0)
    from itertools import combinations
    def rss_of(sub_):
        return ols_rss(np.hstack([Fc[:, list(sub_)] / 100, X0]))[1] if sub_ else rss0
    shap = np.zeros(3)
    for j in range(3):
        others = [k for k in range(3) if k != j]
        for r_ in range(3):
            for S_ in combinations(others, r_):
                wgt = math.factorial(len(S_)) * math.factorial(3 - len(S_) - 1) / math.factorial(3)
                shap[j] += wgt * (rss_of(S_) - rss_of(tuple(sorted(S_ + (j,)))))
    shap_w = shap / shap.sum() * 100
    market = {"n": n_h, "건물군집": G, "R2": round(float(r2), 4),
              "점수100점당_임대료차이_%": {nm: round(100 * (math.exp(coef[j]) - 1), 1) for j, nm in enumerate(se.FACTORS["입지"])},
              "95%_%": {nm: [round(100 * (math.exp(coef[j] - 1.96 * s[j]) - 1), 1), round(100 * (math.exp(coef[j] + 1.96 * s[j]) - 1), 1)]
                        for j, nm in enumerate(se.FACTORS["입지"])},
              "계수비례_비중": [round(float(x), 1) for x in w_market_raw],
              "계수비례_비중_부트_90%": [[round(float(x), 1) for x in np.percentile(bw[:, j], [5, 95])] for j in range(3)],
              "설명력나눔_비중": [round(float(x), 1) for x in shap_w],
              "후보(5간격·최소10)": w_market}

    # ---------------- 후보 비중
    labeled = [i for i, L in enumerate(recs) if use[L["매물번호"]]["cats"]]
    li = np.array(labeled)
    keys = [recs[i]["매물번호"] for i in labeled]
    gu = np.array([recs[i]["구"] for i in labeled])
    rnd = np.random.default_rng(SEED)
    fold = rnd.permutation(len(li)) % K
    n = len(li)

    def other_parts(c):
        return [np.array([se.num(v2[k].get(nm + "_" + c)) if k in v2 else None for k in keys], dtype=float) for nm in ("비용", "공간")]

    def total(c, loc):
        g = se.PRESET[c]["g"]
        ps = list(zip(g[:2], other_parts(c))) + [(g[2], loc)]
        return sum(wt * np.nan_to_num(x) for wt, x in ps) / sum(wt * (~np.isnan(x)) for wt, x in ps)

    boot = [rng.integers(0, n, n) for _ in range(B)]
    fns = {"AUC": lambda s_, y_, g_: ls.fast_auc(s_, y_), "상위50": lambda s_, y_, g_: ldt.prec_at(s_, y_, 50),
           "구별상위10": lambda s_, y_, g_: ldt.gu_prec(s_, y_, g_)[0]}
    res = {}
    for c in se.CATS:
        F = F_all[c]
        FL = F[li]
        yl = np.array([1 if c in use[k]["cats"] else 0 for k in keys])
        cur = list(se.PRESET[c]["s"]["입지"])

        def best(Fx, yx):
            bw_, ba = None, -1
            for w in GRID:
                a = ls.fast_auc(combine(Fx, w), yx)
                if a > ba:
                    bw_, ba = w, a
            return list(bw_)

        w_label = best(FL, yl)
        oof = np.zeros(n)
        folds_w = []
        for f in range(K):
            tr, te = fold != f, fold == f
            w = best(FL[tr], yl[tr])
            folds_w.append(w)
            oof[te] = combine(FL[te], w)
        ok = ~np.isnan(F).any(1)
        w_critic = round_to_5(critic(F[ok]))
        # 역할 나눔: 업종별 곡선 칸은 지금 비중 유지, 공통 곡선 칸은 남은 몫을 시장 가치 비율로 나눔
        spec_slots = {"교육": [2], "의료": [0, 2]}.get(c, [])
        if spec_slots:
            w_role = np.array(cur, float)
            free = [j for j in range(3) if j not in spec_slots]
            rest = 100 - w_role[spec_slots].sum()
            mk = np.array(w_market, float)[free]
            w_role[free] = rest * mk / mk.sum()
            w_role = round_to_5(w_role)
        else:
            w_role = w_market
        cands = {"지금": cur, "시장": w_market, "역할나눔": w_role, "라벨": w_label, "CRITIC": w_critic}
        # ① 시장 가치 적합 (업종 자기 인자 점수로)
        Fh = F[hi]
        rss = {}
        for nm, w in cands.items():
            sc = combine(Fh, w)
            rss[nm] = ols_rss(np.hstack([sc[:, None] / 100, X0]))[1]
        best_rss = min(rss.values())
        aic = {nm: round(n_h * math.log(v / best_rss), 1) for nm, v in rss.items()}
        # ② 후보 추리기
        tots = {nm: total(c, combine(FL, w)) for nm, w in cands.items()}
        tots["라벨"] = total(c, oof)
        r = {"비중": cands, "라벨_겹별": folds_w, "시장가치_ΔAIC(최선=0)": aic, "무작위": round(float(yl.mean()), 3)}
        for nm, sc in tots.items():
            r[nm] = {m: round(f(sc, yl, gu), 3) for m, f in fns.items()}
            if nm != "지금":
                ci = {}
                for m, f in fns.items():
                    d = [f(sc[ii], yl[ii], gu[ii]) - f(tots["지금"][ii], yl[ii], gu[ii]) for ii in boot]
                    lo_, hi_ = float(np.quantile(d, .025)), float(np.quantile(d, .975))
                    ci[m] = [round(lo_, 3), round(hi_, 3), "오름" if lo_ > 0 else ("내림" if hi_ < 0 else "구분 안 됨")]
                r[nm]["지금대비_95%"] = ci
        res[c] = r
        print("\n==", c, "무작위", r["무작위"], "| 비중", cands, "| 겹별", folds_w, "| ΔAIC", aic)
        for nm in cands:
            print("  ", nm, {m: r[nm][m] for m in fns}, {m: r[nm]["지금대비_95%"][m][2] for m in fns} if nm != "지금" else "")

    print("\n시장 가치:", json.dumps(market, ensure_ascii=False))
    out = {"meta": {"작성": "2026-11-27", "규칙": "입지 공통 규칙 (가) 역할 나눔", "격자": "5 간격, 인자마다 최소 10",
                    "라벨_표본": n, "부트스트랩": B, "군집부트스트랩": NB, "비교점수": "비용 + 공간 + 입지 (업종 적합 제외)"},
           "시장가치": market, "업종": res}
    json.dump(out, open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.exit(main())
