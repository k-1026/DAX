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
    "reb": ["한국부동산원 상업용부동산 임대동향조사(국가승인통계 제408001호) 통계산출항목 — 환산임대료 = 보증금 × 전환율 ÷ 12 + 월 임대료, 관리비·부가세 제외", "https://www.reb.or.kr/reb/cm/cntnts/cntntsView.do?mi=10335&cntntsId=1049&statId=S237220284"],
    "law5": ["상가건물 임대차보호법 시행령 제5조 — 보증금을 월차임으로 전환할 때 상한: 연 1할2푼과 기준금리 × 4.5배 중 낮은 값", "https://www.law.go.kr/법령/상가건물임대차보호법시행령/제5조"],
    "law2": ["상가건물 임대차보호법 시행령 제2조 제3항 — 환산보증금 = 보증금 + 월세 × 100 (법 적용범위 판단용)", "https://www.law.go.kr/법령/상가건물임대차보호법시행령/제2조"],
    "ahp": ["중견 커피 프랜차이즈 입지요인 AHP 연구(2023) 등 상가 입지 AHP 사례", "https://koreascience.kr/article/CFKO202319254425366.pdf"],
    "chi": ["적합도 카이제곱 검정으로 선택비 유의성 확인 (adehabitatHS widesI)", "https://search.r-project.org/CRAN/refmans/adehabitatHS/html/wi.html"],
    # 2026-11-18~20 그룹 안 비중 보완 (권혜림: 공간 · 입지 · 그룹 안 비중)
    "oecdhb": ["OECD·JRC (2008) Handbook on Constructing Composite Indicators — 가중치 방법 6.1.8 AHP, 6.1.5 예산 배분 (목차로 확인)", "https://knowledge4policy.ec.europa.eu/sites/default/files/jrc47008_handbook_final.pdf"],
    "kdi": ["KDI 예비타당성조사 수행을 위한 일반지침 수정·보완 연구(제5판) — 다기준 분석과 AHP 기법 (목차로 확인)", "https://www.kdi.re.kr/research/reportView?pub_no=11672"],
    "saaty": ["Saaty, How to Make a Decision: The Analytic Hierarchy Process — 일관성 비율 10% 이하면 판단을 받아들임", "https://www.isahp-org.creativedecisions.net/uploads/1-how-to-make-a-decision-the-analytic-hierarchy-process-t-l-saaty.pdf"],
    "forman": ["Forman·Peniwati (1998) Aggregating individual judgments and priorities with the AHP, EJOR 108 — 개인 판단 통합은 기하평균", "https://www.isahp.org/uploads/383-aggregating.pdf"],
    "becker": ["Becker·Saisana·Paruolo·Vandecasteele (2017) Weights and importance in composite indicators, Ecological Indicators 80 — 비중과 실제 영향이 다름", "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5473177/"],
    "optw": ["COINr get_opt_weights — 목표 중요도에 맞도록 비중을 최적화 (Becker 외 2017의 선형판)", "https://search.r-project.org/CRAN/refmans/COINr/html/get_opt_weights.html"],
    "critic": ["Diakoulaki·Mavrotas·Papayannakis (1995) CRITIC 방법, Computers & Operations Research 22(7) — 표준편차와 인자 간 상관으로 객관 가중치", "https://reformship.github.io/pages/1capacity/1model/11evaluation/Determining%20objective%20weights%20in%20multiple%20criteria%20problems%20The%20CRITIC%20method.pdf"],
    "mcdmrev": ["다기준 의사결정 방법 리뷰 (arXiv 2410.05713) — 엔트로피·CRITIC 가중치는 퍼짐이 큰 기준에 큰 비중, 정규화 방식에 좌우됨", "https://arxiv.org/pdf/2410.05713"],
    "roc": ["Barron·Barrett (1996) Decision quality using ranked attribute weights, Management Science 42(11) — 중요도 순서만으로 비중(ROC)", "https://ideas.repec.org/a/inm/ormnsc/v42y1996i11p1515-1523.html"],
    "frlr": ["빈도비·AHP·이변량 통계·로지스틱 회귀 비교 (GIS 산사태 취약성) — 발생 자료로 인자 가중치를 추정해 AHP와 검증 성능 비교", "https://web.itu.edu.tr/tahsin/PAPERBOX/A19.pdf"],
    "elazig": ["엘라즈 농촌 입지 적합성: 빈도비·AHP·로지스틱 회귀 비교 — 로지스틱 회귀와 빈도비가 AHP보다 적합한 결과", "https://dergipark.org.tr/en/download/article-file/1942939"],
    "wofe": ["Bonham-Carter·Agterberg·Wright (1989) 증거가중치 — W+, W−, 대비 C (UNICAMP 설명)", "https://www.ige.unicamp.br/wofe/documentation/wofeintr.htm"],
    "survival": ["젠트리피케이션 지역 음식점업 생존율의 공간적 요인 (서울) — 지하철역 접근성 효과가 지역·업종별로 다름", "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART002629633"],
    "flagship": ["플래그십 스토어 입지선정 요인 연구 (부동산연구 2021) — 전문가 설문 AHP, 상위 5개 · 하위 20개 요인", "https://journal.kci.go.kr/krer/archive/articleView?artiId=ART002698360"],
    # 2026-11-23~25 공간 인자 보완 (권혜림, 기록: 09.스코어링/공간_작업기록_1123.md)
    "efron": ["Efron·Morris (1975) Data Analysis Using Stein's Estimator and its Generalizations, JASA — 적은 표본 추정값을 전체 쪽으로 당기는 수축", "https://www.jstor.org/stable/2285814"],
    "casella": ["Casella (1985) An Introduction to Empirical Bayes Data Analysis, The American Statistician — 베타-이항 경험적 베이즈, 당기는 세기를 자료로 추정", "https://www.jstor.org/stable/2682801"],
    "cohen": ["Wuensch, Effect size conventions — Cohen w 기준 0.1 작음 · 0.3 중간 · 0.5 큼", "https://core.ecu.edu/wuenschk/docs30/EffectSizeConventions.pdf"],
    "effsz": ["R effectsize: Effect sizes for contingency tables — 분할표 효과크기(Cohen w, Cramér V)", "https://cran.r-project.org/web/packages/effectsize/vignettes/xtabs.html"],
    "holm": ["Holm (1979) A Simple Sequentially Rejective Multiple Test Procedure, Scandinavian Journal of Statistics — 여러 검정 동시 보정", "https://www.jstor.org/stable/4615733"],
    "rosen": ["Rosen (1974) Hedonic Prices and Implicit Markets, Journal of Political Economy — 헤도닉 가격 방법", "https://www.jstor.org/stable/1830899"],
    "cameron": ["Cameron·Miller (2015) A Practitioner's Guide to Cluster-Robust Inference, JHR — 같은 건물 매물 묶음 군집 강건 표준오차", "https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015_February.pdf"],
    "molit": ["국토교통부 상업업무용 부동산 매매 실거래가 자료 (공공데이터포털 API) — 대구 2023~2025", "https://www.data.go.kr/data/15126463/openapi.do"],
    "varma": ["Varma·Simon (2006) Bias in error estimation when using cross-validation for model selection, BMC Bioinformatics — 고르는 과정까지 교차검증 안에 넣는 중첩 교차검증", "https://bmcbioinformatics.biomedcentral.com/articles/10.1186/1471-2105-7-91"],
}

# 판정: 있음 = 그 식(또는 요소)을 그대로 쓰는 문헌·법령 / 부분 = 형태·기준점·방향 일부만 대응 / 없음 = 대응하는 근거를 찾지 못함
EVIDENCE = [
    {"group": "비용", "factor": "임대료 부담+보증금",
     "formula": "후보 = 월세 ≤ 월세 상한 그리고 보증금 ≤ 보증금 상한(입력한 칸만, 둘 다 없으면 대구 전체) → 환산 월 임대료 = 월세 + 보증금 × 1% → 후보의 10%~90% 분위값에 100·90·…·20점, 가장 비싼 후보 10점(사이는 선형 보간). 관리비 제외",
     "parts": [["월세 + 보증금 × 전환율 ÷ 12", "있음", "환산임대료 산식과 같음. 부동산원은 ㎡당 값을 전용+공용면적으로 나눔", "reb"],
               ["전환율 연 12% (월 1%)", "부분", "법정 전환 상한이지 시장 전환율이 아님. 기준금리 2.67% 미만이면 상한이 12%보다 낮아짐. 대구 상권별 전환율은 확인 못함", "law5"],
               ["보증금 × 1%", "부분", "환산보증금(월세 × 100)과 같은 비율. 법 적용범위를 가르는 조항이라 검산용", "law2"],
               ["관리비 제외", "있음", "환산임대료는 관리비·부가세 제외. 매물 월세가 부가세 포함가인지는 미확인", "reb"],
               ["월세·보증금 칸마다 따로 필터", "없음", "우리 설계. 환산 예산 하나로 거르면 보증금 상한을 넘는 매물이 통과(월 100만 / 보증금 1,000만 시험 229건)", None],
               ["후보 분위값을 경계로", "부분", "경계값은 이용자 예산 안 후보 분포에서 나옴(데이터 근거). 백분위 순위 정규화와 비슷한 구조", "prank"],
               ["경계값마다 10점, 최저 10점", "없음", "우리 설계. 사이는 선형 보간(공통 규칙)", None]],
     "upgrade": "전환율을 min(12%, 기준금리 × 4.5)로 자동 계산, 부동산원 대구 상권 전환율을 확보하면 대체. 10점 간격은 good/bad '임대료·조건' bad 사유로 보정",
     "upsrc": "reb", "level": "B",
     "added": [["합침", "임대료 부담 + 보증금 → 한 인자", None, "비용 세부 비중은 두 인자의 합 70 (공연문화 40 + 30)", None],
               ["바뀜", "입력 1칸 → 2칸", None, "임대료 상한(월세 + 관리비) → 월세 상한 + 보증금 상한", None],
               ["바뀜", "점수 방식", None, "(월세 + 관리비) ÷ 예산의 고정 구간(50% 100점 · 100% 40점) → 예산 안 후보의 환산 월 임대료 순서. 예산은 후보 고르기에만 씀", None],
               ["삭제", "관리비", None, "결측 61%를 0으로 채우던 문제가 없어짐. 화면에 따로 표시", None],
               ["삭제", "보증금 고정 구간", None, "500만 100 · 2,000만 60 · 8,000만 20 · 1억+ 10 → 환산식 안으로", None],
               ["삭제", "무권리 +10", None, "권리금 정보라 통합 식에 자리 없음. 정보로만 남김", None],
               ["바뀜", "예산 미입력", None, "인자 제외 → 대구 전체를 후보로 같은 방식", None]]},
    {"group": "비용", "factor": "가성비", "formula": "㎡당 월세 ÷ 같은 법정동·층대(1층 / 그 외) 중앙값(10건 미만이면 구·층대) → 0.5배 100 · 1.0배 60 · 1.5배 20 · 1.75배 0",
     "parts": [["비슷한 매물의 임대료와 비교", "부분", "임대사례비교법은 사례와 비교하되 사정보정·시점수정·가치형성요인 비교를 거침. 우리 식은 중앙값과 단순 비교", "lawappr"],
               ["층대를 나눠 비교", "부분", "1층 단가가 2층 이상보다 높음(우리 매물 1.6만 대 1.0만 원/㎡, 서울 2019 1층 3.99만 · 2층 2.43만 원/㎡)", "floor"],
               ["배율별 점수값", "없음", "", None]],
     "upgrade": "층·면적·연식·역 거리로 기대 월세를 추정하는 헤도닉 회귀 → 실제 ÷ 기대 비율로 점수화. 임대사례비교법의 '가치형성요인 비교'에 해당", "upsrc": "hedonic", "level": "A"},
    {"group": "비용", "factor": "그룹 안 비중", "formula": "임대료 부담+보증금 70 · 가성비 30 (모든 업종. 이전 임대료 부담 50 · 가성비 30 · 보증금 20, 공연문화 40 · 30 · 30)",
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
    {"group": "공통", "factor": "반영률 60 미만 제외", "formula": "100점 배점 중 값이 있는 배점 합이 60 미만이면 추천 제외. 좌표 없는 매물(48건)은 반영률과 관계없이 제외(2026-11-18)",
     "parts": [["가용률 기준을 두는 방식", "있음", "", "thresh"], ["60이라는 값", "없음", "예시는 2/3(67)", None]], "upgrade": "", "level": "C"},
    {"group": "공통", "factor": "구간 사이 선형 보간", "formula": "모든 구간 인자: 기준점 사이를 직선으로",
     "parts": [["형태", "있음", "", "uta"], ["기준점 값", "없음", "인자마다 위 판정 참고", None]],
     "upgrade": "평가가 쌓이면 UTA로 기준점 값을 추정", "level": "A"},
    {"group": "공통", "factor": "업종별 그룹 가중치", "formula": "예: 식음료 비용 25 · 공간 20 · 입지 35 · 업종 적합 20",
     "parts": [["가중치값", "없음", "가설. 사용자가 슬라이더로 조정", None]],
     "upgrade": "AHP 전문가 설문 또는 good/bad로 학습(학습값을 쓰면 '고정 프리셋' 원칙이 바뀌는 C 수준)", "upsrc": "ahp", "level": "C"},
]


# 추가 변경된 사항 (권혜림 담당: 그룹 안 비중). 형식은 은혜 님 열과 같음: [구분, 요소, 판정, 설명, 출처 키(또는 목록)]
D18 = " 11.18"


def _weight_entries(pairs_note, lr_judge, lr_note):
    return [
        ["추가" + D18, "AHP 쌍대비교로 비중을 정함 (방법)", "있음", "종합지수 가중치를 정하는 참여형 방법(OECD·JRC 핸드북 6.1.8), 예타 다기준분석의 기본 기법. 업종 → 그룹 → 인자 계층에 맞음. 직접 설문이 필요해 보류", ["oecdhb", "kdi"]],
        ["추가" + D18, "응답 일관성 기준 CR ≤ 0.1", "있음", pairs_note, ["saaty"]],
        ["추가" + D18, "전문가 여러 명의 판단을 기하평균으로 합침", "있음", "쌍대비교 값을 응답자별로 기하평균(AIJ)해야 역수 성질이 유지됨", ["forman"]],
        ["추가" + D18, "다른 연구의 AHP 가중치를 그대로 씀", "부분", "상가 입지 AHP 연구는 계층·인자·업종이 우리와 달라 순서 참고만 가능, 값으로는 못 씀", ["ahp", "flagship"]],
        ["추가" + D18, "설문 없이 ① 중개사 추천 라벨로 선택비·로지스틱 회귀", lr_judge, lr_note, ["frlr", "elazig"]],
        ["추가" + D18, "설문 없이 ② 동일 비중 + 실제 영향 보정", "부분", "중요도 정보가 없을 때의 기본값. 비중이 같아도 실제 영향은 상관·분산 때문에 달라지므로 목표 영향에 맞게 최적화. 업종별 차이는 말해 주지 않음", ["becker", "optw"]],
        ["추가" + D18, "설문 없이 ③ 엔트로피·CRITIC", "부분", "자료의 퍼짐·상관만으로 계산하는 객관 가중치. '많이 퍼진 인자 = 중요'라는 가정이고 정규화 방식에 좌우됨", ["critic", "mcdmrev"]],
        ["추가" + D18, "설문 없이 ④ 논문의 중요도 순서 + 순위 중심 가중치(ROC)", "부분", "논문이 순서만 줄 때 순서를 비중으로 바꾸는 공식. 논문마다 순서가 엇갈리면 쓸 수 없음(예: 지하철역 접근성과 생존의 방향)", ["roc", "survival"]],
    ]


MY_ADDED = {
    ("비용", "그룹 안 비중"): _weight_entries("쌍 1개(임대료 부담+보증금 · 가성비)라 CR이 항상 0. 일관성 검사가 의미 없어 응답 분산을 함께 봐야 함",
                                         "없음", "업종 추천 여부를 인자 점수로 설명해 비중을 구하는 방식. 아래 실측처럼 방향이 반대라 비용에는 쓰지 않음"),
    ("공간", "그룹 안 비중"): _weight_entries("쌍 3개(층·면적·연식)라 CR 계산 가능",
                                         "부분", "2,717건 중개사 추천용도(업종 추천 여부 1/0)로 층·면적·연식의 선택비를 구해 비중으로. 층 점수·기본 면적이 같은 라벨로 만들어져 5겹 교차검증 필요"),
    ("입지", "그룹 안 비중"): _weight_entries("쌍 3개(교통·활성도·배후 수요)라 CR 계산 가능. 지하철 : 버스 비율은 교통 안의 비율이라 따로 다룸",
                                         "부분", "같은 방식. 입지 인자는 라벨과 별개인 외부 데이터라 순환 문제 없음. 다만 라벨은 공간 적합 판단이라 입지 목적과 다름"),
    ("업종적합", "그룹 안 비중"): _weight_entries("쌍 1개(용도 일치도·건물 용도)라 CR이 항상 0",
                                           "없음", "용도 일치도가 추천 라벨 자체라 이 방식을 쓸 수 없음"),
}
for _e in EVIDENCE:
    _m = MY_ADDED.get((_e["group"], _e["factor"]))
    if _m:
        _e["added"] = (_e.get("added") or []) + _m


D25 = " 11.25"


def apply_space(evidence, c2):
    """공간 인자 보완 (2026-11-23~25 시험·결정, 11-25 엔진 적용). 계산식·비중·m은 엔진 config에서 읽고,
    시험 숫자는 09.스코어링/층점수_수축.json · 면적적합도_보완.json · 건물연식_보완.json · 공간_그룹안비중_D1_최소비중.json · 지하점수_확인.json."""
    row = {(e["group"], e["factor"]): e for e in evidence}
    fr, ar = c2["floor_rule"], c2["area_rule"]
    m = " · ".join("%s %s" % (k.replace("3층이상", "3층+"), v) for k, v in fr["m"].items())
    age = " · ".join("%g년 %d" % (x, y) for x, y in c2["breakpoints"]["건물연식"])
    sw = " · ".join(c + " " + "·".join(str(x) for x in c2["preset"][c]["s"]["공간"]) for c in CATS)
    before = c2["space_weight_before"]

    e = row[("공간", "층")]
    e["formula"] = ("100 × 수축 선택비 ÷ 업종 최대 (1층 · 2층 · 3층 이상 · 지하). 수축 비율 = (업종 개수 + m × 전체 비율) ÷ (업종 매물 수 + m), "
                    "선택비 = 수축 비율 ÷ 전체 비율. m은 층 구간마다 대분류 8개로 정함(" + m + "), 세부 업종은 대분류 쪽으로 당김")
    e["parts"] = [["선택비(업종 비율 ÷ 전체 비율)", "있음", "자원선택 분석의 선택비, 상권 분석의 입지계수(LQ)와 같은 구조", "manly"],
                  ["수축(매물 적은 업종을 평균 쪽으로)", "있음", "당기는 세기 m을 사람이 아니라 베타-이항 주변우도로 정함(경험적 베이즈)", "casella"],
                  ["÷ 최대 (하한 없음)", "있음", "최댓값 대비 비율 정규화", "fracmax"],
                  ["업종마다 선호 층이 다름", "있음", "업종 대 나머지 검정 18개 모두 유의(Holm 보정), Cohen w로 크기 판정", "floorpat"],
                  ["지하 점수", "부분", "지하 매물이 전체의 2.5%라 평균 쪽으로 크게 당겨짐(m 631). 지하 > 2층인 업종 6개는 2층 대 지하 차이가 유의하지 않음", "manly"]]
    e["upgrade"] = "good/bad 층별 비율(증거가중치)로 수축 선택비 보정"
    e["added"] = (e.get("added") or []) + [
        ["바뀜 11.24", "리프트 → 수축 선택비", "있음", "매물 적은 업종의 우연한 0건(배달전문 2·3층 0건 → 40점)을 전체·대분류 쪽으로 당김. m: " + m, ["efron", "casella"]],
        ["바뀜 11.24", "40 + 60 × … → 100 × … (하한 40 없앰, D5)", "있음",
         "40 + 60 × 는 층 비중을 줄이는 것과 같은 효과(유효 가중치). 같은 비중에서 판별력(AUC) 차이 ±0.003 이하, 층 중요도는 그룹 안 비중(D1)으로 정함", ["becker", "fracmax"]],
        ["삭제 11.23", "p ≥ 0.05면 층 인자 제외", "있음", "'확신 없음'을 '차이 없음'으로 다루던 절벽. 수축이 대신함 → 공연문화·소매>전시장·쇼룸도 층 인자 사용", ["casella"]],
        ["바뀜 11.23", "검정: 적합도 카이제곱·V → 업종 대 나머지 2×3 독립성 + Cohen w, Holm 18개", "있음",
         "자기 포함 비교와 효과크기 이름·기준을 바로잡음. 층 인자 사용 판정은 변화 없음(구분 안 되는 것은 공연문화·전시장·쇼룸 p 0.212뿐)", ["cohen", "effsz", "holm"]],
        ["바뀜 11.24", "지하 일괄 40(공연문화 보류) → 수축 선택비 (D10)", "부분",
         "지하 > 2층 6개(식음료 62 · 39, 소매 57 · 27 등)는 자료 부족으로 평균 쪽 값. 2층 대 지하 p 0.16~0.52(배달전문 0.014). 지하 ≤ 2층으로 막아도 상위 10·50 그대로라 예외 규칙 두지 않음", ["manly"]],
    ]

    e = row[("공간", "면적 적합도")]
    e["formula"] = ("희망 면적 없음: 면적 11구간(10분위 + 95% 분위, 경계 " + " · ".join("%g" % x for x in ar["구간경계_㎡"]) +
                    "㎡) 수축 선택비 → 100 × ÷ 업종 최대, 구간 가운데 사이 log 면적 선형 보간. 희망 면적 있음: 최소 면적 미만(·최대 면적 초과) 추천 제외, 통과 매물은 면적 점수 없이 공간 그룹 안 재분배")
    e["parts"] = [["면적 구간 선택비", "있음", "층과 같은 식(업종 비율 ÷ 전체 비율)", "manly"],
                  ["수축", "있음", "층과 같은 경험적 베이즈, 구간마다 m", "casella"],
                  ["면적이 업종을 가름", "있음", "업종 대 나머지 18개 모두 유의(Holm), Cohen w 0.27~1.63", "cohen"],
                  ["11구간 (10분위 + 95%)", "부분", "10분위는 관행. 큰 면적 끝 구간을 95%에서 나누는 시험으로 정함(우리 데이터)", None],
                  ["희망 면적 = 최소 조건(필터)", "없음", "우리 설계. 예산처럼 한도는 거르고 점수로 두 번 세지 않음", None]]
    e["upgrade"] = "good/bad '면적' 사유로 구간 수축 선택비 보정"
    e["added"] = (e.get("added") or []) + [
        ["바뀜 11.24", "목표(업종 중앙값) 대비 비대칭 구간 → 면적 구간 수축 선택비 (D7)", "있음",
         "중앙값이 선택비가 가장 높은 구간이 아니었고, 넓음·좁음 비대칭 방향이 업종마다 반대. 판별력(AUC) 18개 중 15개 높음", ["manly", "casella"]],
        ["바뀜 11.24", "희망 면적 = 목표 → 최소 면적 조건 (D8)", "없음",
         "곡선을 희망 면적으로 옮기는 방식은 데이터와 안 맞음. 최소 미만 제외, 통과 매물은 면적 점수 없음, 최대 면적은 선택 입력, 경계 허용 없음", None],
        ["삭제 11.24", "넓음·좁음 구간값 (±20% 100 · +50% 70 · −30% 60 …)", None, "근거 없던 비대칭 구간값", None],
    ]

    e = row[("공간", "건물 연식")]
    e["formula"] = "헤도닉 곡선 (구간 가운데 연식): " + age + ", 그 뒤 " + str(c2["breakpoints"]["건물연식"][-1][1]) + ". 사이 선형 보간, 업종 공통"
    e["parts"] = [["오래될수록 낮음(방향)", "있음", "우리 매물 헤도닉 회귀(동·층·면적·유형 고정, 2,697건, 같은 건물 군집 강건). 구 고정·월세만으로 바꿔도 같음, 공공 매매 실거래도 같은 방향", "rosen"],
                  ["35~45년에서 바닥", "부분", "우리 매물 −52~−56% 뒤 평평, 일반 건물 매매도 35~40년 바닥. 철근콘크리트 내용연수 40년", "life"],
                  ["연도별 점수값", "부분", "100 × exp(계수) ÷ 최대, 단조 정리. 0~15년은 공공 매매 실거래와 일치, 15년 이후 값은 우리 매물 호가 회귀 하나에 근거", "molit"],
                  ["업종 공통 곡선", "부분", "의료·운동·교육·뷰티는 새 건물 쪽 매물이 많음(w 0.31~0.50) → 업종 차이는 그룹 안 비중으로 반영", None]]
    e["upgrade"] = "실제 계약 임대료 자료가 생기면 같은 회귀로 다시 추정. 리모델링 여부 반영"
    e["added"] = (e.get("added") or []) + [
        ["바뀜 11.24", "100 · 85 · 65 · 45 · 30 → 헤도닉 곡선 (D9)", "부분",
         "처음 10년 안에 더 빨리 떨어지고 바닥이 47(같은 조건 신축 대비 ㎡당 임대료 약 절반). 공실 매물 호가 자료, 0~5년에 신축 분양 호가 섞일 수 있음", ["rosen", "cameron"]],
        ["추가 11.24", "공공 매매 실거래로 모양 검증", "부분",
         "국토부 상업업무용 매매 3,589건(2023~2025): 방향·0~15년 일치(5~10년 우리 −25%, 구분상가 −27%), 15~20년은 매매가 더 떨어짐, 35년 이후 구분상가 거래 적어 비교 불가", ["molit"]],
    ]

    e = row[("공간", "그룹 안 비중")]
    e["formula"] = "층 · 면적 · 연식: " + sw
    e["parts"] = [["비중값", "부분", "중개사 추천용도(이 업종 대 다른 업종) 판별력 AUC가 가장 높은 비중, 5 간격 격자, 고르는 과정까지 5겹 교차검증 안에서. 대리 라벨이라 실제 임차 성공으로 검증한 것은 아님", "varma"],
                  ["인자마다 최소 10", "부분", "데이터로 고른 비중이 0이 되는 것을 하한 제약으로 막음(사무업무 100·0·0 → 70·20·10). 10은 하한 10~15에서 판별력 손해가 없음을 보고 정함", "becker"]]
    e["upgrade"] = "good/bad가 쌓이면 같은 방식으로 다시 추정"
    e["added"] = (e.get("added") or []) + [
        ["바뀜" + D25, "가설 비중 → 업종별 판별력 최적 + 최소 10 (D1)", "부분",
         "이전 " + " · ".join(c + " " + "·".join(str(x) for x in before[c]) for c in ("식음료", "공연문화", "사무업무", "교육")) +
         " 등. AUC 이전 → 새: 식음료 0.815 → 0.819, 뷰티 0.738 → 0.760, 사무업무 0.627 → 0.652, 교육 0.768 → 0.783, 의료 0.879 → 0.885, 공연문화 0.564 → 0.571 (소매·운동시설 ±0.002). 부트스트랩 범위 좁음(의료 층 15~25, 뷰티 면적 50~65)",
         ["varma", "becker"]],
    ]


def add_estimation(evidence):
    """weight_estimation.py 결과(업종별_그룹안비중_추정.json)를 '추가 변경된 사항'에 붙인다. 숫자는 파일에서 읽음."""
    path = os.path.join(ROOT, "data", "09.스코어링", "업종별_그룹안비중_추정.json")
    if not os.path.exists(path):
        return
    J = json.load(open(path, encoding="utf-8"))
    U = J["업종"]
    f0 = lambda x: "%.0f" % x
    row = {(e["group"], e["factor"]): e for e in evidence}
    D = " 11.18"

    parts, aucs, widths = [], [], []
    for c in CATS:
        o = U[c]["그룹"]["공간"]
        w = o["방법"]["FR"]["비중"]
        parts.append(c + ("(층 제외, 면적·연식)" if "층" not in o["인자"] else "") + " " + "·".join(f0(x) for x in w))
        aucs.append("%s %.3f→%.3f" % (c, o["AUC_현재"], o["방법"]["FR"]["AUC"]))
        widths.append(o["방법"]["FR"]["구간폭평균"])
    rk = [U[c]["총점비교"]["FR_공간만"] for c in CATS]
    row[("공간", "그룹 안 비중")]["added"] += [
        ["추가" + D, "선택비로 업종별 층·면적·연식 비중 계산 (5겹 교차검증)", "있음",
         "업종 추천 매물 비율 ÷ 전체 비율(층 점수와 같은 식). " + " / ".join(parts) + ". 판별력 AUC 현재→선택비: " + ", ".join(aucs) +
         ". 90%% 구간 폭 %s~%s. 공간만 바꾸면 총점 순위 상관 %.3f~%.3f, 상위 10 중 %d~%d개 유지 (weight_estimation.py)" % (
             f0(min(x for x in widths if x is not None)), f0(max(widths)), min(r["순위상관"] for r in rk), max(r["순위상관"] for r in rk),
             min(r["상위10유지"] for r in rk), max(r["상위10유지"] for r in rk)), ["manly", "frlr"]],
        ["추가" + D, "증거가중치·로지스틱 회귀와 비교", "있음",
         "세 방법의 판별력 차이 0.01 안팎. 선택비가 가장 안정적이고 층 점수와 같은 식이라 채택안. 로지스틱은 겹치는 인자를 0으로 만듦(예: 소매 면적 0)", ["wofe", "frlr"]],
        ["바뀜" + D, "비중값", "부분", "없음 → 선택비로 계산한 값이 생김(엔진 미반영). 중개사 추천 판단에 맞춘 값이고 실제 영업 성과로 검증한 것은 아님", None],
    ]
    stable, unstable, none = [], [], []
    for c in CATS:
        o = U[c]["그룹"]["입지"]["방법"]["FR"]
        if o["비중"] is None:
            none.append(c)
        elif o["구간폭평균"] is not None and o["구간폭평균"] <= 20:
            stable.append(c + " " + "·".join(f0(x) for x in o["비중"]))
        else:
            unstable.append("%s(폭 %s)" % (c, f0(o["구간폭평균"])))
    row[("입지", "그룹 안 비중")]["added"].append(
        ["바뀜" + D, "① 라벨 선택비 실측 결과", "부분",
         "안정적으로 추정되는 업종은 " + ", ".join(stable) + "(교통·활성도·배후, 구간 폭 20 이하). " + ", ".join(none) +
         "는 세 인자 모두 업종 매물이 오히려 낮아 추정 불가. 불안정: " + ", ".join(unstable) + ". 점포 생존·실제 점포 위치 같은 결과 자료가 필요", ["frlr"]])
    rev = ["%s %.3f" % (c, U[c]["그룹"]["비용"]["AUC_현재"]) for c in CATS if U[c]["그룹"]["비용"]["AUC_현재"] < 0.5]
    row[("비용", "그룹 안 비중")]["added"].append(
        ["바뀜" + D, "① 라벨 선택비 실측 결과", "없음",
         "업종에 맞는 공간일수록 비싸서 방향이 반대(현재 비중 AUC 0.5 미만: " + ", ".join(rev) + "). 라벨로 비용 비중을 정하면 비싼 매물에 점수를 더 주게 되어 쓰지 않음", ["frlr"]])


STRUCTURE = {
    "fixed": [
        "인자 점수는 0~100",
        "그룹 점수 = 값이 있는 인자의 가중 평균",
        "총점 = 값이 있는 그룹의 가중 평균",
        "결측은 채우지 않고 같은 그룹 안에서 비중 재분배",
        "반영률 60 미만과 좌표 없는 매물은 추천 제외",
        "기준값은 대구 분포로 고정(절대평가). 예외: 임대료 부담+보증금(예산 안 후보), 면적 적합도(희망 면적)",
        "화면은 엔진 인자 점수를 읽고 예산·희망 면적·가중치만 다시 계산",
    ],
    "levels": [
        {"id": "A", "name": "인자 산출식만 바꿈", "ex": "구간값, 정규화 방식, 비교 기준(예: 가성비를 헤도닉 기대 월세 대비로)",
         "fixed": "골격 7개 모두 그대로", "change": "그 인자의 점수 열 하나, 엔진 함수 하나, config 기준값. 임대료 부담+보증금·면적처럼 화면에서 다시 계산하는 인자면 화면 계산식도",
         "size": "총점 변화 = 배점 × 인자 점수 변화 ÷ 100. 결측이 없으면 최대 배점만큼"},
        {"id": "B", "name": "그룹 구성을 바꿈", "ex": "인자 추가·삭제·합치기·이동, 그룹 안 비중 (예: 임대료 부담과 보증금을 환산 월 임대료 하나로 합침, 2026-11-17 적용)",
         "fixed": "골격 7개 그대로", "change": "인자 목록·세부 비중·배점표, 반영률 계산 대상, 결과 csv 열, 화면 상세 점수 목록, 평가 스냅샷 항목. 기준값 버전을 올림",
         "size": "그룹 하나를 통째로 빼는 시험이 상한에 가까움"},
        {"id": "C", "name": "골격 자체를 바꿈", "ex": "집계식(가중 평균 → 기하 평균), 상대평가 전환, 결측 대체, 점수 ↔ 필터 전환, 가중치를 good/bad로 학습, 반영률 기준",
         "fixed": "이 경우만 '전체 규칙'이 바뀜", "change": "엔진·화면·피드백 비교 기준 전부. 이전 평가와 점수를 직접 비교할 수 없음",
         "size": "모든 업종의 순위가 함께 바뀜"},
    ],
}

FACTOR_KEYS = ["임대료보증금", "가성비", "층", "면적적합도", "건물연식", "교통", "상권활성도", "배후수요", "용도일치도", "건물용도"]
FACTOR_LABEL = {"임대료보증금": "임대료 부담+보증금", "가성비": "가성비", "층": "층", "면적적합도": "면적 적합도", "건물연식": "건물 연식",
                "교통": "교통", "상권활성도": "상권 활성도", "배후수요": "배후 수요", "용도일치도": "용도 일치도", "건물용도": "건물 용도"}
FACTOR_GROUP = {"임대료보증금": "비용", "가성비": "비용", "층": "공간", "면적적합도": "공간", "건물연식": "공간",
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
    add_estimation(EVIDENCE)
    c1, c2 = jload("점수_v1_config.json"), jload("점수_v2_config.json")
    apply_space(EVIDENCE, c2)
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
        "built": "2026-11-25 (공간 인자 보완 적용)",
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
        "same_cfg": {"breakpoints": all(c1["breakpoints"][k] == c2["breakpoints"][k] for k in ("가성비", "지하철", "버스")), "use_score": c1["use_score"] == c2["use_score"],
                     "groups": c1["groups"] == c2["groups"], "factors": c1["factors"] == c2["factors"], "min_coverage": c1["min_coverage"] == c2["min_coverage"],
                     "factors_noncost": all(c1["factors"][g] == c2["factors"][g] for g in c2["groups"] if g != "비용"),
                     "weights": all(c1["preset"][c]["g"] == c2["preset"][c]["g"] and c1["preset"][c]["subway"] == c2["preset"][c]["subway"]
                                    and all(c1["preset"][c]["s"][g] == c2["preset"][c]["s"][g] for g in c2["groups"] if g not in ("비용", "공간")) for c in CATS),
                     "space_weight": {c: [c2["space_weight_before"][c], c2["preset"][c]["s"]["공간"]] for c in CATS}},
        "cost": {"rule": c2["cost_rule"], "pool": c2["cost_pool"], "sens_cond": sens["조건"],
                 "s1": {c: c1["preset"][c]["s"]["비용"] for c in CATS}, "s2": {c: c2["preset"][c]["s"]["비용"] for c in CATS}},
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
