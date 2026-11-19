// 추천 엔진 본체: 실제 매물과 점수 규칙(점수 엔진 v1)으로 순위를 매긴다. 파일을 읽지 않는 순수 계산만 담았다.
// 서버는 lib/engine.ts 가, 발표용 단일 HTML은 demo/recommend-local.ts 가 데이터를 넣어 준다.
// 계산 규칙은 이전 데모(26.11.13 데모.html)의 score / factInfo / prosCons 와 같다.
import {
  GROUPS,
  GUEST_LIMIT,
  MEMBER_LIMIT,
  DEPOSIT_ANY,
  PY,
  RENT_ANY,
  industryLabel,
  walk,
  type Fact,
  type Filters,
  type Floor,
  type Gu,
  type IndustryId,
  type Item,
  type Preference,
  type Recommendation,
} from "./listings";

type Bp = [number, number][];
type Preset = { g: number[]; s: Record<string, number[]>; floor: (number | null)[]; area: number; subway: number };
type Cfg = {
  version: string;
  groups: string[];
  factors: Record<string, string[]>;
  preset: Record<string, Preset>;
  breakpoints: Record<string, Bp>;
  min_coverage: number;
};
export type Raw = {
  date: string;
  source: string;
  mapSource: string;
  cats: IndustryId[];
  radius: Record<string, number>;
  demand: Record<string, string>;
  reasons: string[];
  cfg: Cfg;
  gus: Record<string, [number, number]>;
  dongCenters: Record<string, [number, number]>;
  rows: unknown[][];
};

type PerCat = {
  floor: number | null;
  transit: number | null;
  act: number | null;
  dem: number | null;
  use: number | null;
  bld: number | null;
  area: number | null;
  grade: string;
  reason: string;
  same: number | null;
};
type Row = {
  id: string;
  gu: Gu;
  dong: string;
  bldg: string;
  fl: string;
  tf: number | null;
  a: number;
  dep: number;
  rent: number;
  mg: number | null;
  rec: string;
  sub: number | null;
  bus: number | null;
  apr: string;
  vr: number | null;
  mug: boolean;
  days: number | null;
  lon: number | null;
  lat: number | null;
  link: string;
  sVal: number | null;
  sDep: number | null;
  sAge: number | null;
  conf: string;
  useNm: string;
  c300: number | null;
  c500: number | null;
  per: PerCat[];
  flag: number;
  floorKind: Floor | "기타";
};

let cache: { raw: Raw; rows: Row[] } | null = null;

function load() {
  if (!cache) throw new Error("추천 엔진에 데이터가 아직 들어오지 않았습니다 (initEngine 필요)");
  return cache;
}

export function isEngineReady() {
  return cache != null;
}

export function initEngine(raw: Raw) {
  const rows: Row[] = raw.rows.map((a) => {
    const fl = String(a[4] ?? "");
    const n = Number(fl.match(/^(\d+)층/)?.[1]);
    return {
      id: String(a[0]),
      gu: a[1] as Gu,
      dong: String(a[2]),
      bldg: String(a[3] ?? ""),
      fl,
      tf: a[5] as number | null,
      a: Number(a[6]),
      dep: Number(a[7] ?? 0),
      rent: Number(a[8] ?? 0),
      mg: a[9] == null ? null : Number(a[9]),
      rec: String(a[10] ?? ""),
      sub: a[12] as number | null,
      bus: a[13] as number | null,
      apr: String(a[14] ?? ""),
      vr: a[15] as number | null,
      mug: !!a[17],
      days: a[18] as number | null,
      lon: a[19] as number | null,
      lat: a[20] as number | null,
      link: String(a[21] ?? ""),
      sVal: a[23] as number | null,
      sDep: a[24] as number | null,
      sAge: a[25] as number | null,
      conf: String(a[26] ?? ""),
      useNm: String(a[28] ?? ""),
      c300: a[30] as number | null,
      c500: a[31] as number | null,
      per: (a[33] as unknown[][]).map((p) => ({
        floor: p[0] as number | null,
        transit: p[1] as number | null,
        act: p[2] as number | null,
        dem: p[3] as number | null,
        use: p[4] as number | null,
        bld: p[5] as number | null,
        area: p[6] as number | null,
        grade: String(p[7] ?? ""),
        reason: (p[8] as number) >= 0 ? raw.reasons[p[8] as number] : "",
        same: p[9] as number | null,
      })),
      flag: Number(a[34] ?? 0),
      floorKind: fl.startsWith("지하") ? "지하" : n === 1 ? "1층" : n >= 2 ? "지상 2층 이상" : "기타",
    };
  });
  cache = { raw, rows };
}

export function dataMeta() {
  const { raw, rows } = load();
  return {
    date: raw.date,
    total: rows.length,
    version: raw.cfg.version,
    source: raw.source,
    mapSource: raw.mapSource,
    noCoord: rows.filter((r) => r.lat == null || r.flag > 1).length,
    byGu: rows.reduce<Record<string, number>>((acc, r) => ((acc[r.gu] = (acc[r.gu] ?? 0) + 1), acc), {}),
    cfg: raw.cfg,
    cats: raw.cats,
  };
}

// ---- 점수 계산 (데모와 같은 규칙)
function interp(bp: Bp, x: number | null) {
  if (x == null || isNaN(x)) return null;
  if (x <= bp[0][0]) return bp[0][1];
  for (let i = 1; i < bp.length; i++) {
    if (x <= bp[i][0]) return bp[i - 1][1] + ((bp[i][1] - bp[i - 1][1]) * (x - bp[i - 1][0])) / (bp[i][0] - bp[i - 1][0]);
  }
  return bp[bp.length - 1][1];
}
function wavg(pairs: [number, number | null][]) {
  let t = 0;
  let w = 0;
  for (const [wt, v] of pairs) {
    if (v != null && wt > 0) {
      t += wt * v;
      w += wt;
    }
  }
  return w ? t / w : null;
}
const rentTotal = (x: Row) => (x.rent || 0) + (x.mg || 0);

type Score = { total: number | null; groups: (number | null)[]; f: Record<string, number | null>; q: PerCat; ok: boolean };

function weightsFor(cat: IndustryId, prio: number) {
  const w = load().raw.cfg.preset[cat].g.slice();
  if (prio > 0) w[prio - 1] += 25;
  return w;
}

function score(x: Row, cat: IndustryId, w: number[], budget: number | null): Score {
  const { raw } = load();
  const cfg = raw.cfg;
  const p = cfg.preset[cat];
  const q = x.per[raw.cats.indexOf(cat)];
  const BP = cfg.breakpoints;
  const f: Record<string, number | null> = {
    임대료부담: budget && rentTotal(x) <= budget ? interp(BP["임대료부담"], rentTotal(x) / budget) : null,
    가성비: x.sVal,
    보증금: x.sDep,
    층: q.floor,
    면적적합도: q.area,
    건물연식: x.sAge,
    교통: q.transit,
    상권활성도: q.act,
    배후수요: q.dem,
    용도일치도: q.use,
    건물용도: q.bld,
  };
  const groups: (number | null)[] = [];
  let cov = 0;
  cfg.groups.forEach((g, gi) => {
    groups.push(wavg(cfg.factors[g].map((n, k) => [p.s[g][k], f[n]] as [number, number | null])));
    cfg.factors[g].forEach((n, k) => {
      if (f[n] != null) cov += (p.g[gi] * p.s[g][k]) / 100;
    });
  });
  const total = wavg(cfg.groups.map((_, gi) => [w[gi], groups[gi]] as [number, number | null]));
  return { total, groups, f, q, ok: total != null && cov >= cfg.min_coverage };
}

const pyeong = (m2: number) => `약 ${Math.round(m2 / PY)}평`;
const topPct = (p: number) => `대구 상가 중 상위 ${Math.max(1, Math.min(99, 100 - Math.round(p)))}%`;
const USE_LABEL: Record<number, string> = {
  100: "매물 소개에 이 업종이 적혀 있어요",
  60: "여러 용도로 쓸 수 있다고 적혀 있어요",
  50: "업종 관련 설명이 없어요",
  30: "다른 업종만 적혀 있어요",
};
const FLABEL: Record<string, string> = {
  임대료부담: "월세 부담",
  가성비: "시세 대비 가격",
  보증금: "보증금",
  층: "층",
  면적적합도: "넓이",
  건물연식: "건물 나이",
  교통: "교통",
  상권활성도: "주변 상권",
  배후수요: "주변 손님 수",
  용도일치도: "추천 용도",
  건물용도: "건물 용도",
};

function factInfo(x: Row, cat: IndustryId, s: Score, budget: number | null): Record<string, [string, string]> {
  const { raw } = load();
  const q = s.q;
  const rr = raw.radius[cat];
  const cn = industryLabel(cat);
  const rt = rentTotal(x);
  const o: Record<string, [string, string]> = {};
  o["임대료부담"] = [
    `월 ${rt.toLocaleString()}만원`,
    !budget
      ? "월세 상한을 고르지 않아 이 항목은 점수에서 뺐어요"
      : `고르신 상한 ${budget}만원의 ${Math.round((rt / budget) * 100)}%를 써요${x.mg == null ? " (관리비는 안 적혀 있어 빠졌어요)" : ""}`,
  ];
  const v = x.vr;
  o["가성비"] = [
    v == null ? "비교 못 함" : `주변 평균의 ${v.toFixed(2)}배`,
    v == null
      ? "비교할 만한 주변 상가가 부족해요"
      : v < 0.9
        ? `같은 동네 비슷한 층 상가보다 약 ${Math.round((1 - v) * 100)}% 저렴해요`
        : v <= 1.1
          ? "같은 동네 비슷한 층 상가와 비슷한 가격이에요"
          : `같은 동네 비슷한 층 상가보다 약 ${Math.round((v - 1) * 100)}% 비싸요`,
  ];
  o["보증금"] = [`${(x.dep || 0).toLocaleString()}만원`, `보증금이 적을수록 점수가 높아요${x.mug ? ". 권리금이 없어 점수를 더 받았어요" : ""}`];
  const fv = s.f["층"];
  o["층"] = [x.fl, fv == null ? "층을 정확히 알 수 없어요" : fv >= 80 ? `${cn}에 유리한 층이에요` : fv >= 50 ? `${cn}에 무난한 층이에요` : `${cn}에는 불리할 수 있는 층이에요`];
  o["면적적합도"] = [pyeong(x.a), `${cn} 가게의 보통 넓이는 ${pyeong(raw.cfg.preset[cat].area)}이에요. 여기에 가까울수록 점수가 높아요`];
  const yrs = x.apr ? Number(raw.date.slice(0, 4)) - Number(x.apr.slice(0, 4)) : null;
  o["건물연식"] = [
    yrs == null ? "정보 없음" : yrs < 1 ? "새 건물" : `지은 지 약 ${yrs}년`,
    yrs == null ? "건물을 언제 지었는지 알 수 없어요" : `${x.apr.slice(0, 4)}년에 지은 건물이에요. 새 건물일수록 점수가 높아요`,
  ];
  o["교통"] = [
    x.sub == null ? "정보 없음" : `지하철역 ${walk(x.sub)}`,
    x.sub == null ? "위치 정보가 없어요" : `지하철역까지 ${x.sub}m, 버스정류장까지 ${x.bus}m (${walk(x.bus ?? 0)})`,
  ];
  const stores = rr === 300 ? x.c300 : x.c500;
  o["상권활성도"] = [
    q.act == null ? "정보 없음" : `주변 가게 ${stores}곳`,
    q.act == null ? "위치 정보가 없어요" : `반경 ${rr}m 안의 가게 수예요. ${topPct(q.act)}로 ${q.act >= 50 ? "많은" : "적은"} 편이에요`,
  ];
  o["배후수요"] = [
    q.dem == null ? "정보 없음" : topPct(q.dem),
    q.dem == null ? "주변 인구 정보가 없어요" : `반경 ${rr}m 안에 사는 ${raw.demand[cat]} 수를 본 거예요`,
  ];
  o["용도일치도"] = [
    ({ 100: "이 업종 추천", 60: "여러 용도 가능", 50: "설명 없음", 30: "다른 업종 추천" } as Record<number, string>)[q.use ?? -1] ?? "정보 없음",
    USE_LABEL[q.use ?? -1] ?? "매물 소개 글에서 업종을 찾아본 결과예요",
  ];
  o["건물용도"] = [
    !q.grade ? "정보 없음" : `${q.grade}등급`,
    !q.grade
      ? "건물 서류를 찾지 못했어요"
      : x.conf === "확인필요"
        ? "건물 서류가 확실하지 않아 점수에서 뺐어요"
        : `서류상 이 층 용도는 「${x.useNm}」예요.${q.reason ? ` ${q.reason}` : ""}`,
  ];
  return o;
}

function prosCons(x: Row, cat: IndustryId, s: Score): [string[], string[]] {
  const f = s.f;
  const c = industryLabel(cat);
  const pros: string[] = [];
  const cons: string[] = [];
  const add = (v: number | null, hi: number, good: string, lo: number, bad: string) => {
    if (v == null) return;
    if (v >= hi) pros.push(good);
    else if (v < lo) cons.push(bad);
  };
  add(f["가성비"], 70, "같은 동네 비슷한 상가보다 월세가 저렴한 편이에요", 40, "같은 동네 비슷한 상가보다 월세가 비싼 편이에요");
  add(f["임대료부담"], 75, "고르신 월세 상한보다 여유가 있어요", 50, "고르신 월세 상한에 거의 꽉 차요");
  add(f["보증금"], 75, `보증금 부담이 적어요${x.mug ? " (권리금 없음)" : ""}`, 35, "보증금이 큰 편이에요");
  add(f["층"], 80, `${x.fl}이라 ${c}에 잘 맞는 층이에요`, 50, `${x.fl}은 ${c}에 불리할 수 있어요`);
  add(f["면적적합도"], 75, `넓이(${pyeong(x.a)})가 ${c}에 알맞아요`, 45, `넓이(${pyeong(x.a)})가 ${c} 평균과 차이가 커요`);
  add(f["건물연식"], 80, "지은 지 오래되지 않은 건물이에요", 40, "오래된 건물이라 시설 상태를 확인하세요");
  if (x.sub != null) {
    if (x.sub <= 500) pros.push(`지하철역이 가까워요 (${walk(x.sub)})`);
    else if (f["교통"] != null && f["교통"] < 45) cons.push("지하철역·버스정류장이 먼 편이에요");
  }
  add(f["상권활성도"], 75, "주변에 가게가 많은 활발한 상권이에요", 35, "주변에 가게가 적어 한산할 수 있어요");
  add(f["배후수요"], 75, "주변에 손님이 될 사람이 많아요", 35, "주변에 손님이 될 사람이 적은 편이에요");
  add(f["건물용도"], 80, `건물 용도가 ${c}에 맞게 등록돼 있어요`, 50, `건물 용도가 ${c}와 다를 수 있어요 (구청 확인 필요)`);
  if (x.mg == null) cons.push("관리비가 적혀 있지 않아요. 중개사에게 물어보세요");
  if (x.conf === "확인필요") cons.push("건물 서류 정보가 확실하지 않아요");
  if (x.days != null && x.days <= 14) pros.push(`최근(${x.days}일 전)에 확인된 매물이에요`);
  if (!pros.length) pros.push("특별히 두드러진 장점은 없어요");
  if (!cons.length) cons.push("크게 걸리는 점은 없어요. 현장은 꼭 직접 보세요");
  return [pros.slice(0, 5), cons.slice(0, 5)];
}

function toItem(x: Row, cat: IndustryId, s: Score, budget: number | null, bonus: number): Item {
  const { raw } = load();
  const info = factInfo(x, cat, s, budget);
  const [pros, cons] = prosCons(x, cat, s);
  const rr = raw.radius[cat];
  const base = Math.round(s.total ?? 0);
  return {
    id: x.id,
    title: `${x.gu} ${x.dong} ${x.fl}`,
    bldg: x.bldg,
    gu: x.gu,
    dong: x.dong,
    fl: x.fl,
    areaM2: x.a,
    deposit: x.dep,
    rent: x.rent,
    mgmt: x.mg,
    noPremium: x.mug,
    lat: x.flag > 1 ? null : x.lat,
    lng: x.flag > 1 ? null : x.lon,
    link: x.link,
    days: x.days,
    subway: x.sub,
    bus: x.bus,
    stores: rr === 300 ? x.c300 : x.c500,
    same: s.q.same,
    radius: rr,
    useName: x.useNm,
    rec: x.rec,
    baseScore: base,
    prefBonus: bonus,
    score: Math.max(0, Math.min(100, base + bonus)),
    groups: s.groups.map((v) => (v == null ? null : Math.round(v))),
    facts: raw.cfg.groups.map((g) =>
      raw.cfg.factors[g].map<Fact>((n) => ({
        name: FLABEL[n] ?? n,
        value: info[n][0],
        detail: info[n][1],
        score: s.f[n] == null ? null : Math.round(s.f[n] as number),
      })),
    ),
    pros,
    cons,
  };
}

/** 조건에 맞는 매물을 점수순으로. 비회원은 상위 3곳만 내용을 주고 나머지는 점수만 준다. */
export function recommend(filters: Filters, opts: { member: boolean; pref?: Preference; limit?: number }): Recommendation {
  const { raw, rows } = load();
  const cat = raw.cats.includes(filters.industry) ? filters.industry : raw.cats[0];
  const budget = filters.rentMax >= RENT_ANY ? null : filters.rentMax;
  const depCap = filters.depositMax >= DEPOSIT_ANY ? null : filters.depositMax;
  const w = weightsFor(cat, filters.prio);
  const floors = new Set<string>(filters.floors);
  if (floors.has("지상 2층 이상")) floors.add("기타");

  const matched = rows.filter(
    (x) =>
      (!budget || rentTotal(x) <= budget) &&
      (!depCap || x.dep <= depCap) &&
      x.a >= filters.areaMin &&
      x.a <= filters.areaMax &&
      filters.gus.includes(x.gu) &&
      floors.has(x.floorKind),
  );
  const scored = matched.map((x) => ({ x, s: score(x, cat, w, budget) }));
  const ok = scored
    .filter((r) => r.s.ok)
    .map((r) => {
      const bonus = opts.member ? (opts.pref?.likedGus[r.x.gu] ?? 0) : 0;
      return { ...r, bonus, final: (r.s.total ?? 0) + bonus };
    })
    .sort((a, b) => b.final - a.final);

  const limit = opts.limit ?? (opts.member ? MEMBER_LIMIT : GUEST_LIMIT);
  const visible = ok.slice(0, opts.member ? limit : Math.min(limit, GUEST_LIMIT));
  const tw = w.reduce((a, b) => a + b, 0) || 1;
  return {
    date: raw.date,
    version: raw.cfg.version,
    total: rows.length,
    matched: matched.length,
    okCount: ok.length,
    lowCount: scored.length - ok.length,
    weights: w.map((v) => Math.round((v / tw) * 100)),
    items: visible.map((r) => toItem(r.x, cat, r.s, budget, r.bonus)),
    locked: opts.member
      ? []
      : ok.slice(GUEST_LIMIT, GUEST_LIMIT + 2).map((r, i) => ({ rank: GUEST_LIMIT + i + 1, score: Math.round(r.final), gu: r.x.gu })),
  };
}

export const GROUP_LABELS = GROUPS.map((g) => g.label);
