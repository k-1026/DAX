"""외부 데이터 기반 스코어링 인자 계산 (상권 활성도, 배후 수요, 주변 동종 상가 수).

입력 (모두 무료·공공):
  - 기본 매물:  data/07.대구_매물유형별_csv/대구_구역별_매물 (최종).csv
  - 행정동 경계: data/08.외부데이터/02_행정동경계/HangJeongDong_ver20261001.geojson  (vuski/admdongkor, CC BY 4.0, 원자료 SGIS)
  - 주민등록 인구: data/08.외부데이터/03_주민등록인구/지역별(행정동)_성별_연령별_주민등록_인구수_20261031.csv (행정안전부, cp949)
  - 상가(상권)정보: data/08.외부데이터/01_상가정보/대구 CSV (소상공인시장진흥공단, 2026-09-30 기준)

출력:
  - data/09.스코어링/외부인자_v1.csv     매물별 행정동, 상권 활성도, 배후 수요, 업종별 주변 동종 상가 수
  - data/09.스코어링/행정동_배후수요_v1.csv 행정동별 인구 지표와 백분위
  - data/09.스코어링/외부인자_v1_meta.json 버전, 출처, 기준값, 매칭률

실행:  py -I data/scripts/external_factors.py   (표준 라이브러리만 사용)
"""
import csv
import glob
import json
import math
import os
import re
import sys
from bisect import bisect_left, bisect_right

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DATA = os.path.join(ROOT, "data")
EXT = os.path.join(DATA, "08.외부데이터")
OUT = os.path.join(DATA, "09.스코어링")
VERSION = "v1"

LISTING_CSV = os.path.join(DATA, "07.대구_매물유형별_csv", "대구_구역별_매물 (최종).csv")
BOUNDARY = os.path.join(EXT, "02_행정동경계", "HangJeongDong_ver20261001.geojson")
POP_CSV = os.path.join(EXT, "03_주민등록인구", "지역별(행정동)_성별_연령별_주민등록_인구수_20261031.csv")
STORE_DIR = os.path.join(EXT, "01_상가정보")

DAEGU_SIDO = "27"
LAT0 = 35.87  # 대구 기준 위도 (거리·면적 근사용)
M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))

CATEGORIES = ["식음료", "소매", "뷰티", "공연문화", "사무업무", "교육", "의료", "운동시설"]
# 업종별 기본 반경(m): 주변 동종 상가 정보, 상권 활성도 계산에 사용 (가설, 사용자 반경 변경 패턴과 피드백으로 조정)
RADIUS = {"식음료": 300, "소매": 300, "뷰티": 300, "공연문화": 300, "의료": 300,
          "교육": 500, "사무업무": 500, "운동시설": 500}
RADII = sorted(set(RADIUS.values()))

# 배후 수요 지표: 업종별로 쓰는 연령대 인구밀도(명/km²). 사무업무는 직장인구(SGIS) 확보 전까지 미산출.
DEMAND_SPEC = {
    "식음료": [("pop_20_59", 1.0)],
    "소매": [("pop_total", 1.0)],
    "뷰티": [("pop_20_49", 1.0)],
    "공연문화": [("pop_20_39", 1.0)],
    "교육": [("pop_6_18", 1.0)],
    "의료": [("pop_total", 0.5), ("pop_65p", 0.5)],
    "운동시설": [("pop_20_49", 1.0)],
    "사무업무": [],
}
AGE_BANDS = {"pop_6_18": (6, 18), "pop_20_39": (20, 39), "pop_20_49": (20, 49),
             "pop_20_59": (20, 59), "pop_65p": (65, 200)}

# ---- 집계구 방식 배후 수요 (v1.1) ----
# 반경 안 인구·종사자 수의 합 → 좌표 있는 대구 매물 중 백분위.
# 거주인구: 행정동 주민등록(2026-10, 정확한 연령)을 SGIS 집계구 10세 분포(2024) 비율로 동 안에 배분.
# 직장인구: SGIS 집계구 종사자 수(2024) 그대로.
OA_JSON = os.path.join(EXT, "06_SGIS", "집계구_대구_2024.json")
OA_SAMPLE_M = 50
DEMAND_SPEC_OA = {
    "식음료": [("pop_20_59", 0.5), ("workers", 0.5)],
    "소매": [("pop_total", 1.0)],
    "뷰티": [("pop_20_49", 1.0)],
    "공연문화": [("pop_20_39", 1.0)],
    "교육": [("pop_6_18", 1.0)],
    "의료": [("pop_total", 0.5), ("pop_65p", 0.5)],
    "운동시설": [("pop_20_49", 1.0)],
    "사무업무": [("workers", 1.0)],
}
# 집계구 10세 구간(c0=0~9세 … c9=90세 이상)으로 만든 배분 기준. 구간 경계가 안 맞는 부분은 비율로 근사.
OA_BASE = {
    "pop_total": lambda c: sum(c),
    "pop_6_18": lambda c: 0.4 * c[0] + 0.9 * c[1],
    "pop_20_39": lambda c: c[2] + c[3],
    "pop_20_49": lambda c: c[2] + c[3] + c[4],
    "pop_20_59": lambda c: c[2] + c[3] + c[4] + c[5],
    "pop_65p": lambda c: 0.5 * c[6] + c[7] + c[8] + c[9],
}
OA_KEYS = list(OA_BASE) + ["workers"]


def build_oa_points(pops):
    """집계구 경계 안에 OA_SAMPLE_M 간격 표본점을 찍고, 집계구 값을 점들에 나눠 담는다.
    반환: 점 목록 [(lon, lat, oa_index)], 집계구별 값 [{key: 값/점수}], 통계."""
    with open(OA_JSON, encoding="utf-8") as f:
        areas = json.load(f)["areas"]
    bands = [[(v or 0.0) for v in a["bands"]] for a in areas]
    # 동별 배분 기준 합
    base_sum = {}
    for a, c in zip(areas, bands):
        for k, fn in OA_BASE.items():
            base_sum[(a["dong10"], k)] = base_sum.get((a["dong10"], k), 0.0) + fn(c)
    n_in_dong = {}
    for a in areas:
        n_in_dong[a["dong10"]] = n_in_dong.get(a["dong10"], 0) + 1
    vals = []
    miss_pop = set()
    for a, c in zip(areas, bands):
        p = pops.get(a["dong10"])
        v = {"workers": a["workers"] or 0.0}
        for k, fn in OA_BASE.items():
            if not p:
                miss_pop.add(a["dong10"])
                v[k] = 0.0
                continue
            s = base_sum[(a["dong10"], k)]
            v[k] = p[k] * (fn(c) / s if s > 0 else 1.0 / n_in_dong[a["dong10"]])
        vals.append(v)
    alloc_pop = sum(v["pop_total"] for v in vals)
    alloc_workers = sum(v["workers"] for v in vals)
    pts = []
    dx, dy = OA_SAMPLE_M / M_PER_DEG_LON, OA_SAMPLE_M / M_PER_DEG_LAT
    for i, a in enumerate(areas):
        mine = []
        for ring in a["rings"]:
            xs = [q[0] for q in ring]
            ys = [q[1] for q in ring]
            x = min(xs) + dx / 2
            while x < max(xs):
                y = min(ys) + dy / 2
                while y < max(ys):
                    if point_in_ring(x, y, ring):
                        mine.append((x, y, i))
                    y += dy
                x += dx
        if not mine:  # 아주 작은 집계구: 꼭짓점 평균(중심 근사) 한 점
            ring = a["rings"][0]
            mine = [(sum(q[0] for q in ring) / len(ring), sum(q[1] for q in ring) / len(ring), i)]
        for k in vals[i]:
            vals[i][k] /= len(mine)
        pts.extend(mine)
    stat = {"집계구수": len(areas), "표본점수": len(pts), "주민등록_미연결_행정동": sorted(miss_pop),
            "배분된_종사자합": round(alloc_workers), "배분된_거주인구합": round(alloc_pop),
            "주민등록_대구_인구합": sum(p["pop_total"] for p in pops.values())}
    return pts, vals, stat


# ---------------------------------------------------------------- 기하 유틸
def xy(lon, lat):
    return lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT


def ring_area_m2(ring):
    pts = [xy(p[0], p[1]) for p in ring]
    s = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def polygons_of(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def point_in_geom(lon, lat, polys):
    for poly in polys:
        if point_in_ring(lon, lat, poly[0]) and not any(point_in_ring(lon, lat, h) for h in poly[1:]):
            return True
    return False


def percentile_rank(sorted_vals, v):
    """0~100. 같은 값은 중간 순위."""
    n = len(sorted_vals)
    if n == 0 or v is None:
        return None
    lo, hi = bisect_left(sorted_vals, v), bisect_right(sorted_vals, v)
    return round(100.0 * (lo + hi) / 2.0 / n, 1)


# ---------------------------------------------------------------- 1. 행정동
def load_dongs():
    with open(BOUNDARY, encoding="utf-8") as f:
        gj = json.load(f)
    dongs = []
    for ft in gj["features"]:
        p = ft["properties"]
        if p.get("sido") != DAEGU_SIDO:
            continue
        polys = polygons_of(ft["geometry"])
        xs = [pt[0] for poly in polys for pt in poly[0]]
        ys = [pt[1] for poly in polys for pt in poly[0]]
        area = sum(ring_area_m2(poly[0]) - sum(ring_area_m2(h) for h in poly[1:]) for poly in polys)
        dongs.append({"adm_cd2": p["adm_cd2"], "adm_nm": p["adm_nm"], "sggnm": p.get("sggnm", ""),
                      "polys": polys, "bbox": (min(xs), min(ys), max(xs), max(ys)), "area_km2": area / 1e6})
    return dongs


def find_dong(lon, lat, dongs):
    for d in dongs:
        x0, y0, x1, y1 = d["bbox"]
        if x0 <= lon <= x1 and y0 <= lat <= y1 and point_in_geom(lon, lat, d["polys"]):
            return d
    return None


# ---------------------------------------------------------------- 2. 인구
def load_population():
    pops = {}
    with open(POP_CSV, encoding="cp949", newline="") as f:
        rd = csv.reader(f)
        header = next(rd)
        age_cols = []
        for i, h in enumerate(header):
            m = re.match(r"^(\d+)세(이상)?\s*(남자|여자)$", h)
            if m:
                age_cols.append((i, int(m.group(1))))
        idx = {h: i for i, h in enumerate(header)}
        for row in rd:
            if row[idx["시도명"]] != "대구광역시" or not row[idx["읍면동명"]].strip():
                continue
            ages = {}
            for i, a in age_cols:
                ages[a] = ages.get(a, 0) + int(row[i] or 0)
            rec = {"pop_total": int(row[idx["계"]])}
            for k, (a0, a1) in AGE_BANDS.items():
                rec[k] = sum(v for a, v in ages.items() if a0 <= a <= a1)
            rec["name"] = row[idx["시군구명"]] + " " + row[idx["읍면동명"]]
            rec["sgg"], rec["emd"] = row[idx["시군구명"]], row[idx["읍면동명"]].strip()
            pops[row[idx["행정기관코드"]]] = rec
    # 출장소(예: 달성군 논공읍공단출장소, 다사읍서재출장소)는 주민등록에서 별도 행이지만 행정동 경계상 모읍에 포함 → 모읍에 합산
    for code in [c for c, r in pops.items() if r["emd"].endswith("출장소")]:
        r = pops.pop(code)
        m = re.match(r"^(.+?[읍면동])", r["emd"])
        parent = next((c for c, p in pops.items() if m and p["sgg"] == r["sgg"] and p["emd"] == m.group(1)), None)
        if parent:
            for k in ["pop_total"] + list(AGE_BANDS):
                pops[parent][k] += r[k]
            pops[parent].setdefault("merged", []).append(r["emd"])
    return pops


# ---------------------------------------------------------------- 3. 상가정보
def find_store_csv():
    cands = [p for p in glob.glob(os.path.join(STORE_DIR, "**", "*.csv"), recursive=True) if "대구" in os.path.basename(p)]
    return cands[0] if cands else None


def open_text(path):
    for enc in ("utf-8-sig", "cp949"):
        try:
            with open(path, encoding=enc) as f:
                f.read(200000)
            return open(path, encoding=enc, newline="")
        except UnicodeDecodeError:
            continue
    raise RuntimeError("인코딩 판별 실패: " + path)


BJD_TO_HJD = {}  # (시군구명, 법정동명) -> 상가정보에 나타난 행정동코드(8자리) 집합


def load_stores(path, classify):
    stores = []
    with open_text(path) as f:
        rd = csv.DictReader(f)
        cols = rd.fieldnames
        lon_c = next(c for c in cols if c.strip() == "경도")
        lat_c = next(c for c in cols if c.strip() == "위도")
        for r in rd:
            try:
                lon, lat = float(r[lon_c]), float(r[lat_c])
            except (TypeError, ValueError):
                continue
            stores.append((lon, lat, classify(r), r.get("행정동코드", "")[:8]))
            BJD_TO_HJD.setdefault((r.get("시군구명", ""), r.get("법정동명", "")), set()).add(r.get("행정동코드", "")[:8])
    return stores, cols


class Grid:
    def __init__(self, pts, cell_m=250.0):
        self.cx = cell_m / M_PER_DEG_LON
        self.cy = cell_m / M_PER_DEG_LAT
        self.cell_m = cell_m
        self.cells = {}
        for p in pts:
            self.cells.setdefault((int(p[0] // self.cx), int(p[1] // self.cy)), []).append(p)

    def within(self, lon, lat, r_m):
        k = int(math.ceil(r_m / self.cell_m))
        gx, gy = int(lon // self.cx), int(lat // self.cy)
        r2 = r_m * r_m
        for dx in range(-k, k + 1):
            for dy in range(-k, k + 1):
                for p in self.cells.get((gx + dx, gy + dy), ()):
                    ddx = (p[0] - lon) * M_PER_DEG_LON
                    ddy = (p[1] - lat) * M_PER_DEG_LAT
                    if ddx * ddx + ddy * ddy <= r2:
                        yield p


# ---------------------------------------------------------------- main
def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT, exist_ok=True)
    meta = {"version": VERSION, "sources": {}, "notes": []}

    with open(LISTING_CSV, encoding="utf-8-sig", newline="") as f:
        listings = list(csv.DictReader(f))

    dongs = load_dongs()
    pops = load_population()
    meta["sources"]["행정동경계"] = os.path.basename(BOUNDARY) + " (vuski/admdongkor, CC BY 4.0, 원자료 통계청 SGIS)"
    meta["sources"]["주민등록인구"] = os.path.basename(POP_CSV) + " (행정안전부, 2026-10-31 기준)"

    # 행정동별 인구밀도와 백분위
    dong_rows = []
    for d in dongs:
        p = pops.get(d["adm_cd2"])
        rec = {"adm_cd2": d["adm_cd2"], "adm_nm": d["adm_nm"], "area_km2": round(d["area_km2"], 4), "pop_matched": p is not None}
        for k in ["pop_total"] + list(AGE_BANDS):
            v = p[k] if p else None
            rec[k] = v
            rec[k + "_dens"] = round(v / d["area_km2"], 1) if (p and d["area_km2"] > 0) else None
        dong_rows.append(rec)
    dens_sorted = {k: sorted(r[k + "_dens"] for r in dong_rows if r[k + "_dens"] is not None)
                   for k in ["pop_total"] + list(AGE_BANDS)}
    for r in dong_rows:
        for k in dens_sorted:
            r[k + "_pct"] = percentile_rank(dens_sorted[k], r[k + "_dens"])
    dong_by_cd = {r["adm_cd2"]: r for r in dong_rows}
    meta["행정동수"] = len(dongs)
    meta["인구_매칭_행정동수"] = sum(1 for r in dong_rows if r["pop_matched"])
    meta["인구_미매칭_행정동"] = [r["adm_nm"] for r in dong_rows if not r["pop_matched"]]

    # 상가정보 (있으면)
    store_csv = find_store_csv()
    grid = None
    if store_csv:
        from_classify = make_classifier()
        stores, cols = load_stores(store_csv, from_classify)
        grid = Grid(stores)
        meta["sources"]["상가정보"] = os.path.basename(store_csv) + " (소상공인시장진흥공단, 2026-09-30 기준)"
        meta["상가수_대구"] = len(stores)
        meta["상가_업종매핑"] = CLASS_RULE_DESC
        cat_counts = {}
        for s in stores:
            for c in s[2]:
                cat_counts[c] = cat_counts.get(c, 0) + 1
        meta["상가_업종별_수"] = cat_counts
    else:
        meta["notes"].append("상가정보 CSV 없음: 상권 활성도와 동종 상가 수는 계산하지 않음")

    dong_by_cd8 = {d["adm_cd2"][:8]: d for d in dongs}
    out_rows = []
    matched = 0
    for L in listings:
        row = {"매물번호": L["매물번호"], "구": L["구"], "법정동": L["법정동"]}
        try:
            lon, lat = float(L["경도"]), float(L["위도"])
        except ValueError:
            lon = lat = None
        d = find_dong(lon, lat, dongs) if lon is not None else None
        row["좌표유무"] = lon is not None
        # 행정동 검증: 경계 파일(admdongkor)은 일부 경계가 근사치이므로, 반경 20m 안 상가들의
        # 주소 기반 행정동코드(상가정보)가 3곳 이상·70% 이상 한 행정동을 가리키면 그것을 우선한다.
        row["행정동_판정"] = "좌표없음" if lon is None else ("경계안" if d else "경계밖")
        if grid and lon is not None:
            near20 = [p[3] for p in grid.within(lon, lat, 20) if p[3]]
            if len(near20) >= 3:
                top, cnt = max(((c, near20.count(c)) for c in set(near20)), key=lambda t: t[1])
                if cnt / len(near20) >= 0.7:
                    alt = dong_by_cd8.get(top)
                    if alt and (not d or alt["adm_cd2"] != d["adm_cd2"]):
                        d = alt
                        row["행정동_판정"] = "주변상가로보정"
        if d and L["구"] not in d["adm_nm"]:
            row["행정동_판정"] += "/구불일치_좌표확인필요"
        elif d and BJD_TO_HJD.get((L["구"], L["법정동"])) and d["adm_cd2"][:8] not in BJD_TO_HJD[(L["구"], L["법정동"])]:
            row["행정동_판정"] += "/법정동불일치_경계근처"
        row["행정동코드"] = d["adm_cd2"] if d else ""
        row["행정동"] = d["adm_nm"] if d else ""
        if d:
            matched += 1
            dr = dong_by_cd[d["adm_cd2"]]
            for cat, spec in DEMAND_SPEC.items():
                if not spec or dr["pop_total_pct"] is None:
                    row["배후수요_" + cat] = ""
                    continue
                row["배후수요_" + cat] = round(sum(w * dr[k + "_pct"] for k, w in spec), 1)
        else:
            for cat in DEMAND_SPEC:
                row["배후수요_" + cat] = ""

        if grid and lon is not None:
            for r_m in RADII:
                near = list(grid.within(lon, lat, r_m))
                row["상가수_%dm" % r_m] = len(near)
                for cat in CATEGORIES:
                    if RADIUS[cat] == r_m:
                        row["동종_" + cat] = sum(1 for p in near if cat in p[2])
        out_rows.append(row)

    # 집계구 방식 배후 수요
    if os.path.exists(OA_JSON):
        oa_pts, oa_vals, oa_stat = build_oa_points(pops)
        oa_grid = Grid(oa_pts)
        meta["sources"]["SGIS집계구"] = os.path.basename(OA_JSON) + " (통계청 SGIS Open API, 2024년, 경계·사업체·10세 인구)"
        meta["집계구"] = oa_stat
        listing_by_no = {L["매물번호"]: L for L in listings}
        for r in out_rows:
            L = listing_by_no[r["매물번호"]]
            try:
                lon, lat = float(L["경도"]), float(L["위도"])
            except ValueError:
                continue
            for r_m in RADII:
                acc = dict.fromkeys(OA_KEYS, 0.0)
                for p in oa_grid.within(lon, lat, r_m):
                    v = oa_vals[p[2]]
                    for k in OA_KEYS:
                        acc[k] += v[k]
                for k in OA_KEYS:
                    r["반경%s_%dm" % (k, r_m)] = round(acc[k], 1)
        # 업종별 점수: 업종 반경의 합계 지표 → 좌표 있는 매물 중 백분위, 지표가 둘이면 가중 평균
        ref_oa = {(k, r_m): sorted(r["반경%s_%dm" % (k, r_m)] for r in out_rows if ("반경%s_%dm" % (k, r_m)) in r)
                  for k in OA_KEYS for r_m in RADII}
        for r in out_rows:
            for cat, spec in DEMAND_SPEC_OA.items():
                r["배후수요동_" + cat] = r.get("배후수요_" + cat, "")  # 행정동 방식(v1) 보존
                key0 = "반경%s_%dm" % (spec[0][0], RADIUS[cat])
                if key0 not in r:
                    r["배후수요_" + cat] = ""
                    continue
                r["배후수요_" + cat] = round(sum(w * percentile_rank(ref_oa[(k, RADIUS[cat])], r["반경%s_%dm" % (k, RADIUS[cat])])
                                              for k, w in spec), 1)
        meta["배후수요_방식"] = "집계구(반경 합계) — 행정동 방식 값은 배후수요동_ 컬럼에 보존"
        meta["배후수요_지표"] = {c: [k for k, _ in s] for c, s in DEMAND_SPEC_OA.items()}
    else:
        meta["배후수요_방식"] = "행정동 평균(집계구 데이터 없음)"

    meta["매물수"] = len(listings)
    meta["행정동_매칭_매물수"] = matched
    jc = {}
    for r in out_rows:
        jc[r["행정동_판정"]] = jc.get(r["행정동_판정"], 0) + 1
    meta["행정동_판정_건수"] = jc

    # 상권 활성도 점수 = 업종 기본 반경 안 전체 상가 수의, 대구 매물(좌표 있는 것) 중 백분위
    if grid:
        ref = {r_m: sorted(r["상가수_%dm" % r_m] for r in out_rows if ("상가수_%dm" % r_m) in r) for r_m in RADII}
        meta["상권활성도_기준"] = {"%dm" % r_m: {"p25": q(ref[r_m], .25), "p50": q(ref[r_m], .5), "p75": q(ref[r_m], .75), "p90": q(ref[r_m], .9)} for r_m in RADII}
        for r in out_rows:
            for cat in CATEGORIES:
                key = "상가수_%dm" % RADIUS[cat]
                r["활성도_" + cat] = percentile_rank(ref[RADIUS[cat]], r[key]) if key in r else ""

    fields = []
    for r in out_rows:
        for k in r:
            if k not in fields:
                fields.append(k)
    with open(os.path.join(OUT, "외부인자_%s.csv" % VERSION), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out_rows)
    dfields = [k for k in dong_rows[0] if k != "polys"]
    with open(os.path.join(OUT, "행정동_배후수요_%s.csv" % VERSION), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=dfields)
        w.writeheader()
        w.writerows(dong_rows)
    meta["업종별_반경_m"] = RADIUS
    meta.setdefault("배후수요_지표", {c: [k for k, _ in s] for c, s in DEMAND_SPEC.items()})
    with open(os.path.join(OUT, "외부인자_%s_meta.json" % VERSION), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in meta.items() if k not in ("상가_업종매핑",)}, ensure_ascii=False, indent=1))


def q(s, p):
    return s[int((len(s) - 1) * p)] if s else None


# ---------------------------------------------------------------- 상가 업종 → 우리 8개 업종
CLASS_RULE_DESC = {
    "식음료": "대분류 음식 전체",
    "소매": "대분류 소매 (약국, 연료 소매 제외)",
    "뷰티": "중분류 이용·미용 전체 + 소분류 체형/비만 관리",
    "의료": "대분류 보건의료 전체 + 소분류 약국",
    "운동시설": "중분류 스포츠 서비스 전체 + 소분류 요가/필라테스 학원, 태권도/무술학원",
    "교육": "대분류 교육 (운동시설로 옮긴 2개, 운전학원 제외) + 소분류 독서실/스터디 카페",
    "사무업무": "대분류 과학·기술(사진촬영업, 동물병원 제외)·부동산 + 중분류 고용 알선, 사무 지원, 기타 사업 서비스, 여행사·보조",
    "공연문화": "소분류 사진촬영업, 레크리에이션 교육기관, 기타 예술/스포츠 교육기관 (상가정보에 공연장·연습실·전시 업종이 없어 과소 집계)",
    "미분류(활성도에만 포함)": "수리·개인 일부, 숙박, 유원지·오락, 시설관리·임대 일부, 동물병원, 연료 소매",
}


def make_classifier():
    """상가정보 상권업종 대·중·소분류명을 우리 8개 업종으로 매핑 (정확한 분류명 일치). 한 상가는 0~1개 업종."""
    def classify(r):
        big, mid, small = r["상권업종대분류명"].strip(), r["상권업종중분류명"].strip(), r["상권업종소분류명"].strip()
        if small == "약국" or big == "보건의료":
            return ("의료",)
        if mid == "이용·미용" or small == "체형/비만 관리":
            return ("뷰티",)
        if mid == "스포츠 서비스" or small in ("요가/필라테스 학원", "태권도/무술학원"):
            return ("운동시설",)
        if small in ("사진촬영업", "레크리에이션 교육기관", "기타 예술/스포츠 교육기관"):
            return ("공연문화",)
        if (big == "교육" and small != "운전학원") or small == "독서실/스터디 카페":
            return ("교육",)
        if big == "음식":
            return ("식음료",)
        if big == "소매" and mid != "연료 소매":
            return ("소매",)
        if (big == "과학·기술" and mid != "수의") or big == "부동산" or mid in ("고용 알선", "사무 지원", "기타 사업 서비스", "여행사·보조"):
            return ("사무업무",)
        return ()
    return classify


if __name__ == "__main__":
    sys.exit(main())
