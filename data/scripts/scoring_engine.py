"""업종별 공실 추천 점수 엔진 (v2).

총점 = Σ(그룹 가중치 × 그룹 점수) ÷ Σ(데이터가 있는 그룹의 가중치)
그룹 점수 = Σ(세부 비중 × 인자 점수) ÷ Σ(데이터가 있는 인자의 세부 비중)
  → 데이터가 없는 인자는 채우지 않고 빼고, 같은 그룹 안에서 비중을 재분배한다.
  → 기준값은 대구 전체 분포로 고정(절대평가). 예외: 임대료 부담+보증금(이용자 예산 안 후보의 분위수), 면적 적합도(희망 면적).

v1과 달라진 것 (설계 문서 3-1장 결정, 2026-11-16~17)
  1. 업종 분류: 엔진 안의 키워드(USE_KW) 대신 classify_use.py(v2)를 쓴다.
     추천용도 칸이든 특징 칸이든 업종 말이 걸리면 명시 100. 약국·동물병원 등은 8업종 밖.
  2. 층 점수표와 기본 면적: 손으로 적은 값 대신 v2 분류 결과(추천용도 + 특징 합계)에서 계산해 config에 고정한다.
     층 점수 = 40 + 60 × 리프트 ÷ 업종 최대 리프트 (하한 40은 가설)
  3. 세부 업종 10개(5개 대분류 × 2): 층 점수표와 기본 면적만 따로 갖는다.
     가중치·교통 비율·배후 수요·상권 활성도·건물 용도·용도 일치도는 대분류 것을 쓴다.
  4. 층 인자 제외: 층 분포가 전체 매물과 구분되지 않으면(적합도 카이제곱 p >= 0.05) 층 인자를 쓰지 않는다.
     지금은 세부 업종을 고르지 않은 공연문화와 소매>전시장·쇼룸이 해당한다.
  5. 임대료 부담 + 보증금을 한 인자로 합침 (2026-11-17, 0.스코어링 최종중/임대료 부담+보증금/ 세 문서):
     후보 = 월세 ≤ 월세 상한 A 그리고 보증금 ≤ 보증금 상한 B (입력한 칸만, 둘 다 없으면 대구 전체)
     환산 월 임대료 = 월세 + 보증금 × 1% (한국부동산원 환산임대료, 전환율 연 12% = 상가임대차법 시행령 제5조 상한)
     후보의 10%·20%…90% 분위값에 100·90…20점, 가장 비싼 후보 10점, 사이는 선형 보간. 관리비는 넣지 않음.
     후보 밖 매물은 이 인자가 비고(화면에서는 필터로 숨김), 무권리 +10 가점은 없앰. 세부 비중은 두 인자의 합(50+20, 공연문화 40+30).
  6. 좌표(경도·위도)가 없는 매물은 반영률과 관계없이 추천 대상에서 뺀다 (2026-11-18).
     5번 통합 뒤 예산 미입력이면 비용 반영률이 올라, 입지 그룹이 통째로 빈 48건이 일부 업종에서 반영률 60을 넘었기 때문.
  v1 엔진은 scoring_engine_v1.py에 그대로 남겨 두었다(점수_v1.* 재현용).

입력
  data/07.대구_매물유형별_csv/대구_구역별_매물 (최종).csv   기본 매물
  data/09.스코어링/외부인자_v1.csv                         상권 활성도, 배후 수요 (external_factors.py)
  data/09.스코어링/건물용도_v1.csv                         건물 용도 적합성 (building_use.py)
출력
  data/09.스코어링/점수_v2.csv          매물별 공통 인자 점수 + 업종·세부 업종별 총점·그룹 점수·인자 점수
  data/09.스코어링/점수_v2_config.json  이 엔진의 가중치·기준값 (화면과 피드백 스냅샷이 같은 값을 쓰도록)
  data/09.스코어링/점수_v2_검사.json    분포, 데이터 반영률, 업종 간 상위 10개 겹침

실행: py -I data/scripts/scoring_engine.py [--rent 300] [--deposit 3000] [--want 80]   (만원, --budget은 --rent와 같음)
"""
import csv
import json
import os
import re
import sys
from datetime import date
from statistics import median

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # -I 실행에서도 같은 폴더의 분류 모듈을 읽도록
import classify_use as cu  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "09.스코어링")
LISTING_CSV = os.path.join(DATA, "07.대구_매물유형별_csv", "대구_구역별_매물 (최종).csv")
EXT_CSV = os.path.join(OUT, "외부인자_v1.csv")
BLD_CSV = os.path.join(OUT, "건물용도_v1.csv")
VERSION = "v2"
TODAY = date(2026, 11, 10)

CATS = ["식음료", "소매", "뷰티", "공연문화", "사무업무", "교육", "의료", "운동시설"]
GROUPS = ["비용", "공간", "입지", "업종적합"]
FACTORS = {"비용": ["임대료보증금", "가성비"], "공간": ["층", "면적적합도", "건물연식"],
           "입지": ["교통", "상권활성도", "배후수요"], "업종적합": ["용도일치도", "건물용도"]}

# 비용 세부 비중: 임대료 부담+보증금 = 기존 임대료 부담 + 보증금 비중의 합 (50 + 20 = 70, 공연문화 40 + 30 = 70)
S_DEFAULT = {"비용": [70, 30], "공간": [50, 35, 15], "입지": [30, 40, 30], "업종적합": [40, 60]}
S_DEST = {"비용": [70, 30], "공간": [35, 45, 20], "입지": [25, 25, 50], "업종적합": [40, 60]}
# 가중치·교통 비율은 v1 그대로. floor(층 점수표)와 area(기본 면적)는 실행할 때 v2 분류 결과에서 계산해 넣는다.
PRESET = {
    "식음료":   {"g": [25, 20, 35, 20], "s": S_DEFAULT, "subway": 0.6},
    "소매":     {"g": [25, 20, 35, 20], "s": S_DEFAULT, "subway": 0.6},
    "뷰티":     {"g": [25, 20, 35, 20], "s": S_DEFAULT, "subway": 0.6},
    "공연문화": {"g": [35, 30, 20, 15], "s": {"비용": [70, 30], "공간": [30, 50, 20], "입지": [40, 40, 20], "업종적합": [40, 60]},
                 "subway": 0.6},
    "사무업무": {"g": [35, 25, 30, 10], "s": {"비용": [70, 30], "공간": [35, 45, 20], "입지": [50, 20, 30], "업종적합": [40, 60]},
                 "subway": 0.7},
    "교육":     {"g": [30, 20, 25, 25], "s": S_DEST, "subway": 0.6},
    "의료":     {"g": [20, 20, 25, 35], "s": S_DEST, "subway": 0.6},
    "운동시설": {"g": [30, 30, 20, 20], "s": S_DEST, "subway": 0.6},
}
FLOOR_BASE = 40          # 층 점수 하한. 근거 없는 가설 (설계 문서 5장). good/bad가 쌓이면 보정
FLOOR_P_MAX = 0.05       # 층 분포 적합도 카이제곱 p가 이 값 이상이면 층 인자를 쓰지 않는다
BASEMENT_SCORE = 40      # 지하는 매물이 2%뿐이라 일괄 점수
BASEMENT_HOLD = {"공연문화"}   # v1과 같이 표본이 적어 보류(지하 매물은 층 인자 없음)
SUB_SEP = ">"            # 세부 업종 키: "식음료>배달전문"
# 구간 기준값 (x, 점수) — 사이는 선형 보간, 양끝은 끝값 유지. 근거는 대구 매물 2,717건 분포.
BP = {
    "가성비":   [(0.5, 100), (1.0, 60), (1.5, 20), (1.75, 0)],          # ㎡당 월세 ÷ 같은 동·층대 중앙값
    "면적_넓음": [(0.2, 100), (0.5, 70), (1.0, 40), (2.0, 10)],          # (실제−목표)÷목표, 양수
    "면적_좁음": [(0.2, 100), (0.3, 60), (0.5, 20), (0.6, 0)],           # 음수의 절댓값
    "건물연식": [(5, 100), (10, 85), (20, 65), (30, 45), (40, 30)],      # 년
    "지하철":   [(250, 100), (500, 75), (850, 50), (1500, 20), (2000, 10)],  # m
    "버스":     [(60, 100), (100, 80), (150, 60), (250, 30)],             # m
}
# 임대료 부담+보증금: 고정 구간이 아니라 이용자 예산 안 후보로 매번 계산 (make_cost_scorer)
COST_RULE = {"환산": "월세 + 보증금 × 1%", "보증금_월환산율": 0.01, "관리비": "제외(화면에 따로 표시)",
             "후보": "월세 ≤ 월세 상한 그리고 보증금 ≤ 보증금 상한 (입력한 칸만, 둘 다 없으면 대구 전체)",
             "점수": "후보 10%~90% 분위값에 100·90·…·20점, 가장 비싼 후보 10점, 사이는 선형 보간"}
DEPOSIT_RATE = 0.01
COST_MARKS = [100 - 10 * k for k in range(9)]   # 10%~90% 분위값의 점수
COST_MAX_SCORE = 10                              # 가장 비싼 후보
# 결측 재분배는 인자 몇 개가 빌 때는 괜찮지만, 그룹 하나가 통째로 비면(예: 좌표 없음 → 입지 전체) 남은 그룹이
# 과대 반영되어 점수가 부풀 수 있다. 그래서 100점 배점 중 실제 값이 들어간 배점이 이 값 미만이면 추천 순위에서 뺀다.
MIN_COVERAGE = 60
# 좌표가 없으면 입지 그룹(교통·상권 활성도·배후 수요)과 건물 용도가 모두 비므로 반영률과 관계없이 추천에서 뺀다.
REQUIRE_COORD = True
VALUE_MIN_N = 10
USE_SCORE = {"명시": 100, "다용도": 60, "신호없음": 50, "타업종만": 30}


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


def has_coord(L):
    return num(L.get("경도")) is not None and num(L.get("위도")) is not None


def recommendable(used, coord):
    return used >= MIN_COVERAGE and (coord or not REQUIRE_COORD)


def quantile(a, p):
    """선형 보간 분위수 (a는 정렬된 목록, p는 0~100)"""
    i = (len(a) - 1) * p / 100
    lo = int(i)
    hi = min(lo + 1, len(a) - 1)
    return a[lo] + (a[hi] - a[lo]) * (i - lo)


def converted_rent(L):
    m, d = num(L["월세"]), num(L["보증금"])
    return None if m is None or d is None else m + d * DEPOSIT_RATE


def make_cost_scorer(listings, rent_cap=None, dep_cap=None):
    """임대료 부담+보증금 점수. 반환: ({매물번호: 점수 또는 None(후보 밖)}, 후보 요약)"""
    pool = {}
    for L in listings:
        m, d = num(L["월세"]), num(L["보증금"])
        if m is None or d is None:
            continue
        if (rent_cap is None or m <= rent_cap) and (dep_cap is None or d <= dep_cap):
            pool[L["매물번호"]] = m + d * DEPOSIT_RATE
    if not pool:
        return {}, {"후보수": 0}
    costs = sorted(pool.values())
    cuts = [quantile(costs, p) for p in range(10, 100, 10)]
    marks = list(zip(cuts, COST_MARKS)) + [(costs[-1], COST_MAX_SCORE)]

    def score(c):
        if c <= marks[0][0]:
            return 100.0
        for (x0, y0), (x1, y1) in zip(marks, marks[1:]):
            if c <= x1:
                return float(y0) if x1 == x0 else y0 + (y1 - y0) * (c - x0) / (x1 - x0)
        return float(COST_MAX_SCORE)

    info = {"월세상한": rent_cap, "보증금상한": dep_cap, "후보수": len(pool),
            "경계값_10_90": [round(x, 2) for x in cuts], "최고": round(costs[-1], 2)}
    return {k: score(c) for k, c in pool.items()}, info


def floor_band(s):
    s = (s or "").replace(" ", "")
    if s.startswith("지하"):
        return 3
    m = re.match(r"^(\d+)층$", s)
    if not m:
        return None
    n = int(m.group(1))
    return 0 if n == 1 else (1 if n == 2 else 2)


# ------------------------------------------------------------------ 업종 분류 (classify_use.py v2)
def classify_listing(L):
    """추천용도·특징 → 대분류 집합, 다용도 여부, 세부 업종.  세부 업종은 추천용도 칸에서 걸린 말을 먼저 쓴다."""
    rc, _, rm, _, _ = cu.classify(L["추천용도"])
    rw = dict(cu.classify.words)
    fc, _, fm, _, _ = cu.classify(L["특징"], is_feature=True)
    fw = dict(cu.classify.words)
    cats = rc | fc
    subs = {c: cu.sub_labels(c, rw[c] if c in rc else fw[c]) for c in cu.SPLIT if c in cats}
    return {"cats": cats, "multi": bool(rm or fm), "subs": subs}


def floor_and_area(group, listings, key):
    """업종(또는 세부 업종)으로 분류된 매물에서 층 점수표와 기본 면적을 만든다."""
    d = cu.dist(group)
    allb = cu.dist(listings)
    lift = [d[b] / allb[b] for b in ("1층", "2층", "3층이상")]
    chi, p = cu.floor_test(group, listings)
    used = p < FLOOR_P_MAX
    base = key.split(SUB_SEP)[0]
    table = [round(FLOOR_BASE + (100 - FLOOR_BASE) * x / max(lift)) for x in lift] + [None if base in BASEMENT_HOLD else BASEMENT_SCORE]
    return {"floor": table if used else None, "floor_ref": table, "floor_used": used, "area": d["면적중앙값"],
            "n": d["n"], "chi2": chi, "p": p}


def build_basis(listings, use):
    """대분류 8개 + 세부 업종 10개의 층 점수표·기본 면적."""
    basis = {}
    for c in CATS:
        basis[c] = floor_and_area([L for L in listings if c in use[L["매물번호"]]["cats"]], listings, c)
    for c, (b, a, _) in cu.SPLIT.items():
        for sub in (b, a):
            key = c + SUB_SEP + sub
            basis[key] = floor_and_area([L for L in listings if sub in use[L["매물번호"]]["subs"].get(c, [])], listings, key)
    return basis


# ------------------------------------------------------------------ 공통 인자 (업종과 무관)
def common_factors(L, value_ref, u):
    f = {}
    rent = num(L["월세"])
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
    # 임대료 부담+보증금은 후보(예산)마다 달라서 make_cost_scorer에서 계산한다. 여기서는 환산값과 표시용 정보만.
    f["환산월임대료"] = converted_rent(L)
    # 무권리: 점수에서 뺌(2026-11-17). 정보로만 남김
    f["무권리"] = bool(re.search(r"무권리|無권리|권리금\s*없", (L["특징"] or "") + " " + (L["추천용도"] or "")))
    # 건물 연식
    try:
        y = (TODAY - date.fromisoformat(L["사용승인일"])).days / 365.25
        f["건물연식"] = interp(BP["건물연식"], y)
    except ValueError:
        f["건물연식"] = None
    # 교통 (지하철·버스는 업종별 비율로 섞음 → 여기선 각각만)
    f["지하철"] = interp(BP["지하철"], num(L["역거리_m"]))
    f["버스"] = interp(BP["버스"], num(L["정류소거리_m"]))
    # 업종 신호 (용도 일치도용) — classify_use.py v2
    f["_hits"] = {c: c in u["cats"] for c in CATS}
    f["_multi"] = u["multi"]
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


def score_listing(cf, ext, bld, key, basis, cost=None, want=None):
    """key는 대분류("식음료") 또는 세부 업종("식음료>배달전문").
    세부 업종은 층 점수표와 기본 면적만 다르고 나머지 인자는 대분류 것을 쓴다.
    cost는 make_cost_scorer가 준 이 매물의 임대료 부담+보증금 점수(후보 밖이면 None)."""
    cat = key.split(SUB_SEP)[0]
    p, b = PRESET[cat], basis[key]
    fac = {}
    fac["임대료보증금"] = cost
    fac["가성비"] = cf["가성비"]
    fac["층"] = b["floor"][cf["_band"]] if (b["floor"] and cf["_band"] is not None) else None
    fac["면적적합도"] = area_fit(cf["_area"], want or b["area"])
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
    arg = lambda *names: next((float(args[args.index(n) + 1]) for n in names if n in args), None)
    rent_cap, dep_cap, want = arg("--rent", "--budget"), arg("--deposit"), arg("--want")

    with open(LISTING_CSV, encoding="utf-8-sig", newline="") as f:
        listings = list(csv.DictReader(f))
    ext = {r["매물번호"]: r for r in csv.DictReader(open(EXT_CSV, encoding="utf-8-sig", newline=""))} if os.path.exists(EXT_CSV) else {}
    bld = {r["매물번호"]: r for r in csv.DictReader(open(BLD_CSV, encoding="utf-8-sig", newline=""))} if os.path.exists(BLD_CSV) else {}

    use = {L["매물번호"]: classify_listing(L) for L in listings}
    basis = build_basis(listings, use)
    SUBS = [k for k in basis if SUB_SEP in k]
    KEYS = CATS + SUBS

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

    cost_score, cost_info = make_cost_scorer(listings, rent_cap, dep_cap)

    rows, by_cat = [], {k: [] for k in KEYS}
    for L in listings:
        u = use[L["매물번호"]]
        cf = common_factors(L, value_ref, u)
        e, b = ext.get(L["매물번호"]), bld.get(L["매물번호"])
        cost = cost_score.get(L["매물번호"])
        coord = has_coord(L)
        row = {"매물번호": L["매물번호"], "구": L["구"], "법정동": L["법정동"], "층": L["층"],
               "전용면적": L["전용면적"], "보증금": L["보증금"], "월세": L["월세"],
               "환산월임대료": rnd(cf["환산월임대료"]), "임대료보증금": rnd(cost),
               "가성비": rnd(cf["가성비"]), "가성비_비율": cf.get("가성비_비율"),
               "건물연식": rnd(cf["건물연식"]), "지하철": rnd(cf["지하철"]), "버스": rnd(cf["버스"]),
               "무권리": cf["무권리"], "관리비미기재": cf["관리비미기재"],
               "건물매칭": (b or {}).get("매칭방법", ""), "건물매칭신뢰도": (b or {}).get("매칭신뢰도", ""),
               "분류_업종": "|".join(c for c in CATS if c in u["cats"]), "분류_다용도": u["multi"],
               # 세부 업종 말이 적힌 매물 표시용 (점수에는 쓰지 않음)
               "분류_세부업종": "|".join(c + SUB_SEP + s for c in cu.SPLIT for s in u["subs"].get(c, []))}
        for c in CATS:
            total, groups, fac, used = score_listing(cf, e, b, c, basis, cost, want)
            row["총점_" + c] = rnd(total)
            for g in GROUPS:
                row["%s_%s" % (g, c)] = rnd(groups[g])
            for n in ("층", "면적적합도", "교통", "상권활성도", "배후수요", "용도일치도", "건물용도"):
                row["%s_%s" % (n, c)] = rnd(fac[n])
            row["반영률_" + c] = round(used, 1)
            row["추천대상_" + c] = total is not None and recommendable(used, coord)
            by_cat[c].append((total if recommendable(used, coord) else None, L["매물번호"], used, L["구"]))
        # 세부 업종: 대분류와 다른 값(공간 그룹)만 적는다
        for k in SUBS:
            total, groups, fac, used = score_listing(cf, e, b, k, basis, cost, want)
            row["총점_" + k] = rnd(total)
            row["공간_" + k] = rnd(groups["공간"])
            row["층_" + k] = rnd(fac["층"])
            row["면적적합도_" + k] = rnd(fac["면적적합도"])
            row["반영률_" + k] = round(used, 1)
            row["추천대상_" + k] = total is not None and recommendable(used, coord)
            by_cat[k].append((total if recommendable(used, coord) else None, L["매물번호"], used, L["구"]))
        rows.append(row)

    fields = list(rows[0].keys())
    with open(os.path.join(OUT, "점수_%s.csv" % VERSION), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    preset_out = {c: dict(PRESET[c], floor=basis[c]["floor"], area=basis[c]["area"]) for c in CATS}
    with open(os.path.join(OUT, "점수_%s_config.json" % VERSION), "w", encoding="utf-8") as f:
        json.dump({"version": VERSION, "groups": GROUPS, "factors": FACTORS, "preset": preset_out,
                   "sub": {k: {"floor": basis[k]["floor"], "area": basis[k]["area"]} for k in SUBS},
                   "basis": basis,
                   "floor_rule": {"식": "%d + %d × 리프트 ÷ 업종 최대 리프트" % (FLOOR_BASE, 100 - FLOOR_BASE), "하한": FLOOR_BASE,
                                  "하한_상태": "가설(근거 없음)", "표본": "추천용도 + 특징 합계",
                                  "층인자_제외": "층 분포 적합도 카이제곱 p >= %s" % FLOOR_P_MAX,
                                  "지하": BASEMENT_SCORE, "지하_보류": sorted(BASEMENT_HOLD)},
                   "classifier": "classify_use.py (v2)", "sub_sep": SUB_SEP,
                   "breakpoints": BP, "cost_rule": COST_RULE, "cost_pool": cost_info, "use_score": USE_SCORE, "value_min_n": VALUE_MIN_N,
                   "min_coverage": MIN_COVERAGE, "require_coord": REQUIRE_COORD,
                   "rent_cap": rent_cap, "deposit_cap": dep_cap, "want": want}, f, ensure_ascii=False, indent=1)

    # ---------------- 검사
    report = {"version": VERSION, "rent_cap": rent_cap, "deposit_cap": dep_cap, "want": want, "임대료보증금_후보": cost_info, "매물수": len(listings),
              "건물용도_매칭매물수": sum(1 for b in bld.values() if b.get("용도적합_식음료")),
              "용도일치도_판정": {c: count([use_match(common_factors(L, value_ref, use[L["매물번호"]]), c)[1] for L in listings]) for c in CATS},
              "층인자_제외": [k for k in KEYS if not basis[k]["floor_used"]],
              "업종별": {}, "상위10_겹침": {}}
    tops = {}
    for c in KEYS:
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
    # 세부 업종 쌍(같은 대분류 안)의 상위 10개 겹침: 나눈 효과가 있는지
    report["세부업종_상위10_겹침"] = {c: len(set(tops[c + SUB_SEP + b]) & set(tops[c + SUB_SEP + a])) for c, (b, a, _) in cu.SPLIT.items()}
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
