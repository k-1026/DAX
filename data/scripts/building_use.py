"""매물 좌표 → 필지(PNU) → 건축물대장(표제부·층별개요) → 업종별 건물 용도 적합성.

정확도 원칙
  1) 좌표가 들어 있는 필지(연속지적도, 브이월드 2D 데이터 API)를 먼저 쓰고, 그 필지에 건축물대장이 있으면 '점포함' 매칭.
  2) 없으면(도로 위 좌표, 부속지번 등) 반경 30m 안 필지 중 가장 가까우면서 건축물대장이 있는 필지를 쓰고 '근사' 표시.
  3) 매물 CSV의 사용승인일·전체층·건물명을 건축물대장과 대조해 매칭이 맞는지 검증.
  4) 매물 층과 같은 층의 층별개요 용도로 판정. 층을 못 찾으면 건물 주용도로 판정하고 표시.

저장 정책: 브이월드 결과는 이용조건(저장 허용 여부) 확인 전이라 필지 도형을 저장하지 않고 PNU·지번 문자열만 캐시.
건축물대장(공공데이터포털, 이용허락범위 제한 없음) 응답은 원본 그대로 캐시.

키: data/.env 의 VWORLD_API_KEY, VWORLD_DOMAIN, BLD_API_KEY
실행: py -I data/scripts/building_use.py           (캐시가 있으면 API를 다시 부르지 않음)
"""
import csv
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DATA = os.path.join(ROOT, "data")
LISTING_CSV = os.path.join(DATA, "07.대구_매물유형별_csv", "대구_구역별_매물 (최종).csv")
PNU_CACHE = os.path.join(DATA, "08.외부데이터", "04_필지매칭", "pnu_cache.json")
BLD_DIR = os.path.join(DATA, "08.외부데이터", "05_건축물대장")
OUT = os.path.join(DATA, "09.스코어링")
VERSION = "v1"
WORKERS = 3
BLD_MIN_INTERVAL = 0.15  # 공공데이터포털 요청 간 최소 간격(초). 6병렬·무간격에서 HTTP 429가 대량 발생했음.
NEAR_M = 30

LAT0 = 35.87
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 110574.0

CATEGORIES = ["식음료", "소매", "뷰티", "공연문화", "사무업무", "교육", "의료", "운동시설"]


# ------------------------------------------------------------------ 환경·HTTP
def load_env():
    env = {}
    with open(os.path.join(DATA, ".env"), encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("VWORLD_API_KEY", "VWORLD_DOMAIN", "BLD_API_KEY"):
        if not env.get(k):
            raise SystemExit("data/.env 에 %s 가 없습니다" % k)
    env["BLD_API_KEY"] = urllib.parse.unquote(env["BLD_API_KEY"])
    return env


ENV = None
SECRETS = []


def scrub(s):
    for x in SECRETS:
        if x:
            s = s.replace(x, "***")
    return s


_rate_lock = threading.Lock()
_last_call = [0.0]


def _throttle():
    with _rate_lock:
        wait = _last_call[0] + BLD_MIN_INTERVAL - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()


def http_json(url, params, tries=7):
    q = urllib.parse.urlencode(params)
    last = None
    for i in range(tries):
        if "apis.data.go.kr" in url:
            _throttle()
        try:
            req = urllib.request.Request(url + "?" + q, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8", "replace")
            return json.loads(body)
        except urllib.error.HTTPError as e:
            last = e
            time.sleep((8 if e.code == 429 else 2) * (i + 1))  # 429는 길게 기다림
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(scrub(repr(last)))


# ------------------------------------------------------------------ 브이월드 연속지적도
def vworld(geom_filter, geometry):
    j = http_json("https://api.vworld.kr/req/data", {
        "service": "data", "request": "GetFeature", "data": "LP_PA_CBND_BUBUN",
        "key": ENV["VWORLD_API_KEY"], "domain": ENV["VWORLD_DOMAIN"], "geomFilter": geom_filter,
        "geometry": "true" if geometry else "false", "attribute": "true", "format": "json",
        "crs": "EPSG:4326", "size": "1000"})
    resp = j.get("response", {})
    if resp.get("status") == "NOT_FOUND":
        return []
    if resp.get("status") != "OK":
        raise RuntimeError("vworld status %s %s" % (resp.get("status"), scrub(json.dumps(resp.get("error", ""), ensure_ascii=False))))
    return resp["result"]["featureCollection"]["features"]


def jimok(jibun):
    m = re.search(r"([가-힣]+)$", jibun or "")
    return m.group(1) if m else ""


def dist_point_to_geom(lon, lat, geom):
    px, py = lon * MX, lat * MY
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    best = float("inf")
    for poly in polys:
        outer = poly[0]
        inside = False
        j = len(outer) - 1
        for i in range(len(outer)):
            xi, yi = outer[i][0], outer[i][1]
            xj, yj = outer[j][0], outer[j][1]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        if inside:
            return 0.0
        for ring in poly:
            for a, b in zip(ring, ring[1:]):
                ax, ay, bx, by = a[0] * MX, a[1] * MY, b[0] * MX, b[1] * MY
                dx, dy = bx - ax, by - ay
                t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
                best = min(best, math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
    return best


# ------------------------------------------------------------------ 건축물대장
def bld_params(pnu, page=1):
    return {"serviceKey": ENV["BLD_API_KEY"], "sigunguCd": pnu[0:5], "bjdongCd": pnu[5:10],
            "platGbCd": "0" if pnu[10] == "1" else "1", "bun": pnu[11:15], "ji": pnu[15:19],
            "numOfRows": "100", "pageNo": str(page), "_type": "json"}


def bld_items(op, pnu):
    out, page = [], 1
    while True:
        j = http_json("https://apis.data.go.kr/1613000/BldRgstHubService/" + op, bld_params(pnu, page))
        hdr = j.get("response", {}).get("header", {})
        if hdr.get("resultCode") not in ("00", "000"):
            raise RuntimeError("%s %s %s" % (op, hdr.get("resultCode"), hdr.get("resultMsg")))
        body = j["response"]["body"]
        items = body.get("items") or {}
        it = items.get("item", []) if isinstance(items, dict) else []
        if isinstance(it, dict):
            it = [it]
        out.extend(it)
        total = int(body.get("totalCount") or 0)
        if page * 100 >= total:
            return out
        page += 1


def building_record(pnu):
    path = os.path.join(BLD_DIR, pnu + ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    rec = {"pnu": pnu, "title": bld_items("getBrTitleInfo", pnu), "floors": [], "fetched": time.strftime("%Y-%m-%d")}
    if rec["title"]:
        rec["floors"] = bld_items("getBrFlrOulnInfo", pnu)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False)
    return rec


# ------------------------------------------------------------------ 업종별 용도 적합성
# 용도 대분류: 건축물대장 mainPurpsCd 앞 2자리 (예: 03 제1종근린생활시설, 04 제2종근린생활시설)
# 등급: A=100 등록 용도 그대로 가능 / B=80 같은 근린생활시설군 안에서 기재내용 변경 수준이거나 업종 일부만 가능
#       C=40 다른 시설군 → 용도변경(신고·허가) 필요 / D=30 주거용도(단독·공동주택) → 용도변경 부담 큼
# 면적 기준(건축법 시행령 별표1)은 '같은 건축물에서 해당 용도로 쓰는 바닥면적 합계' 기준인데, 여기서는 매물 전용면적으로 근사.
GRADE_SCORE = {"A": 100, "B": 80, "C": 40, "D": 30}
GROUP_NAME = {"01": "단독주택", "02": "공동주택", "03": "제1종근린생활시설", "04": "제2종근린생활시설", "05": "문화및집회시설",
              "06": "종교시설", "07": "판매시설", "09": "의료시설", "10": "교육연구시설", "11": "노유자시설", "13": "운동시설",
              "14": "업무시설", "15": "숙박시설", "16": "위락시설", "17": "공장", "18": "창고시설"}


def judge(cat, grp, area, name=""):
    """grp: 용도 대분류 코드 2자리, area: 매물 전용면적(㎡), name: 해당 층(또는 건물) 용도 명칭. (등급, 사유) 반환."""
    a = area or 0
    if grp in ("01", "02") and any(w in name for w in WELFARE):
        return "B", "공동주택 단지 내 상가(복리·부대시설): 근린생활시설 범위 업종 가능, 단지 관리규약 확인 필요"
    if grp in ("01", "02"):
        return "D", "주거용도(%s) → 근린생활시설 등으로 용도변경 필요" % GROUP_NAME[grp]
    if cat == "식음료":
        if grp == "04":
            return "A", "제2종근생: 일반음식점 가능"
        if grp == "16":
            return "A", "위락시설: 주점류 가능"
        if grp == "03":
            return ("B", "제1종근생: 휴게음식점·제과점(300㎡ 미만)만 가능, 일반음식점은 제2종으로 변경 필요") if a < 300 else ("B", "제1종근생: 300㎡ 이상은 제2종으로 기재변경 필요")
    elif cat == "소매":
        if grp == "03":
            return ("A", "제1종근생: 소매점(1,000㎡ 미만) 가능") if a < 1000 else ("C", "1,000㎡ 이상 소매는 판매시설 필요")
        if grp == "07":
            return "A", "판매시설: 소매 가능"
        if grp == "04":
            return "B", "제2종근생: 소매점은 제1종이라 같은 근린생활시설군 안에서 기재변경"
    elif cat == "뷰티":
        if grp == "03":
            return "A", "제1종근생: 미용원 가능"
        if grp == "04":
            return "B", "제2종근생: 미용원은 제1종이라 같은 시설군 안에서 기재변경"
    elif cat == "의료":
        if grp == "03":
            return "A", "제1종근생: 의원·치과의원·한의원 가능"
        if grp == "09":
            return "A", "의료시설: 병원 가능"
        if grp == "04":
            return "B", "제2종근생: 의원은 제1종이라 같은 시설군 안에서 기재변경"
    elif cat == "교육":
        if grp == "04":
            return ("A", "제2종근생: 학원(500㎡ 미만) 가능") if a < 500 else ("C", "500㎡ 이상 학원은 교육연구시설 필요")
        if grp == "10":
            return "A", "교육연구시설: 학원 가능"
        if grp == "03":
            return "B", "제1종근생: 학원은 제2종이라 같은 시설군 안에서 기재변경"
    elif cat == "운동시설":
        if grp == "04":
            return ("A", "제2종근생: 체력단련장 등(500㎡ 미만) 가능") if a < 500 else ("C", "500㎡ 이상은 운동시설 필요")
        if grp == "13":
            return "A", "운동시설 가능"
        if grp == "03":
            return ("B", "제1종근생: 체육도장·탁구장(500㎡ 미만)만 가능, 헬스장은 제2종으로 기재변경") if a < 500 else ("C", "500㎡ 이상은 운동시설 필요")
    elif cat == "사무업무":
        if grp == "14":
            return "A", "업무시설: 사무소 가능"
        if grp == "04":
            return ("A", "제2종근생: 사무소(500㎡ 미만) 가능") if a < 500 else ("C", "500㎡ 이상 사무소는 업무시설 필요")
        if grp == "03":
            return ("A", "제1종근생: 사무소(30㎡ 미만) 가능") if a < 30 else ("B", "제1종근생: 30㎡ 이상 사무소는 제2종으로 기재변경")
    elif cat == "공연문화":
        if grp == "05":
            return "A", "문화및집회시설: 공연장·전시장 가능"
        if grp == "04":
            return ("A", "제2종근생: 공연장(500㎡ 미만)·사진관 등 가능") if a < 500 else ("C", "500㎡ 이상 공연장은 문화및집회시설 필요")
        if grp == "03":
            return "B", "제1종근생: 공연장은 제2종이라 같은 시설군 안에서 기재변경"
    name = GROUP_NAME.get(grp, "용도코드 " + grp)
    return "C", "%s → 다른 시설군이라 용도변경 필요" % name


# ------------------------------------------------------------------ 매물 층 ↔ 층별개요
def parse_floor(s):
    s = (s or "").replace(" ", "")
    m = re.match(r"^지하(\d+)층$", s)
    if m:
        return "지하", int(m.group(1))
    m = re.match(r"^(\d+)층$", s)
    if m:
        return "지상", int(m.group(1))
    return None


def norm_name(s):
    return re.sub(r"[\s()\-·.,]", "", (s or "")).lower()


APR_TOL_DAYS = 62  # 네이버 매물 사용승인일은 대장과 하루~두 달 차이 나거나 연월(YYYYMM)만 있는 경우가 있음


def apr_cmp(csv_apr, bld_apr):
    """매물 사용승인일 vs 대장 사용승인일 → 일치 / 근접일치 / 불일치 / 비교불가."""
    a = re.sub(r"\D", "", csv_apr or "")
    b = re.sub(r"\D", "", str(bld_apr or ""))
    if len(b) != 8 or len(a) not in (6, 8):
        return "비교불가"
    if a == b:
        return "일치"
    if len(a) == 6:
        return "근접일치" if a == b[:6] else "불일치"
    from datetime import date
    try:
        da = date(int(a[:4]), int(a[4:6]), int(a[6:]))
        db = date(int(b[:4]), int(b[4:6]), int(b[6:]))
    except ValueError:
        return "비교불가"
    return "근접일치" if abs((da - db).days) <= APR_TOL_DAYS else "불일치"


def verify(t, L):
    """건축물대장 건물 t가 매물 L의 건물이 맞는지 세 가지로 대조. (상태 dict, 점수)."""
    st = {"사용승인일": apr_cmp(L["사용승인일"], t.get("useAprDay"))}
    tf = re.sub(r"\D", "", L["전체층"])
    st["층수"] = "비교불가" if not tf or t.get("grndFlrCnt") in (None, "") else ("일치" if str(t.get("grndFlrCnt")) == tf else "불일치")
    nm, bn = norm_name(L["건물명"]), norm_name(t.get("bldNm"))
    st["건물명"] = "비교불가" if not nm or not bn else ("일치" if nm in bn or bn in nm else "불일치")
    sc = {"일치": 2, "근접일치": 2, "불일치": -2, "비교불가": 0}[st["사용승인일"]]
    sc += {"일치": 1, "불일치": -1, "비교불가": 0}[st["층수"]]
    sc += {"일치": 2, "불일치": -1, "비교불가": 0}[st["건물명"]]
    return st, sc


def choose_building(titles, L):
    """한 필지에 건물(동)이 여러 개면 사용승인일 → 전체층 → 건물명 일치로 고른다."""
    mains = [t for t in titles if str(t.get("mainAtchGbCd", "0")) == "0"] or titles
    if len(mains) == 1:
        return mains[0], "단일건물"
    c = [t for t in mains if apr_cmp(L["사용승인일"], t.get("useAprDay")) in ("일치", "근접일치")]
    if len(c) == 1:
        return c[0], "사용승인일로선택"
    pool = c or mains
    c2 = [t for t in pool if str(t.get("grndFlrCnt")) == re.sub(r"\D", "", L["전체층"])]
    if len(c2) == 1:
        return c2[0], "층수로선택"
    pool = c2 or pool
    nm = norm_name(L["건물명"])
    c3 = [t for t in pool if nm and nm in norm_name(t.get("bldNm")) + norm_name(t.get("dongNm"))]
    if len(c3) == 1:
        return c3[0], "건물명으로선택"
    pool = c3 or pool
    # 매물은 모두 상가이므로, 아파트 단지처럼 주거동과 상가동이 섞여 있으면 주거동(01·02)을 뒤로 미룬다.
    nonres = [t for t in pool if not is_residential(t)]
    if nonres and len(nonres) < len(pool):
        return max(nonres, key=lambda t: float(t.get("totArea") or 0)), "복수건물_비주거동선택"
    return max(pool, key=lambda t: float(t.get("totArea") or 0)), "복수건물_연면적최대선택"


WELFARE = ("생활편익시설", "부대시설", "복리시설", "근린생활시설", "상가", "판매시설")


def is_residential(x):
    """용도코드 01(단독주택)·02(공동주택)이면서, 단지 내 상가(복리·부대·생활편익시설)가 아닌 경우."""
    code = str(x.get("mainPurpsCd", ""))[:2]
    name = (x.get("mainPurpsCdNm") or "") + " " + (x.get("etcPurps") or "")
    return code in ("01", "02") and not any(w in name for w in WELFARE)


def pick_floor(floors, title, fl, area):
    if not fl:
        return None, "층정보없음"
    gb, no = fl
    pk = title.get("mgmBldrgstPk")
    cand = [x for x in floors if x.get("flrGbCdNm") == gb and int(x.get("flrNo") or -1) == no
            and str(x.get("mainAtchGbCd", "0")) == "0"]
    same = [x for x in cand if x.get("mgmBldrgstPk") == pk]
    cand = same or cand
    if not cand:
        return None, "해당층없음"
    nonres = [x for x in cand if not is_residential(x)]
    cand = nonres or cand  # 같은 층에 주택과 상가가 함께 있으면 상가 쪽
    if len(cand) == 1:
        return cand[0], "해당층"
    groups = {str(x.get("mainPurpsCd", ""))[:2] for x in cand}
    best = min(cand, key=lambda x: abs(float(x.get("area") or 0) - (area or 0)))
    return best, ("해당층_용도여러개_같은분류" if len(groups) == 1 else "해당층_용도여러개_면적근접선택")


# ------------------------------------------------------------------ main
def main():
    global ENV, SECRETS
    sys.stdout.reconfigure(encoding="utf-8")
    ENV = load_env()
    SECRETS = [ENV["VWORLD_API_KEY"], ENV["BLD_API_KEY"], urllib.parse.quote(ENV["BLD_API_KEY"], safe="")]
    os.makedirs(os.path.dirname(PNU_CACHE), exist_ok=True)
    os.makedirs(BLD_DIR, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    with open(LISTING_CSV, encoding="utf-8-sig", newline="") as f:
        listings = list(csv.DictReader(f))
    if len(sys.argv) > 1:  # 시험 실행: 앞 N건만
        listings = listings[:int(sys.argv[1])]
    cache = {}
    if os.path.exists(PNU_CACHE):
        with open(PNU_CACHE, encoding="utf-8") as f:
            cache = json.load(f)
    lock = threading.Lock()
    errors = []

    def save_cache():
        with lock:
            tmp = PNU_CACHE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False)
            os.replace(tmp, PNU_CACHE)

    # 1단계: 좌표가 들어 있는 필지
    todo = [L for L in listings if L["경도"] and L["매물번호"] not in cache]

    def step1(L):
        try:
            feats = vworld("POINT(%s %s)" % (L["경도"], L["위도"]), geometry=False)
            p = feats[0]["properties"] if feats else None
            with lock:
                cache[L["매물번호"]] = {"point_pnu": p["pnu"] if p else "", "point_jibun": p.get("jibun", "") if p else ""}
        except Exception as e:
            errors.append(("vworld_point", L["매물번호"], scrub(str(e))))

    run_parallel(step1, todo, "필지(점)")
    save_cache()

    # 2단계: 점 필지의 건축물대장
    pnus = sorted({c["point_pnu"] for c in cache.values() if c.get("point_pnu")})
    recs = {}

    def step2(pnu):
        try:
            recs[pnu] = building_record(pnu)
        except Exception as e:
            errors.append(("bld", pnu, scrub(str(e))))

    run_parallel(step2, pnus, "건축물대장(점)")

    # 3단계: 점 필지에 건물이 없으면 반경 30m 안 가장 가까운 '건물 있는' 필지
    need = [L for L in listings if L["경도"] and L["매물번호"] in cache and "final_pnu" not in cache[L["매물번호"]]]

    def step3(L):
        c = cache[L["매물번호"]]
        p0 = c.get("point_pnu")
        if p0 and p0 not in recs:
            # 점 필지 조회가 실패했던 경우: '건물 없음'으로 오인해 옆 필지로 근사 매칭하지 않도록 먼저 다시 조회.
            try:
                recs[p0] = building_record(p0)
            except Exception as e:
                errors.append(("bld_retry", p0, scrub(str(e))))
                return  # final_pnu를 남기지 않음 → 다음 실행에서 다시 시도
        if p0 and recs.get(p0, {}).get("title"):
            c.update(final_pnu=p0, method="점포함", dist_m=0)
            return
        try:
            lon, lat = float(L["경도"]), float(L["위도"])
            dx, dy = NEAR_M / MX, NEAR_M / MY
            feats = vworld("BOX(%f,%f,%f,%f)" % (lon - dx, lat - dy, lon + dx, lat + dy), geometry=True)
            cands = sorted(((dist_point_to_geom(lon, lat, f["geometry"]), f["properties"]["pnu"]) for f in feats
                            if f["properties"].get("pnu") != p0), key=lambda t: t[0])
            for d, pnu in cands:
                if d > NEAR_M:
                    break
                r = recs.get(pnu) or building_record(pnu)
                recs[pnu] = r
                if r.get("title"):
                    c.update(final_pnu=pnu, method="근사", dist_m=round(d, 1))
                    return
            c.update(final_pnu="", method="건물없음", dist_m=None)
        except Exception as e:
            errors.append(("near", L["매물번호"], scrub(str(e))))

    run_parallel(step3, need, "근접필지")
    save_cache()
    for pnu in {c.get("final_pnu") for c in cache.values() if c.get("final_pnu")} - set(recs):
        recs[pnu] = building_record(pnu)

    # 3-2단계: 검증 보정. 고른 건물이 사용승인일·층수 둘 다 틀리면, 좌표가 옆 필지에 찍힌 것으로 보고
    # 반경 30m 안 이웃 필지의 건물 중 검증 점수가 가장 높은 건물로 바꾼다(사용승인일이 맞는 경우만).
    by_no = {L["매물번호"]: L for L in listings}

    def wrong(c, L):
        rec = recs.get(c.get("final_pnu"))
        if not rec or not rec.get("title"):
            return False
        t, _ = choose_building(rec["title"], L)
        st, _ = verify(t, L)
        return st["사용승인일"] == "불일치" and st["층수"] == "불일치"

    fix = [by_no[k] for k, c in cache.items() if k in by_no and c.get("final_pnu") and not c.get("verify_checked") and wrong(c, by_no[k])]

    def step3b(L):
        c = cache[L["매물번호"]]
        try:
            t0, _ = choose_building(recs[c["final_pnu"]]["title"], L)
            _, best_sc = verify(t0, L)
            lon, lat = float(L["경도"]), float(L["위도"])
            dx, dy = NEAR_M / MX, NEAR_M / MY
            feats = vworld("BOX(%f,%f,%f,%f)" % (lon - dx, lat - dy, lon + dx, lat + dy), geometry=True)
            best = None
            for f in feats:
                pnu = f["properties"].get("pnu")
                if not pnu or pnu == c["final_pnu"]:
                    continue
                d = dist_point_to_geom(lon, lat, f["geometry"])
                if d > NEAR_M:
                    continue
                r = recs.get(pnu) or building_record(pnu)
                recs[pnu] = r
                for t in r.get("title", []):
                    st, sc = verify(t, L)
                    if st["사용승인일"] in ("일치", "근접일치") and sc > best_sc and (best is None or sc > best[0] or (sc == best[0] and d < best[2])):
                        best = (sc, pnu, d)
            if best:
                c.update(final_pnu=best[1], method="검증보정", dist_m=round(best[2], 1), from_pnu=c["final_pnu"])
            c["verify_checked"] = True
        except Exception as e:
            errors.append(("verify_fix", L["매물번호"], scrub(str(e))))

    run_parallel(step3b, fix, "검증보정")
    save_cache()

    # 4단계: 검증과 판정
    rows = []
    stat = {}

    def bump(k):
        stat[k] = stat.get(k, 0) + 1

    for L in listings:
        r = {"매물번호": L["매물번호"], "구": L["구"], "법정동": L["법정동"], "층": L["층"], "전용면적": L["전용면적"]}
        c = cache.get(L["매물번호"], {})
        r["매칭방법"] = c.get("method", "좌표없음" if not L["경도"] else "오류")
        r["근사거리_m"] = c.get("dist_m", "")
        r["점필지_지번"] = c.get("point_jibun", "")
        r["점필지_지목"] = jimok(c.get("point_jibun", ""))
        pnu = c.get("final_pnu", "")
        r["PNU"] = pnu
        bump("매칭_" + r["매칭방법"])
        rec = recs.get(pnu) if pnu else None
        if not rec or not rec.get("title"):
            rows.append(r)
            continue
        t, how = choose_building(rec["title"], L)
        bump("건물선택_" + how)
        r["건물선택"] = how
        r["대장_건물명"] = (t.get("bldNm") or "").strip()
        r["대장_대지위치"] = t.get("platPlc", "")
        r["대장_주용도"] = t.get("mainPurpsCdNm", "")
        r["대장_지상층수"] = t.get("grndFlrCnt", "")
        r["대장_사용승인일"] = str(t.get("useAprDay", "")).strip()
        st, _ = verify(t, L)
        r["검증_사용승인일"], r["검증_층수"], r["검증_건물명"] = st["사용승인일"], st["층수"], st["건물명"]
        for k in ("검증_사용승인일", "검증_층수", "검증_건물명"):
            bump(k + "_" + r[k])
        ok = sum(r[k] in ("일치", "근접일치") for k in ("검증_사용승인일", "검증_층수", "검증_건물명"))
        bad = sum(r[k] == "불일치" for k in ("검증_사용승인일", "검증_층수", "검증_건물명"))
        r["매칭신뢰도"] = "높음" if ok >= 1 and bad == 0 else ("확인필요" if bad >= 1 and ok == 0 else "보통")
        bump("신뢰도_" + r["매칭신뢰도"])

        area = float(L["전용면적"] or 0)
        fx, fhow = pick_floor(rec["floors"], t, parse_floor(L["층"]), area)
        src = fx or t
        uname = (src.get("mainPurpsCdNm") or "") + " " + (src.get("etcPurps") or "")
        if fx:
            code = str(fx.get("mainPurpsCd", ""))
            r["판정기준"] = fhow
            r["해당층_용도"] = fx.get("mainPurpsCdNm", "")
            r["해당층_기타용도"] = (fx.get("etcPurps") or "").strip()
        else:
            code = str(t.get("mainPurpsCd", ""))
            r["판정기준"] = "건물주용도(" + fhow + ")"
            r["해당층_용도"] = ""
            r["해당층_기타용도"] = ""
        bump("판정기준_" + r["판정기준"].split("(")[0])
        grp = code[:2]
        r["용도대분류코드"] = grp
        r["용도대분류"] = GROUP_NAME.get(grp, "")
        for cat in CATEGORIES:
            g, why = judge(cat, grp, area, uname)
            r["용도적합_" + cat] = GRADE_SCORE[g]
            r["등급_" + cat] = g
            r["사유_" + cat] = why
        rows.append(r)

    fields = []
    for r in rows:
        for k in r:
            if k not in fields:
                fields.append(k)
    with open(os.path.join(OUT, "건물용도_%s.csv" % VERSION), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    grp_names = {}
    for rec in recs.values():
        for x in rec.get("floors", []) + rec.get("title", []):
            cd = str(x.get("mainPurpsCd", ""))[:2]
            grp_names.setdefault(cd, set()).add(x.get("mainPurpsCdNm", ""))
    meta = {"version": VERSION, "매물수": len(listings), "통계": dict(sorted(stat.items())),
            "오류수": len(errors), "오류예시": errors[:10], "근사매칭_최대거리_m": NEAR_M,
            "용도대분류코드_관측명칭": {k: sorted(v)[:12] for k, v in sorted(grp_names.items())},
            "출처": {"필지": "브이월드 2D 데이터 API LP_PA_CBND_BUBUN (도형 미저장, PNU만 캐시)",
                    "건축물대장": "국토교통부 건축HUB 건축물대장정보 서비스 (표제부, 층별개요)"},
            "주의": "용도 적합성은 건축법 시행령 별표1 기준 단순화 판정. 면적 기준은 매물 전용면적으로 근사. 실제 입점 가능 여부는 관할 구청 건축과 확인 필요."}
    with open(os.path.join(OUT, "건물용도_%s_meta.json" % VERSION), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in meta.items() if k != "용도대분류코드_관측명칭"}, ensure_ascii=False, indent=1))


def run_parallel(fn, items, label):
    if not items:
        print("[%s] 새로 부를 것 없음 (캐시)" % label, flush=True)
        return
    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(WORKERS) as ex:
        for _ in ex.map(fn, items):
            done += 1
            if done % 200 == 0 or done == len(items):
                print("[%s] %d/%d  %.0fs" % (label, done, len(items), time.time() - t0), flush=True)


if __name__ == "__main__":
    sys.exit(main())
