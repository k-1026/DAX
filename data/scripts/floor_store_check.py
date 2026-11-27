"""중개사 추천 매물의 층 분포를 실제 영업 점포(소상공인 상가(상권)정보, 대구 2026-09)와 비교한다.

물음: 층 점수의 바탕인 "중개사가 이 업종을 추천한 매물의 층 분포"가 실제로 그 업종 가게가 있는 층과 맞는가.
- 매물: 09.스코어링/용도분류_v2.csv (v2 업종 분류, 추천용도+특징)
- 점포: 08.외부데이터/01_상가정보/소상공인시장진흥공단_상가(상권)정보_대구_202609.csv
- 업종 대응: 설계 문서 3-1장 v2 "넣는 말 / 넣지 않는 말" 표를 상권업종 소분류에 옮김 (MAP 아래)
- 비교: 층 비율, 선택비(업종 비율 ÷ 자기 모집단 전체 비율), 점수 = 100 × 선택비 ÷ 최대 (D5와 같은 변환, 수축 없음)
- 층 결측 점포 점검: 같은 건물(건물관리번호)에 층이 적힌 점포가 있으면 그 건물의 가장 흔한 층으로 채운 경우와 비교

실행: py -I data/scripts/floor_store_check.py → 09.스코어링/층_실제점포_비교.json
"""
import collections
import csv
import json
import math
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "08.외부데이터/01_상가정보/소상공인시장진흥공단_상가(상권)정보_대구_202609.csv"
LIST = ROOT / "09.스코어링/용도분류_v2.csv"
OUT = ROOT / "09.스코어링/층_실제점포_비교.json"
BANDS = ["지하", "1층", "2층", "3층이상"]
CATS = ["식음료", "소매", "뷰티", "의료", "운동시설", "교육", "사무업무", "공연문화"]

# 상권업종 코드 → 8업종. 앞자리가 맞으면 해당, EXCL은 먼저 뺌. 근거: 설계 문서 3-1장 업종별 분류 기준
EXCL = {
    "I20701": "구내식당 (임대 대상 아님)", "I21101": "유흥 주점 (8업종 밖)", "I21102": "무도 유흥 주점 (8업종 밖)",
    "G21501": "약국 (8업종 밖, 2026-11-16 결정)", "G202": "자동차 부품", "G203": "모터사이클", "G210": "철물·건설자재",
    "G214": "연료 (주유소)", "G220": "반려동물 (8업종 밖)",
    "P10623": "운전학원", "P10607": "청소년 수련시설", "M10504": "광고물 제작업",
}
MAP = {
    "식음료": ["I2"],
    "소매": ["G2"],
    "뷰티": ["S20701", "S20702", "S20703", "S20802", "S20803"],
    "의료": ["Q101", "Q102"],
    "운동시설": ["R103", "P10601", "P10603"],
    "교육": ["P105", "P106", "R10202"],
    "사무업무": ["L102", "M103", "M104", "M105", "M107", "M109", "N10401", "N10403"],
    "공연문화": ["M11301"],
}


def store_cat(code):
    if any(code.startswith(e) for e in EXCL):
        return None
    hit = [c for c, pre in MAP.items() if any(code.startswith(p) for p in pre)]
    # 태권도·요가는 P106 안에 있지만 운동시설로 (v2: 태권도·필라테스·요가 = 운동시설)
    if "운동시설" in hit:
        return "운동시설"
    return hit[0] if hit else None


def store_band(s):
    s = (s or "").strip().upper()
    if not s:
        return None
    if s.startswith(("B", "지", "반")):
        return "지하"
    if s.isdigit():
        n = int(s)
        if 1 <= n <= 60:          # 101·301·6133 같은 값은 호수로 보고 버림
            return "1층" if n == 1 else ("2층" if n == 2 else "3층이상")
    return None


def list_band(s):
    s = (s or "").replace(" ", "")
    if s.startswith("지하"):
        return "지하"
    m = re.match(r"^(\d+)층$", s)
    if not m:
        return None
    n = int(m.group(1))
    return "1층" if n == 1 else ("2층" if n == 2 else "3층이상")


def dist(counter):
    t = sum(counter[b] for b in BANDS)
    return {b: counter[b] / t if t else 0 for b in BANDS}, t


def scores(cat_share, base_share):
    sr = {b: (cat_share[b] / base_share[b]) if base_share[b] else 0 for b in BANDS}
    mx = max(sr.values())
    return {b: round(100 * sr[b] / mx, 1) for b in BANDS}, {b: round(sr[b], 3) for b in BANDS}


def spearman(a, b):
    def rank(v):
        o = sorted(range(len(v)), key=lambda i: v[i])
        r = [0] * len(v)
        for k, i in enumerate(o):
            r[i] = k + 1
        return r
    ra, rb = rank(a), rank(b)
    n = len(a)
    return 1 - 6 * sum((x - y) ** 2 for x, y in zip(ra, rb)) / (n * (n * n - 1))


# ---------------------------------------------------------------- 매물
lst_all = collections.Counter()
lst_cat = {c: collections.Counter() for c in CATS}
for r in csv.DictReader(open(LIST, encoding="utf-8-sig")):
    b = list_band(r["층"])
    if b is None:
        continue
    lst_all[b] += 1
    for c in CATS:
        if r["v2_" + c]:
            lst_cat[c][b] += 1

# ---------------------------------------------------------------- 점포
# 점포 자료에는 지하가 거의 없음(층 적힌 점포의 0.1%) → 지하는 비교하지 않고, 점수는 1층·2층·3층이상 세 칸으로 다시 계산
B3 = BANDS[1:]
# 백화점·전통시장·대형 상가 안 점포 (매물은 거리 상가 한 칸이라 성격이 다름). 건물명으로 근사
CPLX = re.compile(r"시장|백화점|쇼핑|몰|아울렛|지하상가|프리미엄|도매|패션|타운|월드|상가|프라자|플라자|센터|시티|전자관|스퀘어")
rows = list(csv.DictReader(open(STORE, encoding="utf-8-sig")))
bld = collections.defaultdict(collections.Counter)
for r in rows:
    b = store_band(r["층정보"])
    if b and r["건물관리번호"]:
        bld[r["건물관리번호"]][b] += 1


def dist3(counter):
    t = sum(counter[b] for b in B3)
    return {b: counter[b] / t if t else 0 for b in B3}, t


def scores3(cat_share, base_share):
    sr = {b: cat_share[b] / base_share[b] for b in B3}
    mx = max(sr.values())
    return {b: round(100 * sr[b] / mx, 1) for b in B3}


def run(name, keep, impute=False):
    tot, cat, n_all, n_miss = collections.Counter(), {c: collections.Counter() for c in CATS}, collections.Counter(), collections.Counter()
    for r in rows:
        if not keep(r):
            continue
        b = store_band(r["층정보"])
        c = store_cat(r["상권업종소분류코드"])
        if c:
            n_all[c] += 1
            n_miss[c] += b is None
        if b is None and impute and r["건물관리번호"] in bld:
            b = bld[r["건물관리번호"]].most_common(1)[0][0]
        if b in B3:
            tot[b] += 1
            if c:
                cat[c][b] += 1
    base, _ = dist3(tot)
    out = {"기준": {b: round(base[b], 3) for b in B3}, "업종": {}}
    for c in CATS:
        d, n = dist3(cat[c])
        out["업종"][c] = {"n": n, "전체_n": n_all[c], "층없음비율": round(n_miss[c] / n_all[c], 3) if n_all[c] else None,
                         "비율": {b: round(d[b], 3) for b in B3}, "점수": scores3(d, base)}
    return out


la, _ = dist3(lst_all)
lst = {"기준": {b: round(la[b], 3) for b in B3}, "업종": {}}
for c in CATS:
    d, n = dist3(lst_cat[c])
    lst["업종"][c] = {"n": n, "지하_n": lst_cat[c]["지하"], "비율": {b: round(d[b], 3) for b in B3}, "점수": scores3(d, la)}

V = {"점포_전체": run("전체", lambda r: True),
     "점포_복합상가제외": run("복합상가 제외", lambda r: not CPLX.search(r["건물명"])),
     "점포_복합상가제외_같은건물채움": run("채움", lambda r: not CPLX.search(r["건물명"]), impute=True)}
st_known = sum(1 for r in rows if store_band(r["층정보"]))
res = {"설명": __doc__, "업종대응": MAP, "제외코드": EXCL, "복합상가_건물명": CPLX.pattern,
       "점포_층적힘": st_known, "점포_지하": sum(1 for r in rows if store_band(r["층정보"]) == "지하"), "점포_전체": len(rows),
       "매물": lst, **V, "비교": {}}

print(f"점포 {len(rows)} 중 층 적힘 {st_known} ({st_known / len(rows):.0%}), 지하 {res['점포_지하']}")
print("기준 1·2·3+ %: 매물", [round(la[b] * 100) for b in B3], "/ 점포(복합 제외)", [round(V['점포_복합상가제외']['기준'][b] * 100) for b in B3])
print("\n업종 | 매물 n 1·2·3+% | 점포(복합 제외) n 1·2·3+% | 점수 매물 → 점포 | 최대 점수차 (전체 점포 · 복합 제외 · 채움) | 층없음")
one_l, one_s = [], []
for c in CATS:
    L = lst["업종"][c]
    d = {k: max(abs(L["점수"][b] - V[k]["업종"][c]["점수"][b]) for b in B3) for k in V}
    S = V["점포_복합상가제외"]["업종"][c]
    order_same = sorted(B3, key=lambda b: -L["점수"][b]) == sorted(B3, key=lambda b: -S["점수"][b])
    res["비교"][c] = {"최대점수차": {k: round(v, 1) for k, v in d.items()}, "층순서_같음(복합제외)": order_same}
    one_l.append(L["비율"]["1층"]); one_s.append(S["비율"]["1층"])
    f = lambda x: "·".join(str(round(x[b] * 100)) for b in B3)
    g = lambda x: "·".join(str(round(x[b])) for b in B3)
    print(f"{c} | {L['n']} {f(L['비율'])} | {S['n']} {f(S['비율'])} | {g(L['점수'])} → {g(S['점수'])} | "
          f"{d['점포_전체']:.0f} · {d['점포_복합상가제외']:.0f} · {d['점포_복합상가제외_같은건물채움']:.0f} | {S['층없음비율']:.0%} | 순서같음 {order_same}")
res["업종간_1층비율_순위상관"] = round(spearman(one_l, one_s), 3)
print("\n업종 간 1층 비율 순서 (Spearman, 복합 제외):", res["업종간_1층비율_순위상관"])
json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("저장", OUT)
