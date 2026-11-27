"""D1 (다)안: AUC 최적 + 인자마다 최소 비중 (2026-11-25). 엔진은 바꾸지 않는다.

space_weight_d1.py와 같은 인자 점수·라벨·5겹을 쓰고, 격자만 "층·면적·연식 모두 최소 비중 이상"으로 좁힌다.
  최소 10 → 5 간격 격자 120개
이유  (가) AUC 최적에서 사무업무 100·0·0, 소매 면적 0, 공연문화 연식 0처럼 인자가 꺼짐.
      라벨이 중개사 추천(대리 라벨)이라, 층이 라벨을 거의 그대로 맞히는 쪽으로 지나치게 맞춘 결과일 위험.
      최소 비중 = 가중치 하한 제약(bounded weights). 판별력을 얼마나 잃는지 같은 5겹으로 잰다.
출력  09.스코어링/공간_그룹안비중_D1_최소비중.json
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scoring_engine as se  # noqa: E402
import space_weight_d1 as d1  # noqa: E402

MINW = 10
NB = 200
OUT = os.path.join(se.OUT, "공간_그룹안비중_D1_최소비중.json")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    prev = json.load(open(d1.OUT, encoding="utf-8"))["업종"]
    grid = [w for w in d1.GRID if min(w) >= MINW]
    labeled, fl, fac, use = d1.build_factors()
    rng = np.random.default_rng(d1.SEED)
    res = {}
    for c in se.CATS:
        F = np.array([fac[c][k] for k in labeled], dtype=float)
        M = ~np.isnan(F)
        y = np.array([1 if c in use[k]["cats"] else 0 for k in labeled])

        def best(Fx, Mx, yx):
            bw, ba = None, -1
            for w in grid:
                a = d1.fast_auc(d1.combine(Fx, Mx, w), yx)
                if a > ba:
                    bw, ba = w, a
            return bw

        pred = np.zeros(len(y))
        chosen = []
        for f in range(d1.K):
            tr, te = fl != f, fl == f
            w = best(F[tr], M[tr], y[tr])
            chosen.append(w)
            pred[te] = d1.combine(F[te], M[te], w)
        boot = np.array([best(F[i], M[i], y[i]) for i in (rng.integers(0, len(y), len(y)) for _ in range(NB))])
        p = prev[c]
        res[c] = {"지금비중": p["지금비중"], "AUC최적_전체": p["AUC최적_전체"], "FR비중_전체": p["FR비중_전체"],
                  "최소비중_전체": list(best(F, M, y)), "최소비중_겹별": chosen,
                  "최소비중_부트_중앙값": [int(x) for x in np.median(boot, 0)],
                  "최소비중_부트_90%": [[int(x) for x in np.percentile(boot[:, j], [5, 95])] for j in range(3)],
                  "AUC_교차": {**p["AUC_교차"], "최소비중": round(d1.fast_auc(pred, y), 4)}}
        r = res[c]
        print(c, "| 지금", r["지금비중"], "| 최적", r["AUC최적_전체"], "| 최소", r["최소비중_전체"], "겹별", chosen,
              "| 부트 90%", r["최소비중_부트_90%"], "| AUC", r["AUC_교차"], flush=True)
    json.dump({"meta": {"작성": "2026-11-25", "최소비중": MINW, "격자": f"5 간격, 모두 {MINW} 이상 {len(grid)}개",
                        "교차겹": d1.K, "부트스트랩": NB, "시드": d1.SEED}, "업종": res},
              open(OUT, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1)
    print("작성:", OUT)


if __name__ == "__main__":
    sys.exit(main())
