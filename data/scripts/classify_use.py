# -*- coding: utf-8 -*-
"""추천용도·특징 텍스트 → 8개 업종 분류 (기준 v2 안).

실행 (저장소 루트):  py -I data/scripts/classify_use.py
결과: data/09.스코어링/용도분류_v2.csv, 용도분류_v2_meta.json

scoring_engine.py 의 USE_KW(v1)는 건드리지 않는다. 이 스크립트는 v2 기준을 전체 매물에 적용해
v1과 비교한 결과만 만든다. 엔진 반영은 팀 결정 후.

분류 순서
  1) 정규화: 오타·이형 표기 통일
  2) 합성어 먼저 처리: '스터디카페'처럼 부분 문자열이 다른 업종 키워드인 말을 먼저 떼어 낸다
  3) 특징 텍스트만: 위치 설명('이마트 옆', '○○병원 앞', '오피스상권')을 지운다
  4) 업종 키워드 매칭 (여러 업종 가능)
  5) 다용도 / 범용 / 8업종 밖 / 비정보 표시
"""
import csv
import json
import os
import re
import sys
from collections import Counter
from statistics import median

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LISTING_CSV = os.path.join(BASE, "07.대구_매물유형별_csv", "대구_구역별_매물 (최종).csv")
OUT_CSV = os.path.join(BASE, "09.스코어링", "용도분류_v2.csv")
OUT_META = os.path.join(BASE, "09.스코어링", "용도분류_v2_meta.json")

CATS = ["식음료", "소매", "뷰티", "의료", "운동시설", "교육", "사무업무", "공연문화"]

# ---------------------------------------------------------------- 1) 정규화
NORMALIZE = [
    (r"까페|카폐|커피솦|커피샾", "카페"),
    (r"샾|샆|숖", "샵"),
    (r"프렌차이[즈져저]|프랜차이[져저]", "프랜차이즈"),
    (r"헬쓰", "헬스"),
    (r"뷰타", "뷰티"),
    (r"테닝", "태닝"),
    (r"피시방|PC\s*방|pc\s*방|피씨방", "PC방"),
    (r"[Pp]\.?[Tt]\s*샵|피티\s*샵|피티", "PT샵"),
    (r"(?<![A-Za-z])pt(?![A-Za-z])", "PT"),
    (r"맛사지", "마사지"),
    (r"병\s*[\.·,/]\s*의원", "병의원"),
    (r"센타", "센터"),
    (r"학원원", "학원"),
]

# ---------------------------------------------------------------- 2) 합성어 (먼저 판정하고 본문에서 지움)
# (패턴, 업종 또는 표시).  '기타:…' 는 8업종 밖.
COMPOUND = [
    (r"스터디\s*카페|북\s*카페|독서실", "교육"),
    (r"키즈\s*카페|키즈\s*룸|키즈\s*업종|실내\s*놀이터", "기타:놀이·여가"),
    (r"(애견|강아지)\s*(유치원|호텔)|애견\s*카페|애견\s*미용|애견\s*용품점?|애견\s*샵|애견|반려\s*동물|강아지\s*유치원|동물\s*병원", "기타:반려동물"),
    (r"요양\s*병원", "의료"),
    (r"(인터넷|온라인)\s*쇼핑몰|쇼핑몰\s*사무실|쇼핑몰", "사무업무"),
    (r"(자동차|수입차|가구|대형)?\s*전시\s*(장|매장)", "소매"),
    (r"골프\s*(샵|용품|피팅)\S*", "소매"),
    (r"무인\s*카페", "식음료"),
    (r"무인\s*(점포|매장|샵|상점|판매점?|판매장|편의점)|무인", "소매"),
    (r"(음악|악기|댄스|보컬)\s*연습실|노래\s*연습장|노래방|게임방|PC방|만화", "기타:놀이·여가"),
    (r"(음악|실용음악|미술|영어|수학|피아노|발레|댄스|무용|외국어|보습|입시|교과)\s*학원", "교육"),
    (r"부동산\s*(사무실|중개|사무소)?|공인중개\S*", "사무업무"),
    (r"사무실\s*겸?\s*창고|창고\s*겸?\s*사무실", "사무업무"),
    (r"주간\s*보호\s*(센터|시설)?|노유자\s*시설|복지\s*(시설|센터)|요양원|어린이집", "기타:노유자·복지"),
    (r"파티\s*룸|공간\s*대여업?", "기타:놀이·여가"),
    (r"피부\s*과|피부\s*비뇨기과", "의료"),
    (r"배달\s*대행", "기타:창고·제조·물류"),
    (r"의료\s*기기\S*|보청기", "소매"),
    (r"발레|점핑\S*", "교육"),
]

# ---------------------------------------------------------------- 3) 특징 텍스트의 위치 설명 (지움)
LOC_WORD = r"(앞|옆|뒤|인근|근처|부근|건너편|맞은편|근접|인접|도보|밀집|라인|상권|거리|골목|입점|있는|많은|하던|이었던|자리였)"
LOCATION = [
    r"\S*(이마트|홈플러스|롯데마트|하나로마트|[eE]마트|탑마트|식자재마트)\S*",
    r"\S*(대학교?병원|대병원|파티마병원|의료원|동산병원|성모병원)\S*",
    r"[가-힣]{2,}(병원|의원|치과|약국|한의원|학원|마트|은행)\s*(바로)?\s*" + LOC_WORD,
    r"(병원|의원|치과|약국|한의원|학원|마트|식당|술집|카페|편의점|음식점|사무실|다이소)(\s*[,·]?\s*(병원|의원|치과|약국|한의원|학원|마트|식당|술집|카페|편의점|음식점))*\s*(이|가|들)?\s*(바로)?\s*" + LOC_WORD,
    r"(식당|학원|카페|술집|먹자|병원)\s*가\b|(식당|학원|카페|술집|병원)가\s*(위치|인근|밀집|거리|형성)",
    r"(오피스|업무시설|사무실|학원|병원|카페|술집|식당|먹자)\s*(및\s*\S+\s*)?(상권|밀집|타운|거리|골목|라인)",
    r"오피스텔|동사무소|야외음악당|음악당|APT|[Aa]pt|수영장|도서관|의료\s*시설\s*외",
    r"(편의점|카페|학원|미용실|식당|음식점|병원|의원|헬스장|어린이집|사무실)\s*(하던|이었던|으로\s*사용|으로\s*쓰던|자리)",
    r"\S*(체육|스포츠)\s*센터\s*(앞|옆|인근|건너편|맞은편)|\S*운동장\S*|구\s+[가-힣]+장(?=,|\s)|조명\s*시설|[가-힣]+\s*제외|(병의원|병원|학원|음식점|식당)\s*상가\s*밀집\S*",
]

# ---------------------------------------------------------------- 4) 업종 키워드
KW = {
    "식음료": r"카페|커피|음식|식당|요식|외식|베이커리|제과|제빵|빵집|케[익이]크?집|술집|주점|호프|맥주|포차|이자카야|선술집|"
              r"치킨|분식|김밥|휴게|고[깃기]집|횟집|레스토랑|브런치|디저트|빙수|아이스크림|패스트푸드|버거|테이크아웃|배달|"
              r"한식|중식|일식|양식|외국식|한정식|중국집|국밥|국수|막창|돈[까가]스|파스타|샐러드|다방|루프탑|뷔페|요리|혼술|(?<![가-힣])[펍바](?![가-힣])",
    "소매": r"소매|판매|매장|의류|옷가게|패션|잡화|소품|편의점|마트|화장품|꽃집|플라워|휴대폰|핸드폰|통신|안경|대리점|쇼룸|편집\s*샵|팝업|"
            r"정육|식육|반찬|과일|농수산물|가구점?|가전|조명|타이어|복권|다이소|굿즈|문구|악세사리|액세서리|야채|식자재|스토어",
    "뷰티": r"미용|미장원|헤어|네일|에스테틱|뷰티|피부|속눈썹|왁싱|바버|반영구|타투|태닝|마사지|염색방|세신",
    "의료": r"병원|의원|병의원|치과|한의원|메디컬|의료|클리닉|검진|[가-힣]*외과|[가-힣]*내과|소아과|안과|이비인후과|산부인과|비뇨기과|"
            r"[가-힣]+의학과|소아청소년과|신경과",
    "운동시설": r"요가|필라테스|피트니스|헬스|PT샵|(?<![A-Za-z])PT(?![A-Za-z])|체육|태권도|주짓수|복싱|골프|테니스|클라이밍|탁구|당구|"
                r"농구|스포츠|운동|짐(?![가-힣])|크로스핏|수영|볼링|배드민턴|검도|유도|합기도",
    "교육": r"학원|교습|공부방|교육|스터디|과외|교과|외국어|유치원",
    "사무업무": r"사무실|사무소|사무|오피스|업무|세무|회계|법무|변호사|노무사|행정사|건축사|법인|보험|금융|증권|은행|"
                r"영업소|본사|지사|회사|여행사|건설사|텔레마케팅|콜센터|사옥",
    "공연문화": r"공연|소극장|연습실|스튜디오|갤러리|공방|작업실|전시|사진관|촬영|화실|아틀리에|댄스|무용",
}

# ---------------------------------------------------------------- 5) 그 밖의 표시
MULTI = (r"다용도|다용|다양도|다목적|업종\s*무관|업종\s*불문|모든\s*업종|전\s*업종|자유\s*업종|어떤\s*업종|아무\s*업종|"
         r"업종\s*다양|다양\s*한?\s*업종|다양\s*업종|다양한\s*용도|용도\s*다양|업종\s*제한\s*(없|[xX]|無)")
GENERIC = r"프랜차이즈|체인점|브랜드|상가|점포|서비스업?|소규모\s*창업|근린생활\s*업종"   # 업종을 특정하지 못하는 말
OTHER = {
    "기타:창고·제조·물류": r"창고|공장|제조|가내\s*수?공업|물류|작업장|물건\s*적재|자동차\s*(수리|관련|정비)|경정비|광택|세차",
    "기타:생활서비스": r"세탁소?|빨래방|인테리어|타로|철학|수선|열쇠|인쇄|간판|웨딩",
    "기타:약국": r"약국",
    "기타:유흥": r"유흥|단란|나이트",
}
NOISE = r"\(?선택\)?\s*안함|^\s*공실\s*$|^[=\-\.\s]*$|제?\s*[12]\s*종\s*근린생활시설|근린생활시설|근생시설|근생"  # 정보 없음(법정 용도명 포함)


# ---------------------------------------------------------------- 6) 세부 업종 (층·면적이 갈리고 표본 50건 이상인 곳만)
# 대분류 → (기본 세부 업종, 갈라지는 세부 업종, 갈라지는 쪽 키워드).  걸린 말이 키워드에 맞으면 갈라지는 쪽, 아니면 기본.
SPLIT = {
    "식음료": ("일반", "배달전문", r"배달"),
    "소매": ("일반", "전시장·쇼룸", r"전시|쇼룸"),
    "뷰티": ("미용·네일", "피부·마사지", r"피부|에스테틱|마사지|태닝|세신"),
    "교육": ("학원", "교습소·공부방", r"교습|공부방|과외"),
    "공연문화": ("스튜디오·연습실", "공방·작업실", r"공방|작업실|화실|아틀리에"),
}


def sub_labels(cat, words):
    base, alt, p = SPLIT[cat]
    out = []
    if any(not re.search(p, w) for w in words):
        out.append(base)
    if any(re.search(p, w) for w in words):
        out.append(alt)
    return out


def normalize(t):
    for p, r in NORMALIZE:
        t = re.sub(p, r, t)
    return t


def classify(text, is_feature=False):
    """return (업종 set, 기타 set, 다용도 bool, 범용 bool, 남은 글)"""
    t = normalize(text or "")
    cats, others = set(), set()
    if is_feature:
        for p in LOCATION:
            t = re.sub(p, " ", t)
    words = {}
    for p, lab in COMPOUND:
        found = [m.group(0) for m in re.finditer(p, t)]
        if found:
            if lab.startswith("기타:"):
                others.add(lab)
            else:
                cats.add(lab)
                words.setdefault(lab, []).extend(found)
            t = re.sub(p, " ", t)
    for c, p in KW.items():
        found = [m.group(0) for m in re.finditer(p, t)]
        if found:
            cats.add(c)
            words.setdefault(c, []).extend(found)
            t = re.sub(p, " ", t)
    classify.words = words
    for lab, p in OTHER.items():
        if re.search(p, t):
            others.add(lab)
            t = re.sub(p, " ", t)
    multi = bool(re.search(MULTI, t))
    t = re.sub(MULTI, " ", t)
    generic = bool(re.search(GENERIC, t))
    t = re.sub(GENERIC, " ", t)
    return cats, others, multi, generic, t


FILLER = r"시설|아트|관리|가게|센터|토탈|이용|실?내?스크린|기관|연습|여성|1인|가능|추천|활용|등|및|외|기타|각종|대형|소형|일반|전문점?|관련|업종|용도|강추|적극|입점|환영|우대|최적|로|도|의|집|점|샵|실|장|업|개인|다양한?|또는|이나|사용|드립니다|함|확장분할"


def leftover_tokens(t):
    t = re.sub(NOISE, " ", t)
    out = []
    for tok in re.split(r"[,/·、\.\s\(\)\[\]~!\*\-_=|｜oOlI:;&+]+", t):
        tok = re.sub(FILLER, "", tok).strip()
        if len(tok) >= 2:
            out.append(tok)
    return out


def rec_type(rec, cats, others, multi, generic):
    if not rec.strip():
        return "빈칸"
    if cats:
        return "업종명시+다용도" if multi else "업종명시"
    if multi:
        return "다용도만"
    if others:
        return "8업종밖만"
    if generic:
        return "범용어만"
    return "비정보"


def floor_band(s):
    s = (s or "").replace(" ", "")
    if s.startswith("지하"):
        return "지하"
    m = re.match(r"^(\d+)층$", s)
    if not m:
        return None
    n = int(m.group(1))
    return "1층" if n == 1 else ("2층" if n == 2 else "3층이상")


def dist(rows):
    n = len(rows)
    b = Counter(floor_band(r["층"]) for r in rows)
    areas = [float(r["전용면적"]) for r in rows if r["전용면적"]]
    return {"n": n, "1층": round(100 * b["1층"] / n, 1) if n else None, "2층": round(100 * b["2층"] / n, 1) if n else None,
            "3층이상": round(100 * b["3층이상"] / n, 1) if n else None, "면적중앙값": round(median(areas), 1) if areas else None}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(LISTING_CSV, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    out, left = [], Counter()
    for r in rows:
        rc, ro, rm, rg, rt = classify(r["추천용도"])
        rw = classify.words
        fc, fo, fm, fg, _ = classify(r["특징"], is_feature=True)
        fw = classify.words
        typ = rec_type(r["추천용도"], rc, ro, rm, rg)
        for tok in leftover_tokens(rt):
            left[tok] += 1
        o = {"매물번호": r["매물번호"], "구": r["구"], "층": r["층"], "전용면적": r["전용면적"],
             "추천용도": r["추천용도"], "추천용도_유형": typ,
             "업종_추천용도": "|".join(c for c in CATS if c in rc),
             "업종_특징만": "|".join(c for c in CATS if c in fc and c not in rc),
             "업종수_추천용도": len(rc),
             "다용도": rm or fm, "8업종밖": "|".join(sorted(ro)),
             "미분류_토큰": "|".join(leftover_tokens(rt))}
        for c in CATS:
            o["v2_" + c] = "추천용도" if c in rc else ("특징" if c in fc else "")
        for c in SPLIT:
            # 세부 업종은 대분류와 같은 칸(추천용도 우선)에서 걸린 말로 정한다
            o["세부_" + c] = "|".join(sub_labels(c, rw[c] if c in rc else fw[c])) if (c in rc or c in fc) else ""
        out.append(o)

    with open(OUT_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)

    by_no = {r["매물번호"]: r for r in rows}
    meta = {"기준": "v2(안)", "매물수": len(rows),
            "추천용도_유형": dict(Counter(o["추천용도_유형"] for o in out).most_common()),
            "업종수_추천용도_분포": dict(sorted(Counter(o["업종수_추천용도"] for o in out).items())),
            "전체_분포": dist(rows), "업종별": {},
            "8업종밖": dict(Counter(x for o in out for x in o["8업종밖"].split("|") if x).most_common()),
            "미분류_토큰_상위": dict(left.most_common(60)),
            "미분류_토큰_있는_매물": sum(1 for o in out if o["미분류_토큰"])}
    for c in CATS:
        rec = [by_no[o["매물번호"]] for o in out if o["v2_" + c] == "추천용도"]
        feat = [by_no[o["매물번호"]] for o in out if o["v2_" + c] == "특징"]
        solo = [by_no[o["매물번호"]] for o in out if o["v2_" + c] == "추천용도" and o["업종수_추천용도"] <= 2]
        meta["업종별"][c] = {"추천용도": dist(rec), "특징만": len(feat), "합계": len(rec) + len(feat),
                           "합계_분포": dist(rec + feat), "추천용도_업종2개이하": dist(solo)}
    allb = meta["전체_분포"]
    meta["세부업종"] = {}
    for c, (base, alt, _) in SPLIT.items():
        for sub in (base, alt):
            g = [by_no[o["매물번호"]] for o in out if sub in o["세부_" + c].split("|")]
            d = dist(g)
            lift = [d[b] / allb[b] for b in ("1층", "2층", "3층이상")]
            d["층점수"] = [round(40 + 60 * x / max(lift)) for x in lift]
            d["둘다"] = sum(1 for o in out if o["세부_" + c] == base + "|" + alt)
            meta["세부업종"][c + " / " + sub] = d
    for c in CATS:
        d = meta["업종별"][c]["합계_분포"]
        lift = [d[b] / allb[b] for b in ("1층", "2층", "3층이상")]
        d["층점수"] = [round(40 + 60 * x / max(lift)) for x in lift]
    with open(OUT_META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    for k in ("추천용도_유형", "8업종밖"):
        print(k, meta[k])
    for c in CATS:
        print(c, meta["업종별"][c]["합계"], "=", meta["업종별"][c]["추천용도"]["n"], "+", meta["업종별"][c]["특징만"], meta["업종별"][c]["합계_분포"])
    for k, v in meta["세부업종"].items():
        print("  ", k, v)


if __name__ == "__main__":
    main()
