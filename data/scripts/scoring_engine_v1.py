"""업종별 공실 추천 점수 엔진 (v1).

총점 = Σ(그룹 가중치 × 그룹 점수) ÷ Σ(데이터가 있는 그룹의 가중치)
그룹 점수 = Σ(세부 비중 × 인자 점수) ÷ Σ(데이터가 있는 인자의 세부 비중)
  → 데이터가 없는 인자는 채우지 않고 빼고, 같은 그룹 안에서 비중을 재분배한다.
  → 기준값은 대구 전체 분포로 고정(절대평가). 사용자 입력에 맞추는 인자는 임대료 부담(예산), 면적 적합도(희망 면적)뿐.

입력
  data/07.대구_매물유형별_csv/대구_구역별_매물 (최종).csv   기본 매물
  data/09.스코어링/외부인자_v1.csv                         상권 활성도, 배후 수요 (external_factors.py)
  data/09.스코어링/건물용도_v1.csv                         건물 용도 적합성 (building_use.py)
출력
  data/09.스코어링/점수_v1.csv          매물별 공통 인자 점수 + 업종별 총점·그룹 점수·업종 인자 점수
  data/09.스코어링/점수_v1_config.json  이 엔진의 가중치·기준값 (화면과 피드백 스냅샷이 같은 값을 쓰도록)
  data/09.스코어링/점수_v1_검사.json    분포, 데이터 반영률, 업종 간 상위 10개 겹침

실행: py -I data/scripts/scoring_engine.py [--budget 300] [--want 80]
"""
import csv
import json
import os
import re
import sys
from datetime import date
from statistics import median

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "09.스코어링")
LISTING_CSV = os.path.join(DATA, "07.대구_매물유형별_csv", "대구_구역별_매물 (최종).csv")
EXT_CSV = os.path.join(OUT, "외부인자_v1.csv")
BLD_CSV = os.path.join(OUT, "건물용도_v1.csv")
VERSION = "v1"
TODAY = date(2026, 11, 10)

CATS = ["식음료", "소매", "뷰티", "공연문화", "사무업무", "교육", "의료", "운동시설"]
GROUPS = ["비용", "공간", "입지", "업종적합"]
FACTORS = {"비용": ["임대료부담", "가성비", "보증금"], "공간": ["층", "면적적합도", "건물연식"],
           "입지": ["교통", "상권활성도", "배후수요"], "업종적합": ["용도일치도", "건물용도"]}

S_DEFAULT = {"비용": [50, 30, 20], "공간": [50, 35, 15], "입지": [30, 40, 30], "업종적합": [40, 60]}
S_DEST = {"비용": [50, 30, 20], "공간": [35, 45, 20], "입지": [25, 25, 50], "업종적합": [40, 60]}
PRESET = {
    "식음료":   {"g": [25, 20, 35, 20], "s": S_DEFAULT, "floor": [100, 68, 56, 40], "area": 77, "subway": 0.6},
    "소매":     {"g": [25, 20, 35, 20], "s": S_DEFAULT, "floor": [100, 55, 50, 40], "area": 70, "subway": 0.6},
    "뷰티":     {"g": [25, 20, 35, 20], "s": S_DEFAULT, "floor": [100, 90, 69, 40], "area": 60, "subway": 0.6},
    "공연문화": {"g": [35, 30, 20, 15], "s": {"비용": [40, 30, 30], "공간": [30, 50, 20], "입지": [40, 40, 20], "업종적합": [40, 60]},
                 "floor": [86, 100, 81, None], "area": 101, "subway": 0.6},
    "사무업무": {"g": [35, 25, 30, 10], "s": {"비용": [50, 30, 20], "공간": [35, 45, 20], "입지": [50, 20, 30], "업종적합": [40, 60]},
                 "floor": [58, 88, 100, 40], "area": 130, "subway": 0.7},
    "교육":     {"g": [30, 20, 25, 25], "s": S_DEST, "floor": [45, 84, 100, 40], "area": 172, "subway": 0.6},
    "의료":     {"g": [20, 20, 25, 35], "s": S_DEST, "floor": [47, 78, 100, 40], "area": 239, "subway": 0.6},
    "운동시설": {"g": [30, 30, 20, 20], "s": S_DEST, "floor": [42, 93, 100, 40], "area": 230, "subway": 0.6},
}
# 구간 기준값 (x, 점수) — 사이는 선형 보간, 양끝은 끝값 유지. 근거는 대구 매물 2,717건 분포.
BP = {
    "가성비":   [(0.5, 100), (1.0, 60), (1.5, 20), (1.75, 0)],          # ㎡당 월세 ÷ 같은 동·층대 중앙값
    "보증금":   [(500, 100), (2000, 60), (8000, 20), (10000, 10)],       # 만원 (p10 / 중앙값 / p90)
    "임대료부담": [(0.5, 100), (1.0, 40)],                                 # (월세+관리비) ÷ 예산
    "면적_넓음": [(0.2, 100), (0.5, 70), (1.0, 40), (2.0, 10)],          # (실제−목표)÷목표, 양수
    "면적_좁음": [(0.2, 100), (0.3, 60), (0.5, 20), (0.6, 0)],           # 음수의 절댓값
    "건물연식": [(5, 100), (10, 85), (20, 65), (30, 45), (40, 30)],      # 년
    "지하철":   [(250, 100), (500, 75), (850, 50), (1500, 20), (2000, 10)],  # m
    "버스":     [(60, 100), (100, 80), (150, 60), (250, 30)],             # m
}
MUGWONRI_BONUS = 10
# 결측 재분배는 인자 몇 개가 빌 때는 괜찮지만, 그룹 하나가 통째로 비면(예: 좌표 없음 → 입지 전체) 남은 그룹이
# 과대 반영되어 점수가 부풀 수 있다. 그래서 100점 배점 중 실제 값이 들어간 배점이 이 값 미만이면 추천 순위에서 뺀다.
MIN_COVERAGE = 60
VALUE_MIN_N = 10
USE_SCORE = {"명시": 100, "다용도": 60, "신호없음": 50, "타업종만": 30}
USE_KW = {
    "식음료": r"카페|커피|음식|식당|요식|베이커리|제과|술집|주점|호프|치킨|분식|휴게|고깃|횟집|레스토랑|포차|이자카야|배달",
    "소매": r"소매|판매점|매장|의류|옷가게|잡화|편의점|마트|화장품|꽃집|휴대폰|핸드폰|안경",
    "뷰티": r"미용|헤어|네일|에스테틱|뷰티|피부관리|속눈썹|왁싱|바버",
    "공연문화": r"공연|연습실|스튜디오|갤러리|공방|소극장|댄스|음악|촬영|전시",
    "사무업무": r"사무실|사무|오피스|업무",
    "교육": r"학원|교습|공부방|교육|스터디|독서실|과외|어린이집|키즈",
    "의료": r"병원|의원|치과|한의원|병의원|메디컬|정형외과|피부과|소아과|안과|이비인후과|내과|산부인과|약국",
    "운동시설": r"요가|필라테스|피트니스|헬스|PT|체육관|태권도|주짓수|복싱|골프",
}
MULTI_KW = r"다용도|업종\s*무관|모든\s*업종|업종\s*제한\s*(없|x|X|無)|아무\s*업종"


def interp(bp, x):
    if x is None:
        return None
    if x <= bp[0][0]:
        return float(bp[0][1])
    for (x0, y0), (x1, y1) in zip(bp, bp[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return float(bp[-1][1])


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def floor_band(s):
    s = (s or "").replace(" ", "")
    if s.startswith("지하"):
        return 3
    m = re.match(r"^(\d+)층$", s)
    if not m:
        return None
    n = int(m.group(1))
    return 0 if n == 1 else (1 if n == 2 else 2)


# ------------------------------------------------------------------ 공통 인자 (업종과 무관)
def common_factors(L, value_ref):
    f = {}
    rent, mgmt = num(L["월세"]), num(L["관리비"]) or 0.0
    area = num(L["전용면적"])
    # 가성비
    if rent and area:
        key_d = (L["구"], L["법정동"], L["층"].startswith("1층"))
        key_g = (L["구"], L["층"].startswith("1층"))
        ref = value_ref["dong"].get(key_d) or value_ref["gu"].get(key_g)
        f["가성비_비율"] = round((rent / area) / ref, 3) if ref else None
        f["가성비"] = interp(BP["가성비"], f["가성비_비율"]) if ref else None
        f["가성비_기준"] = "동·층대" if key_d in value_ref["dong"] else "구·층대"
    else:
        f["가성비"] = None
    # 보증금
    dep = num(L["보증금"])
    mugwon = bool(re.search(r"무권리|無권리|권리금\s*없", (L["특징"] or "") + " " + (L["추천용도"] or "")))
    f["무권리"] = mugwon
    f["보증금"] = None if dep is None else min(100.0, interp(BP["보증금"], dep) + (MUGWONRI_BONUS if mugwon else 0))
    # 건물 연식
    try:
        y = (TODAY - date.fromisoformat(L["사용승인일"])).days / 365.25
        f["건물연식"] = interp(BP["건물연식"], y)
    except ValueError:
        f["건물연식"] = None
    # 교통 (지하철·버스는 업종별 비율로 섞음 → 여기선 각각만)
    f["지하철"] = interp(BP["지하철"], num(L["역거리_m"]))
    f["버스"] = interp(BP["버스"], num(L["정류소거리_m"]))
    # 업종 신호 (용도 일치도용)
    text = (L["추천용도"] or "") + " " + (L["특징"] or "")
    f["_hits"] = {c: bool(re.search(p, text)) for c, p in USE_KW.items()}
    f["_multi"] = bool(re.search(MULTI_KW, text))
    f["_rent_total"] = (rent or 0) + mgmt
    f["_area"] = area
    f["_band"] = floor_band(L["층"])
    f["관리비미기재"] = not (L["관리비"] or "").strip()
    return f


def use_match(cf, cat):
    if cf["_hits"][cat]:
        return USE_SCORE["명시"], "명시"
    if cf["_multi"]:
        return USE_SCORE["다용도"], "다용도"
    if any(cf["_hits"].values()):
        return USE_SCORE["타업종만"], "타업종만"
    return USE_SCORE["신호없음"], "신호없음"


def area_fit(area, target):
    if not area or not target:
        return None
    d = (area - target) / target
    return interp(BP["면적_넓음"], d) if d >= 0 else interp(BP["면적_좁음"], -d)


def wavg(pairs):
    pairs = [(w, v) for w, v in pairs if v is not None and w > 0]
    tw = sum(w for w, _ in pairs)
    return (sum(w * v for w, v in pairs) / tw, tw) if tw else (None, 0)


def score_listing(cf, ext, bld, cat, budget=None, want=None):
    p = PRESET[cat]
    fac = {}
    fac["임대료부담"] = interp(BP["임대료부담"], cf["_rent_total"] / budget) if budget and cf["_rent_total"] <= budget else None
    fac["가성비"] = cf["가성비"]
    fac["보증금"] = cf["보증금"]
    fac["층"] = p["floor"][cf["_band"]] if cf["_band"] is not None else None
    fac["면적적합도"] = area_fit(cf["_area"], want or p["area"])
    fac["건물연식"] = cf["건물연식"]
    sw, bw = p["subway"], 1 - p["subway"]
    fac["교통"], _ = wavg([(sw, cf["지하철"]), (bw, cf["버스"])])
    fac["상권활성도"] = num(ext.get("활성도_" + cat)) if ext else None
    fac["배후수요"] = num(ext.get("배후수요_" + cat)) if ext else None
    fac["용도일치도"], _ = use_match(cf, cat)
    fac["건물용도"] = num(bld.get("용도적합_" + cat)) if bld and bld.get("매칭신뢰도") != "확인필요" else None

    groups, used = {}, 0.0
    for gi, g in enumerate(GROUPS):
        gs, _ = wavg([(w, fac[n]) for w, n in zip(p["s"][g], FACTORS[g])])
        groups[g] = gs
    total, tw = wavg([(p["g"][gi], groups[g]) for gi, g in enumerate(GROUPS)])
    # 데이터 반영률: 100점 배점 중 실제 값이 있어 계산에 들어간 배점의 합
    for gi, g in enumerate(GROUPS):
        for w, n in zip(p["s"][g], FACTORS[g]):
            if fac[n] is not None:
                used += p["g"][gi] * w / 100
    return total, groups, fac, used


# ------------------------------------------------------------------ main
def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    budget = float(args[args.index("--budget") + 1]) if "--budget" in args else None
    want = float(args[args.index("--want") + 1]) if "--want" in args else None

    with open(LISTING_CSV, encoding="utf-8-sig", newline="") as f:
        listings = list(csv.DictReader(f))
    ext = {r["매물번호"]: r for r in csv.DictReader(open(EXT_CSV, encoding="utf-8-sig", newline=""))} if os.path.exists(EXT_CSV) else {}
    bld = {r["매물번호"]: r for r in csv.DictReader(open(BLD_CSV, encoding="utf-8-sig", newline=""))} if os.path.exists(BLD_CSV) else {}

    # 가성비 기준: 같은 법정동·층대(1층/그 외) 중앙값(표본 10건 이상), 아니면 같은 구·층대
    groups_d, groups_g = {}, {}
    for L in listings:
        r, a = num(L["월세"]), num(L["전용면적"])
        if r and a:
            u = r / a
            groups_d.setdefault((L["구"], L["법정동"], L["층"].startswith("1층")), []).append(u)
            groups_g.setdefault((L["구"], L["층"].startswith("1층")), []).append(u)
    value_ref = {"dong": {k: median(v) for k, v in groups_d.items() if len(v) >= VALUE_MIN_N},
                 "gu": {k: median(v) for k, v in groups_g.items()}}

    rows, by_cat = [], {c: [] for c in CATS}
    for L in listings:
        cf = common_factors(L, value_ref)
        e, b = ext.get(L["매물번호"]), bld.get(L["매물번호"])
        row = {"매물번호": L["매물번호"], "구": L["구"], "법정동": L["법정동"], "층": L["층"],
               "전용면적": L["전용면적"], "보증금": L["보증금"], "월세": L["월세"],
               "가성비": rnd(cf["가성비"]), "가성비_비율": cf.get("가성비_비율"), "보증금점수": rnd(cf["보증금"]),
               "건물연식": rnd(cf["건물연식"]), "지하철": rnd(cf["지하철"]), "버스": rnd(cf["버스"]),
               "무권리": cf["무권리"], "관리비미기재": cf["관리비미기재"],
               "건물매칭": (b or {}).get("매칭방법", ""), "건물매칭신뢰도": (b or {}).get("매칭신뢰도", "")}
        for c in CATS:
            total, groups, fac, used = score_listing(cf, e, b, c, budget, want)
            row["총점_" + c] = rnd(total)
            for g in GROUPS:
                row["%s_%s" % (g, c)] = rnd(groups[g])
            for n in ("층", "면적적합도", "교통", "상권활성도", "배후수요", "용도일치도", "건물용도"):
                row["%s_%s" % (n, c)] = rnd(fac[n])
            row["반영률_" + c] = round(used, 1)
            row["추천대상_" + c] = total is not None and used >= MIN_COVERAGE
            by_cat[c].append((total if used >= MIN_COVERAGE else None, L["매물번호"], used, L["구"]))
        rows.append(row)

    fields = list(rows[0].keys())
    with open(os.path.join(OUT, "점수_%s.csv" % VERSION), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    with open(os.path.join(OUT, "점수_%s_config.json" % VERSION), "w", encoding="utf-8") as f:
        json.dump({"version": VERSION, "groups": GROUPS, "factors": FACTORS, "preset": PRESET, "breakpoints": BP,
                   "use_score": USE_SCORE, "mugwonri_bonus": MUGWONRI_BONUS, "value_min_n": VALUE_MIN_N,
                   "min_coverage": MIN_COVERAGE,
                   "budget": budget, "want": want}, f, ensure_ascii=False, indent=1)

    # ---------------- 검사
    report = {"version": VERSION, "budget": budget, "want": want, "매물수": len(listings),
              "건물용도_매칭매물수": sum(1 for b in bld.values() if b.get("용도적합_식음료")), "업종별": {}, "상위10_겹침": {}}
    tops = {}
    for c in CATS:
        vals = sorted(t for t, *_ in by_cat[c] if t is not None)
        uses = sorted(u for _, _, u, _ in by_cat[c])
        top = sorted([x for x in by_cat[c] if x[0] is not None], key=lambda x: -x[0])
        tops[c] = [x[1] for x in top[:10]]
        report["업종별"][c] = {"p10": q(vals, .1), "p50": q(vals, .5), "p90": q(vals, .9), "max": round(vals[-1], 1),
                             "반영률_중앙값": q(uses, .5), "반영률_p10": q(uses, .1),
                             "추천대상수": len(vals), "데이터부족_제외수": len(by_cat[c]) - len(vals),
                             "상위10_구": count([x[3] for x in top[:10]])}
    for i, a in enumerate(CATS):
        for b2 in CATS[i + 1:]:
            report["상위10_겹침"]["%s·%s" % (a, b2)] = len(set(tops[a]) & set(tops[b2]))
    # 구 단위로 필터했을 때(사용자가 구를 고른 상황)의 겹침 평균
    by_gu = {}
    for g in sorted({L["구"] for L in listings}):
        t = {}
        for c in CATS:
            t[c] = set(x[1] for x in sorted([x for x in by_cat[c] if x[0] is not None and x[3] == g], key=lambda x: -x[0])[:10])
        pairs = [(len(t[a] & t[b2]), "%s·%s" % (a, b2)) for i, a in enumerate(CATS) for b2 in CATS[i + 1:]]
        mx = max(pairs)
        by_gu[g] = {"평균겹침": round(sum(p for p, _ in pairs) / len(pairs), 2), "최대겹침": mx[0],
                    "최대겹침_업종쌍": [n for p, n in pairs if p == mx[0]]}
    report["구별_상위10_겹침"] = by_gu
    over = {k: v for k, v in report["상위10_겹침"].items() if v >= 8}
    report["경고_겹침80퍼센트이상"] = over
    with open(os.path.join(OUT, "점수_%s_검사.json" % VERSION), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))


def rnd(v):
    return None if v is None else round(v, 1)


def q(s, p):
    return round(s[int((len(s) - 1) * p)], 1) if s else None


def count(xs):
    d = {}
    for x in xs:
        d[x] = d.get(x, 0) + 1
    return dict(sorted(d.items(), key=lambda kv: -kv[1]))


if __name__ == "__main__":
    sys.exit(main())
