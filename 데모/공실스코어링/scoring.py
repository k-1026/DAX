# -*- coding: utf-8 -*-
import csv
import math
from collections import defaultdict

LISTING = r"C:\Users\Green\Downloads\동성로_네이버부동산_매물_20261105.csv"
TMP = r"C:\Users\Green\.aside\u\0\sessions\2026-11-04_eFmhdQnRqxLycOmb\tmp"
BASE_PATH = TMP + r"\sg_past_daegu_jung.csv"      # 2025.12
LATEST_PATH = TMP + r"\sg_202609_daegu_jung.csv"  # 2026.9
OUT_DIR = r"C:\Users\Green\Desktop\대구 뮤지컬\research\공실스코어링"

DONGSEONGNO = {
    "동성로1가","동성로2가","동성로3가","공평동","동문동","문화동","삼덕동1가","남일동",
    "덕산동","교동","사일동","포정동","화전동","완전동","용덕동","동일동","전동","장관동","상덕동"
}
MID = {
    "카페": {"비알코올 ", "비알코올"},
    "식당": {"한식", "일식", "서양식", "중식", "동남아시아", "기타 간이", "구내식당·뷔페"},
}
MIN_N = 10

# 면적·평당월세 IQR (네이버 매물 4158건 분포, area_result.txt / price_result.txt)
IQR = {
    "카페":   {"area": (39.9, 100.2), "rent_m2": (15655.25, 29306.41)},
    "식당":   {"area": (59.4, 137.0), "rent_m2": (15691.34, 30303.03)},
    "사무실": {"area": (99.2, 303.0), "rent_m2": (8000.00, 16421.78)},
}

# 소상공인365 간단분석(2026-08) 행정동별 매출 전년동월대비 %. 식당은 백반/한정식 값으로 대표.
# 3개 행정동 생존율 순위와 같은 방향(순위상관 +0.5)인 지표는 이것뿐이라 채택. 매출액·유동인구는 카페에서 반대 방향.
SBIZ365 = r"C:\Users\Green\Desktop\대구 뮤지컬\research\공실스코어링\소상공인365_동성로_202608.csv"
SBIZ365_UPJONG = {"카페": "카페", "식당": "백반/한정식"}
# 유동인구 순위상관(행정동 생존율 기준): 식당 +0.5, 카페 -1.0. 카페는 데이터와 반대 방향이지만
# 팀 결정으로 포함(2026-11-05). 매출증감·유동인구는 같은 행정동 3분할이라 행정동 몫 가중치를 반씩 나눔.
FOOT_TRAFFIC_CATS = {"카페", "식당"}

CAUSAL_SHARE = 0.70  # 생존근거:시장분포 = 70:30 — 두 근거는 단위가 달라 데이터로 비교 불가, 팀 결정으로 확정(2026-11-05)


def norm_name(s):
    return (s or "").replace(" ", "")


def load_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [r for r in csv.DictReader(f) if r["법정동명"] in DONGSEONGNO]


def floor_group_sg(s):
    s = (s or "").strip()
    if s == "":
        return "층정보없음"
    if s.startswith("B") or s.startswith("-"):
        return "지하"
    try:
        return "1층" if int(s) == 1 else "2층이상"
    except ValueError:
        return "기타"


def floor_group_listing(s):
    s = (s or "").strip()
    if s.startswith("B"):
        return "지하"
    return "1층" if s == "1" else "2층이상"


def haversine_m(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(a))


def rate_table(groups):
    return {g: (s / t, t) for g, (s, t) in groups.items()}


def build_survival_model(base, latest_ids, latest_name_addr, mid_set):
    biz = [r for r in base if r["상권업종중분류명"] in mid_set]
    for r in biz:
        r["_surv"] = (r["상가업소번호"] in latest_ids
                      or (norm_name(r["상호명"]), r["도로명주소"]) in latest_name_addr)
        r["_xy"] = (float(r["경도"]), float(r["위도"]))
    overall = sum(r["_surv"] for r in biz) / len(biz)

    dong, floor, hjd = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
    for r in biz:
        for tbl, key in ((dong, r["법정동명"]), (floor, floor_group_sg(r["층정보"])), (hjd, r["행정동명"])):
            tbl[key][1] += 1
            tbl[key][0] += r["_surv"]
    dong = {k: v for k, v in rate_table(dong).items() if v[1] >= MIN_N}
    floor = {k: v for k, v in rate_table(floor).items() if v[1] >= MIN_N}
    hjd = {k: v for k, v in rate_table(hjd).items() if v[1] >= MIN_N}

    dens = []
    for i, r in enumerate(biz):
        c = sum(1 for j, r2 in enumerate(biz)
                if i != j and haversine_m(*r["_xy"], *r2["_xy"]) <= 300)
        dens.append((c, r["_surv"]))
    dens.sort(key=lambda x: x[0])
    t = len(dens) // 3
    buckets = [dens[:t], dens[t:2 * t], dens[2 * t:]]
    cuts = (dens[t - 1][0], dens[2 * t - 1][0])
    dens_rate = {name: sum(s for _, s in b) / len(b) for name, b in zip(("저밀도", "중밀도", "고밀도"), buckets)}

    return {"biz": biz, "overall": overall, "dong": dong, "floor": floor, "hjd": hjd,
            "dens_cuts": cuts, "dens_rate": dens_rate}


def load_sbiz365():
    with open(SBIZ365, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    pick = lambda col: {cat: {r["행정동"]: float(r[col]) for r in rows if r["업종"] == up}
                        for cat, up in SBIZ365_UPJONG.items()}
    return pick("매출_전년동월대비_%"), pick("일평균유동인구")


def nearest_hjd(xy, latest_xy):
    return min(latest_xy, key=lambda t: haversine_m(*xy, *t[0]))[1]


def minmax(value, values):
    lo, hi = min(values), max(values)
    return 100.0 if hi == lo else (value - lo) / (hi - lo) * 100


def iqr_fit(x, q1, q3):
    if q1 <= x <= q3:
        return 100.0
    fence = 1.5 * (q3 - q1)
    d = (q1 - x) if x < q1 else (x - q3)
    return max(0.0, 100.0 * (1 - d / fence))


def main():
    base = load_rows(BASE_PATH)
    latest = load_rows(LATEST_PATH)
    latest_ids = {r["상가업소번호"] for r in latest}
    latest_name_addr = {(norm_name(r["상호명"]), r["도로명주소"]) for r in latest}
    models = {cat: build_survival_model(base, latest_ids, latest_name_addr, m) for cat, m in MID.items()}
    vitality, foot = load_sbiz365()
    latest_xy = [((float(r["경도"]), float(r["위도"])), r["행정동명"]) for r in latest]

    weights = {}
    for cat, m in models.items():
        rng = {
            "법정동": max(v[0] for v in m["dong"].values()) - min(v[0] for v in m["dong"].values()),
            "경쟁밀도": max(m["dens_rate"].values()) - min(m["dens_rate"].values()),
            "층": max(v[0] for v in m["floor"].values()) - min(v[0] for v in m["floor"].values()),
            "상권활력": max(v[0] for v in m["hjd"].values()) - min(v[0] for v in m["hjd"].values()),
        }
        tot = sum(rng.values())
        w = {k: CAUSAL_SHARE * v / tot for k, v in rng.items()}
        if cat in FOOT_TRAFFIC_CATS:
            w["상권활력"] /= 2
            w["유동인구"] = w["상권활력"]
        else:
            w["유동인구"] = 0
        w["면적"] = w["가격"] = (1 - CAUSAL_SHARE) / 2
        weights[cat] = (w, rng)
    weights["사무실"] = ({"법정동": 0, "경쟁밀도": 0, "층": 0, "상권활력": 0, "유동인구": 0,
                         "면적": 0.5, "가격": 0.5}, None)

    with open(LISTING, encoding="utf-8-sig", newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["현재용도_공실명시"] == "O" or r["유형"] == "사무실"]

    by_group = {}
    for r in rows:
        key = r["동일호실그룹"] or r["매물번호"]
        r["_rent"] = float(r["월세(만원)"] or 0)
        if key not in by_group or r["_rent"] < by_group[key]["_rent"]:
            by_group[key] = r
        by_group[key].setdefault("_dup", 0)
    dup_cnt = defaultdict(int)
    for r in rows:
        dup_cnt[r["동일호실그룹"] or r["매물번호"]] += 1
    units = list(by_group.values())

    results = {"카페": [], "식당": [], "사무실": []}
    for r in units:
        area = float(r["전용면적(㎡)"] or 0)
        rent_m2 = r["_rent"] * 10000 / area if area else None
        xy = (float(r["경도"]), float(r["위도"]))
        hjd = nearest_hjd(xy, latest_xy)
        is_office_type = r["유형"] == "사무실"
        office_ok = is_office_type or "사무" in (r["추천용도"] or "")

        for cat in ("카페", "식당", "사무실"):
            if cat in ("카페", "식당") and is_office_type:
                continue
            if cat == "사무실" and not office_ok:
                continue
            w, rng = weights[cat]
            s, note = {}, []
            if cat in models:
                m = models[cat]
                dong_vals = [v[0] for v in m["dong"].values()]
                if r["법정동"] in m["dong"]:
                    s["법정동"] = minmax(m["dong"][r["법정동"]][0], dong_vals)
                else:
                    s["법정동"] = minmax(min(max(m["overall"], min(dong_vals)), max(dong_vals)), dong_vals)
                    note.append("법정동 n<10→전체평균")

                cnt = sum(1 for b in m["biz"] if haversine_m(*xy, *b["_xy"]) <= 300)
                b1, b2 = m["dens_cuts"]
                bucket = "저밀도" if cnt <= b1 else ("중밀도" if cnt <= b2 else "고밀도")
                s["경쟁밀도"] = minmax(m["dens_rate"][bucket], list(m["dens_rate"].values()))

                fg = floor_group_listing(r["층"])
                floor_vals = [v[0] for v in m["floor"].values()]
                if fg in m["floor"]:
                    s["층"] = minmax(m["floor"][fg][0], floor_vals)
                else:
                    s["층"] = minmax(min(max(m["overall"], min(floor_vals)), max(floor_vals)), floor_vals)
                    note.append(f"{fg} n<10→전체평균")

                v = vitality[cat]
                s["상권활력"] = minmax(v[hjd], list(v.values())) if hjd in v else None
                if hjd not in v:
                    note.append(f"{hjd} 소상공인365 값 없음")
                if cat in FOOT_TRAFFIC_CATS:
                    ft = foot[cat]
                    s["유동인구"] = minmax(ft[hjd], list(ft.values())) if hjd in ft else None
                else:
                    s["유동인구"] = None
                    note.append("유동인구 제외(카페 생존율과 반대 방향)")
                extra = {"반경300m동종": cnt, "밀도구간": bucket, "층그룹": fg,
                         "일평균유동인구": int(foot[cat][hjd]) if hjd in foot[cat] else ""}
            else:
                s["법정동"] = s["경쟁밀도"] = s["층"] = s["상권활력"] = s["유동인구"] = None
                note.append("생존율·경쟁밀도·층·상권활력·유동인구 산출불가")
                extra = {"반경300m동종": "", "밀도구간": "", "층그룹": "", "일평균유동인구": ""}

            q = IQR[cat]
            s["면적"] = iqr_fit(area, *q["area"])
            s["가격"] = iqr_fit(rent_m2, *q["rent_m2"]) if rent_m2 else 0.0

            total = sum(w[k] * s[k] for k in w if s[k] is not None)
            results[cat].append({
                "점수": round(total, 1),
                "매물번호": r["매물번호"], "유형": r["유형"], "법정동": r["법정동"], "행정동": hjd, "층": r["층"],
                "전용면적㎡": area, "보증금만원": r["보증금(만원)"], "월세만원": r["월세(만원)"],
                "㎡당월세원": round(rent_m2) if rent_m2 else "",
                **{f"S_{k}": ("산출불가" if v is None else round(v, 1)) for k, v in s.items()},
                **extra,
                "중복등록수": dup_cnt[r["동일호실그룹"] or r["매물번호"]],
                "추천용도": r["추천용도"], "비고": "; ".join(note), "링크": r["링크"],
            })

    for cat in results:
        results[cat].sort(key=lambda x: -x["점수"])
        with open(f"{OUT_DIR}\\scored_{cat}.csv", "w", encoding="utf-8-sig", newline="") as f:
            wr = csv.DictWriter(f, fieldnames=list(results[cat][0].keys()))
            wr.writeheader()
            wr.writerows(results[cat])

    with open(f"{OUT_DIR}\\scoring_summary.txt", "w", encoding="utf-8") as out:
        out.write(f"공실 후보 원본 {len(rows)}건 → 동일호실 병합 후 {len(units)}개 실물 공간\n\n")
        for cat, m in models.items():
            out.write(f"[{cat}] 전체생존율 {m['overall']*100:.1f}% / 밀도 3분위 경계(반경300m 동종수) ≤{m['dens_cuts'][0]} / ≤{m['dens_cuts'][1]} / 초과\n")
            out.write(f"  밀도구간 생존율: {', '.join(f'{k} {v*100:.1f}%' for k, v in m['dens_rate'].items())}\n")
            out.write(f"  층 그룹(n>=10): {', '.join(f'{k} {v[0]*100:.1f}%(n={v[1]})' for k, v in m['floor'].items())}\n")
            out.write(f"  행정동 생존율: {', '.join(f'{k} {v[0]*100:.1f}%(n={v[1]})' for k, v in m['hjd'].items())}"
                      f" / 소상공인365 매출 전년대비: {', '.join(f'{k} {v:+.1f}%' for k, v in vitality[cat].items())}\n")
        out.write("\n[가중치]\n")
        for cat, (w, rng) in weights.items():
            out.write(f"  {cat}: " + ", ".join(f"{k} {v*100:.1f}%" for k, v in w.items()))
            if rng:
                out.write("   (생존율 편차 %p: " + ", ".join(f"{k} {v*100:.1f}" for k, v in rng.items()) + ")")
            out.write("\n")
        for cat, lst in results.items():
            out.write(f"\n=== {cat} Top 10 (후보 {len(lst)}개) ===\n")
            for i, x in enumerate(lst[:10], 1):
                out.write(f"{i:2d}. {x['점수']:5.1f}점 | {x['법정동']} {x['층']}층 {x['전용면적㎡']:.0f}㎡ "
                          f"보증금{x['보증금만원']}/월세{x['월세만원']} | 법정동{x['S_법정동']} 밀도{x['S_경쟁밀도']} "
                          f"층{x['S_층']} 활력{x['S_상권활력']} 유동{x['S_유동인구']}({x['행정동']}) 면적{x['S_면적']} 가격{x['S_가격']} | {x['비고']}\n")


if __name__ == "__main__":
    main()
