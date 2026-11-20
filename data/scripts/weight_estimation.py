"""업종별 그룹 안 비중을 중개사 추천 라벨로 추정한다 (설문 없이, 같은 규칙을 모든 업종에).

질문: "그 업종을 추천받은 매물이 그 인자에서 다른 매물과 얼마나 다른가"
  - 라벨: 추천용도·특징에서 업종이 명시된 매물만 쓴다(다용도만·신호 없음은 제외).
          y = 1 이면 그 업종이 명시됨, 0 이면 다른 업종만 명시됨.
  - 방법 3가지 (적합도 '상')
      선택비(FR) : 인자 구간(값 6개 이하면 값마다, 아니면 순위 5분위)별 선택비 = P(구간|y=1) ÷ P(구간|전체).
                   강도 = Σ P(구간) × |선택비 − 1|. 업종 매물 평균이 전체보다 낮으면(방향 반대) 0.
      증거가중치(WofE) : 패턴 = 인자 ≥ 중앙값. W+ = ln P(E|y=1)/P(E|y=0), W− = ln P(Ē|y=1)/P(Ē|y=0),
                   대비 C = W+ − W− (빈도에 0.5 보정). 음수면 0.
      로지스틱 회귀(LR) : 그룹 안 인자를 표준화해 함께 넣은 로지스틱 회귀의 계수. 음수면 0.
    강도를 그룹 안에서 합 100으로 나눠 비중으로 쓴다.
  - 순환 방지: 층 점수표·기본 면적은 같은 라벨로 만들어지므로, 공간 그룹은 5겹 교차로
    "그 매물이 빠진 나머지로 만든 층 점수표·기본 면적"으로 계산한 점수(OOF)로 추정한다.
  - 업종 적합 그룹은 용도 일치도가 라벨 자체라 추정하지 않는다.
  - 검증: 5겹 교차 AUC(그룹 점수로 업종 라벨을 얼마나 가려내나), 부트스트랩 200회 비중 구간,
          새 비중으로 다시 매긴 총점의 순위 상관·상위 10 유지(그룹 가중치·업종 적합은 그대로).
  - 조건: factor_sensitivity.py와 같은 조건(월세 상한 300만 원, 보증금 상한·희망 면적 미입력).
          비용 = 임대료 부담+보증금(환산 월 임대료 분위 점수, 2026-11-18 통합) · 가성비.
  - CRITIC(Diakoulaki 외 1995) 비교: 전체 매물의 업종별 인자 점수로 그룹 안 비중과 업종별 그룹 가중치를 계산하고,
    공간 그룹은 OOF 점수로 판별력(AUC)을 선택비와 비교, 난수 인자를 끼워 넣는 시험도 함께 기록한다.

출력  data/09.스코어링/업종별_그룹안비중_추정.json
실행  py -I data/scripts/weight_estimation.py
"""
import csv
import json
import os
import random
import sys
from statistics import median

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scoring_engine as se  # noqa: E402
import factor_sensitivity as fs  # noqa: E402

K = 5
SEED = 42
N_BOOT = 200
GROUPS_EST = ["비용", "공간", "입지"]
METHODS = ["FR", "WofE", "LR"]
OUT_JSON = os.path.join(se.OUT, "업종별_그룹안비중_추정.json")


# ------------------------------------------------------------------ 강도 계산
def fr_strength(v, y):
    n, n1 = len(v), y.sum()
    if n1 == 0:
        return 0.0
    uniq = np.unique(v)
    if len(uniq) <= 6:
        bins = np.searchsorted(uniq, v)
    else:
        order = np.argsort(v, kind="mergesort")
        r = np.empty(n)
        r[order] = np.arange(n)
        # 같은 값은 같은 구간: 값별 평균 순위
        _, inv = np.unique(v, return_inverse=True)
        avg = np.bincount(inv, weights=r) / np.bincount(inv)
        bins = np.minimum((avg[inv] / n * 5).astype(int), 4)
    s = 0.0
    for b in np.unique(bins):
        m = bins == b
        pb = m.mean()
        sr = (y[m].sum() / n1) / pb
        s += pb * abs(sr - 1)
    return s if v[y == 1].mean() >= v.mean() else 0.0


def wofe_strength(v, y):
    med = np.median(v)
    e = v >= med
    if e.all() or (~e).all():
        e = v > med
    if e.all() or (~e).all():
        return 0.0
    a = (e & (y == 1)).sum() + .5
    b = (e & (y == 0)).sum() + .5
    c = (~e & (y == 1)).sum() + .5
    d = (~e & (y == 0)).sum() + .5
    n1, n0 = a + c, b + d
    wp = np.log((a / n1) / (b / n0))
    wm = np.log((c / n1) / (d / n0))
    return max(0.0, wp - wm)


def lr_coef(X, y, lam=1e-3, it=30):
    sd = X.std(0)
    sd[sd == 0] = 1
    Z = (X - X.mean(0)) / sd
    Z1 = np.hstack([np.ones((len(Z), 1)), Z])
    b = np.zeros(Z1.shape[1])
    P = np.eye(Z1.shape[1]) * lam
    P[0, 0] = 0
    for _ in range(it):
        p = 1 / (1 + np.exp(-np.clip(Z1 @ b, -30, 30)))
        W = p * (1 - p)
        H = (Z1 * W[:, None]).T @ Z1 + P
        g = Z1.T @ (y - p) - P @ b
        step = np.linalg.solve(H, g)
        b += step
        if np.abs(step).max() < 1e-8:
            break
    return b[1:]


def strengths(X, y, method):
    if method == "FR":
        return np.array([fr_strength(X[:, j], y) for j in range(X.shape[1])])
    if method == "WofE":
        return np.array([wofe_strength(X[:, j], y) for j in range(X.shape[1])])
    return np.maximum(lr_coef(X, y), 0)


def to_weights(s):
    t = s.sum()
    return None if t <= 0 else s / t * 100


def auc(score, y):
    pos, neg = score[y == 1], score[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return None
    r = fs.rank(list(np.concatenate([pos, neg])))
    return (sum(r[:len(pos)]) - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


# ------------------------------------------------------------------ 데이터
def load():
    with open(se.LISTING_CSV, encoding="utf-8-sig", newline="") as f:
        listings = list(csv.DictReader(f))
    ext = {r["매물번호"]: r for r in csv.DictReader(open(se.EXT_CSV, encoding="utf-8-sig", newline=""))}
    bld = {r["매물번호"]: r for r in csv.DictReader(open(se.BLD_CSV, encoding="utf-8-sig", newline=""))}
    use = {L["매물번호"]: se.classify_listing(L) for L in listings}
    gd, gg = {}, {}
    for L in listings:
        r, a = se.num(L["월세"]), se.num(L["전용면적"])
        if r and a:
            gd.setdefault((L["구"], L["법정동"], L["층"].startswith("1층")), []).append(r / a)
            gg.setdefault((L["구"], L["층"].startswith("1층")), []).append(r / a)
    value_ref = {"dong": {k: median(v) for k, v in gd.items() if len(v) >= se.VALUE_MIN_N}, "gu": {k: median(v) for k, v in gg.items()}}
    cfs = {L["매물번호"]: se.common_factors(L, value_ref, use[L["매물번호"]]) for L in listings}
    cost, _ = se.make_cost_scorer(listings, fs.RENT_CAP, fs.DEPOSIT_CAP)
    return listings, ext, bld, use, cfs, cost


def factors_with(basis, ids, listings_by, ext, bld, cfs, cost):
    out = {c: {} for c in se.CATS}
    for k in ids:
        for c in se.CATS:
            _, _, fac, _ = se.score_listing(cfs[k], ext.get(k), bld.get(k), c, basis, cost.get(k), None)
            out[c][k] = fac
    return out


def matrix(facs_c, ids, names):
    rows, keep = [], []
    for k in ids:
        vals = [facs_c[k][n] for n in names]
        if all(v is not None for v in vals):
            rows.append(vals)
            keep.append(k)
    return np.array(rows, dtype=float), keep


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    listings, ext, bld, use, cfs, cost = load()
    by = {L["매물번호"]: L for L in listings}
    ids = [L["매물번호"] for L in listings]
    basis = se.build_basis(listings, use)
    full = factors_with(basis, ids, by, ext, bld, cfs, cost)

    # 공간 그룹: 5겹 교차로 층·면적 점수를 다시 계산 (자기 라벨이 층 점수표·기본 면적에 들어가지 않게)
    rnd = random.Random(SEED)
    sh = ids[:]
    rnd.shuffle(sh)
    fold = {k: i % K for i, k in enumerate(sh)}
    oof = {c: {k: dict(full[c][k]) for k in ids} for c in se.CATS}
    for f in range(K):
        train = [L for L in listings if fold[L["매물번호"]] != f]
        test = [k for k in ids if fold[k] == f]
        b_f = se.build_basis(train, use)
        part = factors_with(b_f, test, by, ext, bld, cfs, cost)
        for c in se.CATS:
            for k in test:
                oof[c][k]["층"] = part[c][k]["층"]
                oof[c][k]["면적적합도"] = part[c][k]["면적적합도"]

    labeled = [k for k in ids if use[k]["cats"]]
    rng = np.random.default_rng(SEED)
    res = {"조건": {"월세상한": fs.RENT_CAP, "보증금상한": fs.DEPOSIT_CAP, "라벨매물": len(labeled), "교차겹": K, "부트스트랩": N_BOOT}, "업종": {}}

    for c in se.CATS:
        y_all = {k: 1 if c in use[k]["cats"] else 0 for k in labeled}
        rc = {"양성": sum(y_all.values()), "그룹": {}}
        for g in GROUPS_EST:
            names = se.FACTORS[g]
            src = oof if g == "공간" else full
            Xa, keep = matrix(src[c], labeled, names)
            # 전부 결측인 인자(예: 공연문화 층)는 빼고 추정
            usable = [j for j, n in enumerate(names) if all(src[c][k][n] is not None for k in labeled[:1]) or True]
            if g == "공간" and se.PRESET[c] and basis[c]["floor"] is None:
                usable = [1, 2]
                Xa, keep = matrix(src[c], labeled, [names[j] for j in usable])
            else:
                usable = list(range(len(names)))
            y = np.array([y_all[k] for k in keep])
            cur = np.array([se.PRESET[c]["s"][g][j] for j in usable], dtype=float)
            cur = cur / cur.sum() * 100
            out = {"인자": [names[j] for j in usable], "표본": len(keep), "양성": int(y.sum()), "현재": [round(float(x), 1) for x in cur], "방법": {}}
            # 교차 AUC
            idx = np.arange(len(keep))
            rng.shuffle(idx)
            folds = np.array_split(idx, K)
            auc_cur, auc_m = [], {m: [] for m in METHODS}
            for f in range(K):
                te = folds[f]
                tr = np.concatenate([folds[i] for i in range(K) if i != f])
                a = auc(Xa[te] @ cur, y[te])
                if a is not None:
                    auc_cur.append(a)
                for m in METHODS:
                    w = to_weights(strengths(Xa[tr], y[tr], m))
                    if w is None:
                        continue
                    a = auc(Xa[te] @ w, y[te])
                    if a is not None:
                        auc_m[m].append(a)
            out["AUC_현재"] = round(float(np.mean(auc_cur)), 3)
            for m in METHODS:
                w = to_weights(strengths(Xa, y, m))
                boots = []
                for _ in range(N_BOOT):
                    bi = rng.integers(0, len(keep), len(keep))
                    wb = to_weights(strengths(Xa[bi], y[bi], m))
                    if wb is not None:
                        boots.append(wb)
                boots = np.array(boots)
                lo, hi = (np.percentile(boots, 5, axis=0), np.percentile(boots, 95, axis=0)) if len(boots) else (None, None)
                out["방법"][m] = {
                    "비중": None if w is None else [round(float(x), 1) for x in w],
                    "구간90": None if lo is None else [[round(float(a), 1), round(float(b), 1)] for a, b in zip(lo, hi)],
                    "구간폭평균": None if lo is None else round(float(np.mean(hi - lo)), 1),
                    "AUC": round(float(np.mean(auc_m[m])), 3) if auc_m[m] else None,
                }
            rc["그룹"][g] = out
        res["업종"][c] = rc

    # 새 비중으로 다시 매긴 총점 비교 (그룹 가중치·업종 적합은 그대로)
    def total(fac, c, s):
        p = se.PRESET[c]
        groups = {g: se.wavg([(w, fac[n]) for w, n in zip(s[g], se.FACTORS[g])])[0] for g in se.GROUPS}
        t, _ = se.wavg([(p["g"][gi], groups[g]) for gi, g in enumerate(se.GROUPS)])
        return t

    for c in se.CATS:
        p = se.PRESET[c]
        base = {}
        for k in ids:
            t, u = fs.aggregate(full[c][k], c)
            base[k] = t if u >= se.MIN_COVERAGE else None
        res["업종"][c]["총점비교"] = {}
        for m in METHODS:
            s = {g: list(p["s"][g]) for g in se.GROUPS}
            for g in GROUPS_EST:
                o = res["업종"][c]["그룹"][g]
                w = o["방법"][m]["비중"]
                if w is None:
                    continue
                new = [0.0] * len(se.FACTORS[g])
                for n, x in zip(o["인자"], w):
                    new[se.FACTORS[g].index(n)] = x
                s[g] = new
            alt = {k: (total(full[c][k], c, s) if base[k] is not None else None) for k in ids}
            res["업종"][c]["총점비교"][m] = fs.compare(base, alt)
        # 권장안: 공간 그룹만 선택비(FR)로 바꿈
        s = {g: list(p["s"][g]) for g in se.GROUPS}
        o = res["업종"][c]["그룹"]["공간"]
        if o["방법"]["FR"]["비중"] is not None:
            new = [0.0] * len(se.FACTORS["공간"])
            for n, x in zip(o["인자"], o["방법"]["FR"]["비중"]):
                new[se.FACTORS["공간"].index(n)] = x
            s["공간"] = new
        alt = {k: (total(full[c][k], c, s) if base[k] is not None else None) for k in ids}
        res["업종"][c]["총점비교"]["FR_공간만"] = fs.compare(base, alt)


    # ------------------------------------------------------------ CRITIC 비교
    def critic(X):
        mn, mx = X.min(0), X.max(0)
        Z = (X - mn) / np.where(mx > mn, mx - mn, 1)
        sd = Z.std(0)
        R = np.nan_to_num(np.corrcoef(Z, rowvar=False)) if X.shape[1] > 1 else np.ones((1, 1))
        C = sd * (1 - R).sum(0)
        return C / C.sum() * 100

    cr = {"그룹안": {}, "그룹가중치": {}, "공간_AUC": {}}
    for c in se.CATS:
        cr["그룹안"][c] = {}
        for g in se.GROUPS:
            names = se.FACTORS[g] if not (g == "공간" and basis[c]["floor"] is None) else ["면적적합도", "건물연식"]
            X, _ = matrix(full[c], ids, names)
            w = critic(X)
            boots = np.array([critic(X[rng.integers(0, len(X), len(X))]) for _ in range(N_BOOT)])
            width = float(np.mean(np.percentile(boots, 95, 0) - np.percentile(boots, 5, 0)))
            cur = np.array([se.PRESET[c]["s"][g][se.FACTORS[g].index(n)] for n in names], float)
            cr["그룹안"][c][g] = {"인자": names, "CRITIC": [round(float(x), 1) for x in w], "현재": [round(float(x), 1) for x in cur / cur.sum() * 100],
                               "구간폭평균": round(width, 1), "표본": len(X)}
        # 공간 판별력: OOF 점수로 현재 · 선택비 · CRITIC
        o = res["업종"][c]["그룹"]["공간"]
        Xo, keep = matrix(oof[c], labeled, o["인자"])
        y = np.array([1 if c in use[k]["cats"] else 0 for k in keep])
        wc = np.array(cr["그룹안"][c]["공간"]["CRITIC"])
        cr["공간_AUC"][c] = {"현재": round(auc(Xo @ np.array(o["현재"]), y), 3), "선택비": round(auc(Xo @ np.array(o["방법"]["FR"]["비중"]), y), 3),
                            "CRITIC": round(auc(Xo @ wc, y), 3)}
        # 업종별 그룹 가중치: 현재 그룹 안 비중으로 만든 그룹 점수 4개
        p = se.PRESET[c]
        rows = []
        for k in ids:
            fac = full[c][k]
            gs = [se.wavg([(w, fac[n]) for w, n in zip(p["s"][g], se.FACTORS[g])])[0] for g in se.GROUPS]
            if all(v is not None for v in gs):
                rows.append(gs)
        cr["그룹가중치"][c] = {"CRITIC": [round(float(x), 1) for x in critic(np.array(rows, float))], "현재": p["g"], "표본": len(rows)}
    Xn, _ = matrix(full["식음료"], ids, se.FACTORS["입지"])
    Xn = np.hstack([Xn, rng.uniform(0, 100, (len(Xn), 1))])
    cr["난수시험"] = {"설명": "식음료 입지 그룹에 0~100 난수 인자를 끼워 넣었을 때 CRITIC 비중 (교통·활성도·배후·난수)",
                   "CRITIC": [round(float(x), 1) for x in critic(Xn)]}
    res["CRITIC"] = cr

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print("작성:", OUT_JSON)
    for c in se.CATS:
        r = res["업종"][c]
        print(f"\n[{c}] 양성 {r['양성']}")
        for g in GROUPS_EST:
            o = r["그룹"][g]
            line = f"  {g} {'·'.join(o['인자'])} n={o['표본']}/{o['양성']} 현재 {o['현재']} AUC {o['AUC_현재']}"
            for m in METHODS:
                x = o["방법"][m]
                line += f" | {m} {x['비중']} AUC {x['AUC']} 폭 {x['구간폭평균']}"
            print(line)
        print("  총점비교", {m: (v["순위상관"], v["상위10유지"], v["평균변화"]) for m, v in r["총점비교"].items()})


if __name__ == "__main__":
    sys.exit(main())
