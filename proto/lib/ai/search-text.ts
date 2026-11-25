// AI-1 "문장으로 찾기": 문장을 검색 조건으로 바꾼다.
// 지금은 규칙 기반 시험용이다(발표 데모와 같은 방식). 나중에 실제 AI 모델로 바꿀 때는 이 함수만 같은 모양으로 바꿔 끼우면 된다.
// 모델 이름·제공사는 아직 정하지 않았다(비워 둠).
import { RANGES, SQM_PER_PYEONG } from "@/lib/search/ranges";

export type InterpretedFilters = {
  gu: string[];
  dong: string[];
  floors: string[];
  rent_max?: number;
  deposit_max?: number;
  area_min?: number;
  area_max?: number;
};

export type Interpretation = {
  found: boolean;
  filters: InterpretedFilters;
  /** 화면에 보여 줄 "이렇게 바꿨어요" 칩 */
  chips: string[];
  /** 아직 적용되지 않는 말(업종 등) */
  notes: string[];
};

const INDUSTRY_WORDS =
  /카페|커피|음식점|식당|술집|주점|치킨|분식|옷|의류|잡화|미용실|헤어|네일|공연|문화|사무실|학원|교습소|병원|약국|의원|헬스|필라테스|편의점|무인|베이커리|빵집/;

const number = (text: string) => Number(text.replace(/,/g, ""));
const won = (value: number) => value.toLocaleString("ko-KR");

export function interpretSearchText(text: string, areas: Record<string, string[]>): Interpretation {
  const input = text.normalize("NFC").slice(0, 200);
  const filters: InterpretedFilters = { gu: [], dong: [], floors: [] };
  const chips: string[] = [];
  const notes: string[] = [];

  // 지역: "수성구", "수성"(3글자 이상 줄임말), 동 이름
  for (const gu of Object.keys(areas)) {
    const stem = gu.replace(/[구군]$/, "");
    if (input.includes(gu) || (stem.length >= 2 && input.includes(stem))) filters.gu.push(gu);
  }
  for (const dongs of Object.values(areas)) {
    for (const dong of dongs) if (dong.length >= 2 && input.includes(dong) && !filters.dong.includes(dong)) filters.dong.push(dong);
  }
  if (filters.gu.length) chips.push(filters.gu.join("·"));
  if (filters.dong.length) chips.push(filters.dong.join("·"));

  // 면적: "20평" 또는 "60㎡"
  const pyeong = input.match(/(\d+(?:\.\d+)?)\s*평/);
  const sqm = input.match(/(\d+(?:\.\d+)?)\s*(?:㎡|제곱미터|m2)/i);
  const wantedSqm = pyeong ? Number(pyeong[1]) * SQM_PER_PYEONG : sqm ? Number(sqm[1]) : null;
  if (wantedSqm && wantedSqm > 0) {
    const lo = Math.round(wantedSqm * 0.75);
    const hi = Math.round(wantedSqm * 1.3);
    if (lo > RANGES.area.min) filters.area_min = lo;
    if (hi < RANGES.area.max) filters.area_max = hi;
    chips.push(`면적 ${Math.round(lo / SQM_PER_PYEONG)}~${Math.round(hi / SQM_PER_PYEONG)}평`);
  }

  // 월세(+관리비) 상한: "월세 200", "월 150만원 이하"
  const rent = input.match(/월\s*세?\s*(\d[\d,]*)\s*(?:만\s*원?|만)?/);
  if (rent) {
    const value = number(rent[1]);
    if (value > 0 && value < RANGES.rent.max) {
      filters.rent_max = value;
      chips.push(`월세+관리비 ${won(value)}만원 이하`);
    } else if (value >= RANGES.rent.max) {
      notes.push(`월세 ${won(RANGES.rent.max)}만원 이상은 제한 없음으로 봐요.`);
    }
  }

  // 보증금 상한: "보증금 5000", "보증금 1억", "보증금 3천"
  const deposit = input.match(/보증금\s*(\d[\d,]*)\s*(억|천|만)?/);
  if (deposit) {
    let value = number(deposit[1]);
    const unit = deposit[2];
    if (unit === "억") value *= 10000;
    else if (unit === "천") value *= 1000;
    else if (!unit && value < 100) value *= 1000; // "보증금 5" = 5천만원으로 본다
    if (value > 0 && value < RANGES.deposit.max) {
      filters.deposit_max = value;
      chips.push(`보증금 ${won(value)}만원 이하`);
    } else if (value >= RANGES.deposit.max) {
      notes.push(`보증금 ${won(RANGES.deposit.max)}만원 이상은 제한 없음으로 봐요.`);
    }
  }

  // 층: 1층 / 지하 / 2층 이상
  const hasBasement = /지하/.test(input);
  const upper = /(?:지상\s*)?([2-9]|\d{2})\s*층\s*(?:이상)?/.exec(input.replace(/지하\s*\d*\s*층?/g, ""));
  const ground = /(?:^|[^\d])1\s*층/.test(input.replace(/지하\s*\d*\s*층?/g, ""));
  if (ground) filters.floors.push("ground1");
  if (upper) filters.floors.push("upper");
  if (hasBasement) filters.floors.push("basement");
  if (filters.floors.length) {
    const labels = { ground1: "1층", upper: "지상 2층 이상", basement: "지하" } as const;
    chips.push(`층 ${filters.floors.map((key) => labels[key as keyof typeof labels]).join("·")}`);
  }

  if (INDUSTRY_WORDS.test(input)) notes.push("업종은 아직 미확정이라 조건에 적용되지 않아요.");

  const found = chips.length > 0;
  return { found, filters, chips, notes };
}

// 검색 화면 주소로 바꾼다. 슬라이더 끝값(제한 없음)은 이미 빠져 있다.
export function filtersToQuery(filters: InterpretedFilters): string {
  const query = new URLSearchParams();
  for (const gu of filters.gu) query.append("gu", gu);
  for (const dong of filters.dong) query.append("dong", dong);
  for (const floor of filters.floors) query.append("floors", floor);
  for (const key of ["rent_max", "deposit_max", "area_min", "area_max"] as const) {
    if (filters[key] !== undefined) query.set(key, String(filters[key]));
  }
  const text = query.toString();
  return text ? `/?${text}` : "/";
}
