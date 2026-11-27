"""소매 층 점수가 실제 점포와 크게 다른 이유 확인 (floor_store_check.py 후속).

정리 단계 (점포 쪽 잡음 빼기)
- V1 대형 상가 이름(시장·백화점·상가 등) 빼기 = floor_store_check.py와 같음
- V2 + 상호가 뷰티·의료 말(classify_use.KW)인 소매 점포 빼기 (예: '○○에스테틱'이 화장품 소매업으로 등록)
- V3 + 점포가 31곳 이상 모인 건물 빼기 (이름 없는 대형 상가). 기준 30은 10·50과 비교해 결과가 같음을 확인
- V4 + 상호에 도매·유통·(주) 등 사무형 소매 빼기
나누기: V3에서 소매를 생활형(편의점·슈퍼·식료품·음료·담배·꽃·핸드폰) / 가구(전시장 성격) / 그 밖(의류·화장품·잡화 등)

실행: py -I data/scripts/floor_store_retail.py → 09.스코어링/층_실제점포_소매.json
"""
import collections
import csv
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import classify_use as cu  # noqa: E402

g = {"__file__": str(HERE / "floor_store_check.py")}
exec((HERE / "floor_store_check.py").read_text(encoding="utf-8").split("# ---------------------------------------------------------------- 점포")[0], g)
OUT = g["ROOT"] / "09.스코어링/층_실제점포_소매.json"
CPLX = re.compile(r"시장|백화점|쇼핑|몰|아울렛|지하상가|프리미엄|도매|패션|타운|월드|상가|프라자|플라자|센터|시티|전자관|스퀘어")
OFF = re.compile(r"도매|유통|상사|무역|물산|본사|지사|사무소|사무실|온라인|쇼핑몰|방문판매|총판|\(주\)|㈜|주식회사|물류|창고|영업소")
OTHER = re.compile(cu.KW["뷰티"] + "|" + cu.KW["의료"])
DAILY = ("G204", "G205", "G206", "G207", "G219", "G20802")
SHOW = ("G211",)
B3 = ["1층", "2층", "3층이상"]
rows = list(csv.DictReader(open(g["STORE"], encoding="utf-8-sig")))
nb = collections.Counter(r["건물관리번호"] for r in rows if r["건물관리번호"])


def score(cnt, base):
    t = sum(cnt[b] for b in B3)
    sr = {b: (cnt[b] / t) / base[b] for b in B3}
    mx = max(sr.values())
    return {"n": t, "비율": [round(100 * cnt[b] / t) for b in B3], "점수": [round(100 * sr[b] / mx) for b in B3]}


lt = sum(g["lst_all"][b] for b in B3)
lbase = {b: g["lst_all"][b] / lt for b in B3}
res = {"설명": __doc__, "매물_소매": score(g["lst_cat"]["소매"], lbase), "엔진_세부": {"소매>일반": [100, 21, 13], "소매>전시장·쇼룸": [68, 100, 60]},
       "정리단계": {}, "나누기_V3": {}}
print("매물(중개사) 소매", res["매물_소매"])


def run(maxb, other, off, split=False):
    tot, ret = collections.Counter(), collections.Counter()
    grp = collections.defaultdict(collections.Counter)
    for r in rows:
        b = g["store_band"](r["층정보"])
        if b not in B3 or CPLX.search(r["건물명"]) or nb[r["건물관리번호"]] > maxb:
            continue
        tot[b] += 1
        k = r["상권업종소분류코드"]
        if g["store_cat"](k) != "소매" or (other and OTHER.search(r["상호명"])) or (off and OFF.search(r["상호명"])):
            continue
        ret[b] += 1
        sub = "가구(전시장 성격)" if k.startswith(SHOW) else ("생활형" if k.startswith(DAILY) else "그 밖(의류·화장품·잡화 등)")
        grp[sub][b] += 1
        if not k.startswith(SHOW):
            grp["가구 뺀 소매 (엔진 소매>일반에 대응)"][b] += 1
    T = sum(tot.values())
    base = {b: tot[b] / T for b in B3}
    return score(ret, base), {s: score(c, base) for s, c in grp.items()}, [round(100 * base[b]) for b in B3]


for name, mb, o, f in [("V1 대형 상가 이름 빼기", 10**9, 0, 0), ("V2 + 상호가 뷰티·의료", 10**9, 1, 0),
                       ("V3 비교: 점포 11곳 이상 건물 빼기", 10, 1, 0), ("V3 + 점포 31곳 이상 건물", 30, 1, 0),
                       ("V3 비교: 점포 51곳 이상 건물 빼기", 50, 1, 0), ("V4 V3 + 사무형 상호", 30, 1, 1)]:
    s, sub, base = run(mb, o, f)
    res["정리단계"][name] = {**s, "점포기준_비율": base}
    print(name, s)
s, sub, _ = run(30, 1, 0)
res["나누기_V3"] = sub
for k, v in sub.items():
    print("  ", k, v)
json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("저장", OUT)
