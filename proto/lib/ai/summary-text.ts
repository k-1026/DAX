// 추천 패널 위쪽 제목·요약 문장·질문 칩 답변을 만든다. 실제 매물 값만 쓰고 점수 말은 하지 않는다(5단계 연결 전).
// 규칙 기반 시험용이다. 나중에 실제 AI로 바꿀 때는 이 함수들만 같은 모양으로 바꿔 끼우면 된다.
import { SQM_PER_PYEONG } from "@/lib/search/ranges";
import type { SearchSummary, SummaryListing } from "@/lib/search/summary";

export type ChipKey = "cheapest" | "widest" | "newest" | "dong";

export const CHIPS: { key: ChipKey; label: string; needsLogin: boolean }[] = [
  { key: "cheapest", label: "월세 부담이 가장 적은 곳은?", needsLogin: true },
  { key: "widest", label: "가장 넓은 곳은?", needsLogin: true },
  { key: "newest", label: "새로 올라온 곳은?", needsLogin: true },
  { key: "dong", label: "어느 동네에 많아요?", needsLogin: false },
];

type HeadingFilters = {
  gu: string[];
  dong: string[];
  floors: string[];
  rent_max?: number;
  deposit_max?: number;
  area_min?: number;
  area_max?: number;
};

const pyeong = (sqm: number) => Math.round(sqm / SQM_PER_PYEONG);
const won = (value: number) => Math.round(value).toLocaleString("ko-KR");
const FLOOR_LABELS: Record<string, string> = { ground1: "1층", upper: "지상 2층 이상", basement: "지하" };

// "15~26평 · 월세 200만원 이하 · 1층" 같은 조건 한 줄
export function conditionLine(f: HeadingFilters): string {
  const parts: string[] = [];
  if (f.gu.length) parts.push(f.gu.join("·"));
  if (f.dong.length) parts.push(f.dong.join("·"));
  if (f.area_min !== undefined && f.area_max !== undefined) parts.push(`${pyeong(f.area_min)}~${pyeong(f.area_max)}평`);
  else if (f.area_min !== undefined) parts.push(`${pyeong(f.area_min)}평 이상`);
  else if (f.area_max !== undefined) parts.push(`${pyeong(f.area_max)}평 이하`);
  if (f.deposit_max !== undefined) parts.push(`보증금 ${won(f.deposit_max)}만원 이하`);
  if (f.rent_max !== undefined) parts.push(`월세+관리비 ${won(f.rent_max)}만원 이하`);
  if (f.floors.length) parts.push(f.floors.map((key) => FLOOR_LABELS[key] ?? key).join("·"));
  return parts.join(" · ");
}

export function summaryText(s: SearchSummary): string {
  if (s.total === 0) return "조건에 맞는 매물이 없어요. 지역을 넓히거나 금액 조건을 조금 올려 보세요.";
  const sentences = [`조건에 맞는 곳은 ${s.total.toLocaleString("ko-KR")}곳이에요.`];
  if (s.by_gu.length > 0) {
    const [first, ...rest] = s.by_gu;
    sentences.push(
      s.by_gu.length === 1
        ? `모두 ${first.name}에 있어요.`
        : `${first.name}에 가장 많고(${first.count.toLocaleString("ko-KR")}곳), ${rest.map((g) => `${g.name}(${g.count.toLocaleString("ko-KR")}곳)`).join(", ")} 순이에요.`,
    );
  }
  if (s.monthly_p25 !== null && s.monthly_p75 !== null) {
    sentences.push(`월세+관리비는 보통 ${won(s.monthly_p25)}~${won(s.monthly_p75)}만원대예요.`);
  }
  return sentences.join(" ");
}

function place(item: SummaryListing) {
  return [item.gu, item.dong, item.floor].filter(Boolean).join(" ");
}

export function chipAnswer(key: ChipKey, s: SearchSummary, badgeDays = 7): { text: string; listing?: SummaryListing } {
  if (s.total === 0) return { text: "조건에 맞는 매물이 없어요." };
  if (key === "dong") {
    if (s.by_dong.length === 0) return { text: "동네 정보가 있는 매물이 없어요." };
    return { text: `매물이 가장 많은 동네는 ${s.by_dong.map((d) => `${d.name}(${d.count.toLocaleString("ko-KR")}곳)`).join(", ")}이에요.` };
  }
  if (key === "cheapest") {
    const item = s.cheapest;
    if (!item) return { text: "월세가 적힌 매물이 없어요." };
    return {
      text: `월세 부담이 가장 적은 곳은 ${place(item)}이에요. 월세+관리비 ${won(item.monthly ?? 0)}만원, 보증금 ${item.deposit === null ? "-" : `${won(item.deposit)}만원`}이에요.`,
      listing: item,
    };
  }
  if (key === "widest") {
    const item = s.widest;
    if (!item || item.area === null) return { text: "면적이 적힌 매물이 없어요." };
    return {
      text: `가장 넓은 곳은 ${place(item)}이에요. 전용 ${item.area}㎡(약 ${pyeong(item.area)}평), 월세+관리비 ${won(item.monthly ?? 0)}만원이에요.`,
      listing: item,
    };
  }
  if (s.new_count === 0 || !s.newest) return { text: `최근 ${badgeDays}일 안에 새로 올라온 곳은 없어요.` };
  return {
    text: `최근 ${badgeDays}일 안에 새로 올라온 곳은 ${s.new_count.toLocaleString("ko-KR")}곳이에요. 가장 최근 곳은 ${place(s.newest)}(월세+관리비 ${won(s.newest.monthly ?? 0)}만원)이에요.`,
    listing: s.newest,
  };
}
