"""v1 → v2 비교 대시보드(16:9 한 장, 탭 12개)를 만든다.

숫자는 손으로 옮기지 않고 결과 파일과 설계 문서 표에서 읽는다.
  data/09.스코어링/점수_v1.csv · 점수_v1_config.json · 점수_v1_검사.json      (v1 엔진)
  data/09.스코어링/점수_v2.csv · 점수_v2_config.json · 점수_v2_검사.json      (v2 엔진)
  data/09.스코어링/용도분류_v2_meta.json                                        (v2 분류)
  data/09.스코어링/인자민감도_v2.json                                            (factor_sensitivity.py)
  data/09.스코어링/스코어링 모델 구축 설계.md                                     (분류 기준·결정 표)
  data/scripts/scoring_engine_v1.py (v1 키워드) · classify_use.py (v2 규칙)
근거 조사 결과(EVIDENCE)는 이 파일에 적는다 (2026-11-18 조사).

템플릿  data/scripts/compare_board_template.html
출력    발표용 데모파일/v2.대구_공실_스코어링_v1v2비교_16x9.html
실행    py -I data/scripts/build_compare_board.py
"""
import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import classify_use as cu  # noqa: E402
import scoring_engine_v1 as v1  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SC = os.path.join(ROOT, "data", "09.스코어링")
MD = os.path.join(SC, "스코어링 모델 구축 설계.md")
TEMPLATE = os.path.join(HERE, "compare_board_template.html")
OUT = os.path.join(ROOT, "발표용 데모파일", "v2.대구_공실_스코어링_v1v2비교_16x9.html")
CATS = ["식음료", "소매", "뷰티", "공연문화", "사무업무", "교육", "의료", "운동시설"]

S = {  # 출처 (이름, 주소)
    "manly": ["Manly 외 (2003) Resource Selection by Animals 2판 — 선택비 = 이용 ÷ 가용 (R adehabitatHS 문서)", "https://search.r-project.org/CRAN/refmans/adehabitatHS/html/wi.html"],
    "fracmax": ["EC 공동연구센터 COINr n_fracmax — 최댓값 대비 비율 정규화", "https://bluefoxr.github.io/COINr/reference/n_fracmax.html"],
    "minmax": ["COINr n_minmax — 지정 구간 [l, u]로 옮기기", "https://bluefoxr.github.io/COINr/reference/n_minmax.html"],
    "prank": ["COINr n_prank — 백분위 순위 정규화", "https://search.r-project.org/CRAN/refmans/COINr/html/n_prank.html"],
    "amean": ["COINr a_amean — 가중 산술평균, 결측 지표는 가중치와 함께 빼고 남은 가중치로 다시 나눔", "https://search.r-project.org/CRAN/refmans/COINr/html/a_amean.html"],
    "thresh": ["COINr 집계 안내 — 데이터 가용률 기준(dat_thresh, 예시 2/3)", "https://ftp.fau.de/cran/web/packages/COINr/vignettes/aggregate.html"],
    "uta": ["Jacquet-Lagrèze·Siskos (1982) UTA 방법 — 구간별 선형 가치함수를 선호 순위로 추정 (EJOR 10, 151–164)", "https://www.mcda-school18.tuc.gr/Slides/UTA%20methods%20I.pdf"],
    "lawappr": ["「감정평가에 관한 규칙」 제2조 임대사례비교법 정의", "https://ko.wikisource.org/wiki/%EA%B0%90%EC%A0%95%ED%8F%89%EA%B0%80%EC%97%90_%EA%B4%80%ED%95%9C_%EA%B7%9C%EC%B9%99"],
    "hedonic": ["이재우·이창무 (2006) 서울 상가시장 임대료결정요인 — 헤도닉 가격모형", "https://scholarworks.bwise.kr/hanyang/handle/2021.sw.hanyang/181751?mode=full"],
    "age": ["서울 매장용 빌딩 549동 임대료 결정요인(경과연수 포함, TSLS)", "https://koreascience.or.kr/article/JAKO201425654348500.pdf"],
    "life": ["법인세법 시행규칙 별표5 — 철근콘크리트조 기준내용연수 40년(범위 30~50년), 심판 사례 요약으로 확인", "https://www.taxcanvas.kr/core/case/000000000000114912"],
    "floor": ["상가정보연구소 층별 임대료 분석 보도(서울 2019년 1분기, 국토교통부 통계)", "https://kidd.co.kr/news/209145"],
    "floorpat": ["「상가 업종의 층별 입지 패턴에 관한 연구」 부동산학보 49집 (2012)", "https://scholar.kyobobook.co.kr/article/detail/4010023482152"],
    "station": ["서울시 역세권 장기전세주택 건립 운영기준(2023) — 승강장 경계 250m 1차, 250~500m 2차", "https://news.seoul.go.kr/citybuild/archives/1673"],
    "halfmile": ["Guerra·Cervero·Tischler — 철도역 도보권 0.5마일(약 800m) 관행 검토", "https://escholarship.org/uc/item/0m47w77k.pdf"],
    "busmin": ["국토교통부 버스 최소서비스 기준 '도시 400m' (주간경향 2023 보도, 원문 미확인)", "https://weekly.khan.co.kr/article/202303241251281"],
    "golmok": ["서울시 우리마을가게 상권분석서비스 개편 — 반경 300m 동심원을 보행 도달권으로 바꿈", "https://smartcity.go.kr/?p=29048"],
    "bldlaw": ["건축법 제19조 용도변경 — 같은 시설군 기재변경, 상위군 허가, 하위군 신고 (법제처 해석례)", "https://www.law.go.kr/LSW/expcInfoP.do?expcSeq=330409"],
    "conv": ["상가건물 임대차보호법 시행령 제2조 환산보증금 = 보증금 + 월차임 × 100 (해설 자료로 확인, 원문 확인 필요)", "https://www.lawtalk.co.kr/posts/74618"],
    "ahp": ["중견 커피 프랜차이즈 입지요인 AHP 연구(2023) 등 상가 입지 AHP 사례", "https://koreascience.kr/article/CFKO202319254425366.pdf"],
    "chi": ["적합도 카이제곱 검정으로 선택비 유의성 확인 (adehabitatHS widesI)", "https://search.r-project.org/CRAN/refmans/adehabitatHS/html/wi.html"],
}

# 판정: 있음 = 그 식(또는 요소)을 그대로 쓰는 문헌·법령 / 부분 = 형태·기준점·방향 일부만 대응 / 없음 = 대응하는 근거를 찾지 못함
EVIDENCE = [
    {"group": "비용", "factor": "임대료 부담", "formula": "(월세 + 관리비) ÷ 사용자 임대료 상한 → 50% 이하 100점, 100%에서 40점(사이는 선형), 상한 초과는 목록에서 제외",
     "parts": [["구간 사이 선형 보간", "부분", "다기준 의사결정의 구간별 선형 가치함수와 같은 형태", "uta"],
               ["50% · 100% · 40점 구간값", "없음", "외부 기준을 찾지 못함. 매출 대비 임차료 비중 공식 통계도 찾지 못함", None],
               ["상한 초과 = 필터", "부분", "사용자가 정한 예산이라 점수가 아닌 조건으로 다룸(설계 원칙, 외부 근거 아님)", None]],
     "upgrade": "good/bad의 '임대료·조건' bad 사유 비율로 구간값을 보정. 평가가 쌓이면 UTA 방법으로 구간값을 추정", "level": "A"},
    {"group": "비용", "factor": "가성비", "formula": "㎡당 월세 ÷ 같은 법정동·층대(1층 / 그 외) 중앙값(10건 미만이면 구·층대) → 0.5배 100 · 1.0배 60 · 1.5배 20 · 1.75배 0",
     "parts": [["비슷한 매물의 임대료와 비교", "부분", "임대사례비교법은 사례와 비교하되 사정보정·시점수정·가치형성요인 비교를 거침. 우리 식은 중앙값과 단순 비교", "lawappr"],
               ["층대를 나눠 비교", "부분", "1층 단가가 2층 이상보다 높음(우리 매물 1.6만 대 1.0만 원/㎡, 서울 2019 1층 3.99만 · 2층 2.43만 원/㎡)", "floor"],
               ["배율별 점수값", "없음", "", None]],
     "upgrade": "층·면적·연식·역 거리로 기대 월세를 추정하는 헤도닉 회귀 → 실제 ÷ 기대 비율로 점수화. 임대사례비교법의 '가치형성요인 비교'에 해당", "upsrc": "hedonic", "level": "A"},
    {"group": "비용", "factor": "보증금", "formula": "500만 100 · 2,000만 60 · 8,000만 20 · 1억 이상 10 (대구 매물 하위 10% / 중앙값 / 상위 10%), 무권리 명시 +10",
     "parts": [["구간값", "부분", "우리 매물 분포의 백분위(데이터 근거). 외부 기준은 없음", None],
               ["무권리 +10", "없음", "", None],
               ["보증금과 월세를 따로 셈", "없음", "같은 임대 조건을 두 인자로 나눠 반영", None]],
     "upgrade": "환산보증금(보증금 + 월세 × 100)으로 임대 조건을 하나로 합쳐 비교. 무권리는 점수 대신 배지로 (그룹 구성이 바뀌는 B 수준 변경)", "upsrc": "conv", "level": "B"},
    {"group": "비용", "factor": "그룹 안 비중", "formula": "임대료 부담 50 · 가성비 30 · 보증금 20 (공연문화 40 · 30 · 30)",
     "parts": [["비중값", "없음", "가설", None]], "upgrade": "AHP 전문가 설문 또는 good/bad로 학습", "upsrc": "ahp", "level": "B"},
    {"group": "공간", "factor": "층", "formula": "40 + 60 × 리프트 ÷ 업종 최대 리프트, 리프트 = 업종 추천 매물의 층 비율 ÷ 전체 매물의 층 비율. 지하 40",
     "parts": [["리프트(선택비)", "있음", "자원선택 분석의 선택비와 같은 식, 상권 분석의 입지계수(LQ)도 같은 구조", "manly"],
               ["÷ 최대 리프트", "있음", "최댓값 대비 비율 정규화", "fracmax"],
               ["40~100으로 옮기기", "부분", "구간 지정 자체는 표준, 하한 40이라는 값은 근거 없음", "minmax"],
               ["층 분포 유의성(p < 0.05일 때만 사용)", "있음", "선택비 분석은 카이제곱 검정과 함께 씀", "chi"],
               ["업종마다 선호 층이 다름", "있음", "택지개발지구 상가 33곳: 층은 업종 특성에 따라 정해짐", "floorpat"]],
     "upgrade": "하한 40을 good/bad 층별 비율(증거가중치)로 보정", "level": "A"},
    {"group": "공간", "factor": "면적 적합도", "formula": "(실제 − 목표) ÷ 목표 → ±20% 100, 넓으면 +50% 70 · +100% 40 · +200% 10, 좁으면 −30% 60 · −50% 20 · −60% 0. 목표 = 희망 면적 또는 업종 추천 매물 중앙값",
     "parts": [["목표 = 업종 추천 매물 중앙값", "부분", "중개사 추천 분포(데이터 근거)", None],
               ["넓음·좁음 비대칭 구간값", "없음", "좁은 쪽을 더 깎는 방향만 가설", None]],
     "upgrade": "희망 면적이 없을 때: 면적 구간별 선택비(업종 비율 ÷ 전체 비율)를 층 점수와 같은 식으로 점수화", "upsrc": "manly", "level": "A"},
    {"group": "공간", "factor": "건물 연식", "formula": "5년 100 · 10년 85 · 20년 65 · 30년 45 · 40년 이상 30",
     "parts": [["오래될수록 낮음(방향)", "부분", "매장용 빌딩 임대료 결정요인에 경과연수가 들어감(계수 부호는 원문 미확인)", "age"],
               ["40년에서 최저", "부분", "철근콘크리트조 기준내용연수 40년", "life"],
               ["연도별 점수값", "없음", "", None]],
     "upgrade": "우리 매물로 ㎡당 월세와 경과연수를 회귀해 연식 계수로 점수화", "upsrc": "hedonic", "level": "A"},
    {"group": "공간", "factor": "그룹 안 비중", "formula": "층 50 · 면적 35 · 연식 15 (목적지형 업종 35 · 45 · 20)",
     "parts": [["비중값", "없음", "가설", None]], "upgrade": "AHP 또는 good/bad 학습", "upsrc": "ahp", "level": "B"},
    {"group": "입지", "factor": "교통 · 지하철", "formula": "역 거리 250m 100 · 500m 75 · 850m 50 · 1.5km 20 · 2km 이상 10",
     "parts": [["250m · 500m 구간", "부분", "서울시 역세권 1차 250m · 2차 500m. 기준점이 승강장 경계(우리는 역 좌표)", "station"],
               ["850m 구간", "부분", "철도역 도보권 0.5마일(약 800m) 관행", "halfmile"],
               ["구간별 점수값", "없음", "", None]],
     "upgrade": "기준점을 승강장·출입구로 바꾸고 250 · 500 · 800m를 구간 끝으로", "upsrc": "station", "level": "A"},
    {"group": "입지", "factor": "교통 · 버스", "formula": "정류소 거리 60m 100 · 100m 80 · 150m 60 · 250m 30",
     "parts": [["구간값", "없음", "우리 매물 분포(90%가 207m 안)로 잡음", None],
               ["도보권 끝", "부분", "버스 도보권 400m(도시 기준) 관행·보도. 우리 구간(250m에서 30점)이 훨씬 엄격", "busmin"]],
     "upgrade": "400m를 도보권 끝으로 두는 구간", "upsrc": "busmin", "level": "A"},
    {"group": "입지", "factor": "지하철 : 버스 비율", "formula": "60 : 40 (사무업무 70 : 30)",
     "parts": [["비율값", "부분", "우리 데이터 상관과 선행 연구 4편을 종합(5장). 비율을 직접 정해 주는 자료는 없음", None]],
     "upgrade": "good/bad '입지·상권' bad 사유로 재확인", "level": "A"},
    {"group": "입지", "factor": "상권 활성도", "formula": "업종 반경(300m · 500m) 안 전체 상가 수 → 좌표 있는 대구 매물 중 백분위",
     "parts": [["백분위 정규화", "있음", "종합지수 정규화 방법", "prank"],
               ["반경 300m", "부분", "서울시 상권분석서비스의 옛 동심원 반경 예시. 지금은 보행 도달권으로 바뀜", "golmok"],
               ["상가 수 = 활성도", "없음", "대리 지표", None]],
     "upgrade": "직선 반경 대신 보행 도달권(도로망 기준)으로 집계", "upsrc": "golmok", "level": "A"},
    {"group": "입지", "factor": "배후 수요", "formula": "업종 반경 안 거주·종사자 인구(업종별 연령 지표) → 백분위",
     "parts": [["백분위 정규화", "있음", "", "prank"],
               ["반경 500m(교육·운동·사무)", "부분", "보행권 반경으로 흔히 씀(공식 기준 확인 못 함)", "golmok"],
               ["업종별 연령 지표", "없음", "가설", None]],
     "upgrade": "공공 통계에서 업종별 고객 연령 구성을 찾으면 그 비중으로 가중", "level": "A"},
    {"group": "입지", "factor": "그룹 안 비중", "formula": "교통 30 · 활성도 40 · 배후 수요 30 (업종별로 다름)",
     "parts": [["비중값", "없음", "가설", None]], "upgrade": "AHP 또는 good/bad 학습", "upsrc": "ahp", "level": "B"},
    {"group": "업종적합", "factor": "용도 일치도", "formula": "명시 100 · 다용도 60 · 신호 없음 50 · 다른 업종만 30",
     "parts": [["단계의 순서", "부분", "우리 데이터: 명시 매물의 층 일치도 89.5, 언급 없음 73.0 (2026-11-17)", None],
               ["점수값", "없음", "", None]],
     "upgrade": "good/bad로 단계별 good 비율을 보고 값 보정", "level": "A"},
    {"group": "업종적합", "factor": "건물 용도", "formula": "A 100 (그대로 입점) · B 80 (같은 근생군 기재변경) · C 40 (용도변경) · D 30 (주거)",
     "parts": [["등급 구분", "있음", "같은 시설군 안은 기재변경, 다른 시설군은 허가·신고. 시행령 별표1 용도 분류", "bldlaw"],
               ["점수값", "없음", "", None]],
     "upgrade": "절차 단계(기재변경 < 신고 < 허가) 순서는 유지하고, 간격은 good/bad '입점 어려움' 사유로 보정", "level": "A"},
    {"group": "업종적합", "factor": "그룹 안 비중", "formula": "용도 일치도 40 · 건물 용도 60",
     "parts": [["비중값", "없음", "가설", None]], "upgrade": "AHP 또는 good/bad 학습", "upsrc": "ahp", "level": "B"},
    {"group": "공통", "factor": "집계", "formula": "그룹 점수 = 인자 가중 평균, 총점 = 그룹 가중 평균. 결측 인자는 빼고 남은 가중치로 다시 나눔",
     "parts": [["가중 산술평균 + 결측 재정규화", "있음", "종합지수 도구가 같은 방식을 씀", "amean"]], "upgrade": "", "level": "C"},
    {"group": "공통", "factor": "반영률 60 미만 제외", "formula": "100점 배점 중 값이 있는 배점 합이 60 미만이면 추천 제외",
     "parts": [["가용률 기준을 두는 방식", "있음", "", "thresh"], ["60이라는 값", "없음", "예시는 2/3(67)", None]], "upgrade": "", "level": "C"},
    {"group": "공통", "factor": "구간 사이 선형 보간", "formula": "모든 구간 인자: 기준점 사이를 직선으로",
     "parts": [["형태", "있음", "", "uta"], ["기준점 값", "없음", "인자마다 위 판정 참고", None]],
     "upgrade": "평가가 쌓이면 UTA로 기준점 값을 추정", "level": "A"},
    {"group": "공통", "factor": "업종별 그룹 가중치", "formula": "예: 식음료 비용 25 · 공간 20 · 입지 35 · 업종 적합 20",
     "parts": [["가중치값", "없음", "가설. 사용자가 슬라이더로 조정", None]],
     "upgrade": "AHP 전문가 설문 또는 good/bad로 학습(학습값을 쓰면 '고정 프리셋' 원칙이 바뀌는 C 수준)", "upsrc": "ahp", "level": "C"},
]

STRUCTURE = {
    "fixed": [
        "인자 점수는 0~100",
        "그룹 점수 = 값이 있는 인자의 가중 평균",
        "총점 = 값이 있는 그룹의 가중 평균",
        "결측은 채우지 않고 같은 그룹 안에서 비중 재분배",
        "반영률 60 미만은 추천 제외",
        "기준값은 대구 분포로 고정(절대평가)",
        "화면은 엔진 인자 점수를 읽고 예산·희망 면적·가중치만 다시 계산",
    ],
    "levels": [
        {"id": "A", "name": "인자 산출식만 바꿈", "ex": "구간값, 정규화 방식, 비교 기준(예: 가성비를 헤도닉 기대 월세 대비로)",
         "fixed": "골격 7개 모두 그대로", "change": "그 인자의 점수 열 하나, 엔진 함수 하나, config 기준값. 임대료 부담·면적처럼 화면에서 다시 계산하는 인자면 화면 계산식도",
         "size": "총점 변화 = 배점 × 인자 점수 변화 ÷ 100. 결측이 없으면 최대 배점만큼"},
        {"id": "B", "name": "그룹 구성을 바꿈", "ex": "인자 추가·삭제·합치기·이동, 그룹 안 비중 (예: 보증금과 월세를 환산보증금으로 합침)",
         "fixed": "골격 7개 그대로", "change": "인자 목록·세부 비중·배점표, 반영률 계산 대상, 결과 csv 열, 화면 상세 점수 목록, 평가 스냅샷 항목. 기준값 버전을 올림",
         "size": "그룹 하나를 통째로 빼는 시험이 상한에 가까움"},
        {"id": "C", "name": "골격 자체를 바꿈", "ex": "집계식(가중 평균 → 기하 평균), 상대평가 전환, 결측 대체, 점수 ↔ 필터 전환, 가중치를 good/bad로 학습, 반영률 기준",
         "fixed": "이 경우만 '전체 규칙'이 바뀜", "change": "엔진·화면·피드백 비교 기준 전부. 이전 평가와 점수를 직접 비교할 수 없음",
         "size": "모든 업종의 순위가 함께 바뀜"},
    ],
}

FACTOR_KEYS = ["임대료부담", "가성비", "보증금", "층", "면적적합도", "건물연식", "교통", "상권활성도", "배후수요", "용도일치도", "건물용도"]
FACTOR_LABEL = {"임대료부담": "임대료 부담", "가성비": "가성비", "보증금": "보증금", "층": "층", "면적적합도": "면적 적합도", "건물연식": "건물 연식",
                "교통": "교통", "상권활성도": "상권 활성도", "배후수요": "배후 수요", "용도일치도": "용도 일치도", "건물용도": "건물 용도"}
FACTOR_GROUP = {"임대료부담": "비용", "가성비": "비용", "보증금": "비용", "층": "공간", "면적적합도": "공간", "건물연식": "공간",
                "교통": "입지", "상권활성도": "입지", "배후수요": "입지", "용도일치도": "업종적합", "건물용도": "업종적합"}


# ------------------------------------------------------------------ 읽기
def jload(name):
    with open(os.path.join(SC, name), encoding="utf-8") as f:
        return json.load(f)


def rows(name):
    with open(os.path.join(SC, name), encoding="utf-8-sig", newline="") as f:
        return {r["매물번호"]: r for r in csv.DictReader(f)}


def md_tables(heading):
    """설계 문서에서 heading(줄 전체) 아래의 표들을 [헤더, 행...] 목록으로."""
    with open(MD, encoding="utf-8") as f:
        lines = f.read().split("\n")
    i = lines.index(heading)
    level = len(heading) - len(heading.lstrip("#"))
    out, cur = [], None
    for ln in lines[i + 1:]:
        if ln.startswith("#") and len(ln) - len(ln.lstrip("#")) <= level:
            break
        if ln.startswith("|"):
            cells = [c.strip() for c in ln.strip().strip("|").split("|")]
            if all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                continue
            if cur is None:
                cur = []
                out.append(cur)
            cur.append(cells)
        else:
            cur = None
    return out


def rank(v):
    o = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(o):
        j = i
        while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]:
            j += 1
        for k in range(i, j + 1):
            r[o[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(x, y):
    rx, ry = rank(x), rank(y)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    return sum((a - mx) * (b - my) for a, b in zip(rx, ry)) / (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** .5


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    c1, c2 = jload("점수_v1_config.json"), jload("점수_v2_config.json")
    k1, k2 = jload("점수_v1_검사.json"), jload("점수_v2_검사.json")
    meta, sens = jload("용도분류_v2_meta.json"), jload("인자민감도_v2.json")
    s1, s2 = rows("점수_v1.csv"), rows("점수_v2.csv")
    with open(cu.LISTING_CSV, encoding="utf-8-sig", newline="") as f:
        listings = list(csv.DictReader(f))

    # v1 분류 (엔진 안 키워드, 추천용도 + 특징 전체)
    v1hit = {c: [L for L in listings if re.search(v1.USE_KW[c], (L["추천용도"] or "") + " " + (L["특징"] or ""))] for c in CATS}
    v1multi = sum(1 for L in listings if re.search(v1.MULTI_KW, (L["추천용도"] or "") + " " + (L["특징"] or "")))
    v2multi = sum(1 for r in s2.values() if r["분류_다용도"] == "True")

    cats = []
    for c in CATS:
        p1, b2, m = c1["preset"][c], c2["basis"][c], meta["업종별"][c]
        ids = [k for k in s2 if s1[k]["추천대상_" + c] == "True" and s2[k]["추천대상_" + c] == "True"]
        x = [float(s1[k]["총점_" + c]) for k in ids]
        y = [float(s2[k]["총점_" + c]) for k in ids]
        d = [b - a for a, b in zip(x, y)]
        top = lambda s, n: set(sorted(ids, key=lambda k: -float(s[k]["총점_" + c]))[:n])
        use_map = {"100.0": "명시", "60.0": "다용도", "50.0": "신호없음", "30.0": "타업종만"}
        use1 = {}
        for r in s1.values():
            lab = use_map.get(r["용도일치도_" + c], r["용도일치도_" + c])
            use1[lab] = use1.get(lab, 0) + 1
        d1 = cu.dist(v1hit[c])
        cats.append({
            "cat": c,
            "v1": {"n": len(v1hit[c]), "floor": p1["floor"], "area": p1["area"], "dist": d1,
                   "score": k1["업종별"][c], "use": use1},
            "v2": {"n": m["합계"], "rec": m["추천용도"]["n"], "feat": m["특징만"], "floor": b2["floor"], "floor_ref": b2["floor_ref"],
                   "floor_used": b2["floor_used"], "area": b2["area"], "p": b2["p"], "chi2": b2["chi2"], "dist": m["합계_분포"],
                   "score": k2["업종별"][c], "use": k2["용도일치도_판정"][c]},
            "chg": {"rho": round(spearman(x, y), 3), "mad": round(sum(abs(v) for v in d) / len(d), 2), "ge5": sum(1 for v in d if abs(v) >= 5),
                    "top10": len(top(s1, 10) & top(s2, 10)), "top50": len(top(s1, 50) & top(s2, 50)), "n": len(ids),
                    "use_changed": sum(1 for k in s2 if s1[k]["용도일치도_" + c] != s2[k]["용도일치도_" + c])},
        })

    subs = []
    rule_rows = {}
    for t in md_tables("### 세부 업종 (2026-11-16 결정)"):
        if t[0][:3] == ["대분류", "세부 업종", "세부 업종 분류 규칙"]:
            big = ""
            for r in t[1:]:
                big = r[0] or big
                rule_rows[(big, r[1])] = r[2]
    for key, b in c2["basis"].items():
        if ">" not in key:
            continue
        big, sub = key.split(">")
        m = meta["세부업종"][big + " / " + sub]
        subs.append({"big": big, "sub": sub, "rule": rule_rows.get((big, sub), ""), "n": b["n"], "dist": m, "floor": b["floor"], "floor_ref": b["floor_ref"],
                     "floor_used": b["floor_used"], "area": b["area"], "p": b["p"], "chi2": b["chi2"], "score": k2["업종별"][key],
                     "both": m["둘다"]})

    kw = md_tables("### 업종별 분류 기준")
    dec = md_tables("### 결정한 것과 남은 결정")
    sig = md_tables("### 신호 강도와 용도 일치도 (2026-11-17 결정)")

    data = {
        "built": "2026-11-18",
        "cats": cats, "subs": subs,
        "v1kw": {c: v1.USE_KW[c] for c in CATS}, "v1multi_kw": v1.MULTI_KW, "v1multi": v1multi, "v2multi": v2multi,
        "v2": {"normalize": [[p, r] for p, r in cu.NORMALIZE], "compound": [[p, lab] for p, lab in cu.COMPOUND], "location": list(cu.LOCATION),
               "kw": dict(cu.KW), "multi": cu.MULTI, "generic": cu.GENERIC, "noise": cu.NOISE, "other": dict(cu.OTHER), "rec_word": cu.REC_WORD,
               "split": {c: list(v) for c, v in cu.SPLIT.items()}},
        "kwTable": kw[0], "otherTable": kw[1],
        "decided": dec[0], "remaining": dec[1], "signal": sig[0], "listCount": sig[1],
        "meta": {"type": meta["추천용도_유형"], "ncat": meta["업종수_추천용도_분포"], "other": meta["8업종밖"], "signal": meta["신호"],
                 "form": meta["특징_문장형태_쌍"], "all": meta["전체_분포"], "leftover": meta["미분류_토큰_있는_매물"], "n": meta["매물수"]},
        "overlap": {"v1": k1["상위10_겹침"], "v2": k2["상위10_겹침"], "v1gu": k1["구별_상위10_겹침"], "v2gu": k2["구별_상위10_겹침"], "sub": k2["세부업종_상위10_겹침"]},
        "v1weights": {c: c1["preset"][c]["g"] for c in CATS}, "v2weights": {c: c2["preset"][c]["g"] for c in CATS},
        "same_cfg": {"breakpoints": c1["breakpoints"] == c2["breakpoints"], "use_score": c1["use_score"] == c2["use_score"],
                     "groups": c1["groups"] == c2["groups"], "factors": c1["factors"] == c2["factors"], "min_coverage": c1["min_coverage"] == c2["min_coverage"],
                     "weights": all(c1["preset"][c]["g"] == c2["preset"][c]["g"] and c1["preset"][c]["s"] == c2["preset"][c]["s"] and c1["preset"][c]["subway"] == c2["preset"][c]["subway"] for c in CATS)},
        "bp": c2["breakpoints"], "use_score": c2["use_score"], "floor_rule": c2["floor_rule"],
        "excluded": k2["층인자_제외"], "nscored": {c: k2["업종별"][c]["추천대상수"] for c in CATS}, "nscored_v1": {c: k1["업종별"][c]["추천대상수"] for c in CATS},
        "evidence": EVIDENCE, "src": S, "structure": STRUCTURE,
        "sens": sens, "factors": FACTOR_KEYS, "flabel": FACTOR_LABEL, "fgroup": FACTOR_GROUP,
    }
    # 판정 집계
    tally = {"있음": 0, "부분": 0, "없음": 0}
    for e in EVIDENCE:
        for p in e["parts"]:
            tally[p[1]] += 1
    data["tally"] = tally

    with open(TEMPLATE, encoding="utf-8") as f:
        html = f.read()
    mark = "/*@@DATA@@*/null"
    if mark not in html:
        raise SystemExit("템플릿에 DATA 자리가 없습니다")
    html = html.replace(mark, json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("작성:", OUT, "%.0f KB" % (os.path.getsize(OUT) / 1024), "| 근거 판정", tally, "| 설정 동일 여부", data["same_cfg"])


if __name__ == "__main__":
    sys.exit(main())
