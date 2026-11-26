"use server";
// AI 상담견 공실이: 대화로 고른 조건으로 미리 검색해서 몇 곳인지 알려 준다(점수는 아직 없다).
import { filtersToQuery, type InterpretedFilters } from "@/lib/ai/search-text";
import { consumeAi, getAiStatus } from "@/lib/ai/usage";
import { RANGES, SQM_PER_PYEONG } from "@/lib/search/ranges";
import { FLOOR_OPTIONS, SORTS, searchListings, type SortKey } from "@/lib/search/listings";

export type GongsilChoice = { rent: number | null; gu: string | null; area: [number | null, number | null] | null };
/** 공실이가 묻지 않지만 화면에 이미 걸려 있는 조건(층·보증금). 몇 곳인지 셀 때 함께 넣어 화면과 숫자를 맞춘다. */
export type GongsilKeep = { floors: string[]; deposit_max: number | null; sort?: string | null };
export type GongsilResult =
  | { ok: true; total: number; href: string; first: { place: string; deposit: number | null; rent: number | null } | null; remaining: number | null }
  | { ok: false; href: string; reason?: "limit" };

export type GongsilStart = { ok: boolean; guest: boolean; remaining: number | null; limit: number | null; period: "total" | "day" };

// 대화를 시작하기 전에 남은 횟수를 본다(차감 없음).
export async function gongsilStart(): Promise<GongsilStart> {
  const status = await getAiStatus();
  return { ok: status.ok, guest: status.tier === "guest", remaining: status.remaining, limit: status.limit, period: status.period };
}

const GU = ["중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군"];
const toSqm = (pyeong: number) => Math.round(pyeong * SQM_PER_PYEONG);

export async function gongsilFind(choice: GongsilChoice, keep: GongsilKeep = { floors: [], deposit_max: null }): Promise<GongsilResult> {
  const filters: InterpretedFilters = { gu: [], dong: [], floors: [] };
  const floors = (Array.isArray(keep.floors) ? keep.floors : []).filter((key) => FLOOR_OPTIONS.some((option) => option.key === key));
  const deposit = typeof keep.deposit_max === "number" && keep.deposit_max > 0 && keep.deposit_max < RANGES.deposit.max ? Math.round(keep.deposit_max) : undefined;
  if (choice.gu && GU.includes(choice.gu)) filters.gu = [choice.gu];
  if (typeof choice.rent === "number" && choice.rent > 0 && choice.rent < RANGES.rent.max) filters.rent_max = Math.round(choice.rent);
  if (choice.area) {
    const [min, max] = choice.area;
    if (typeof min === "number" && min > RANGES.area.min) filters.area_min = toSqm(min);
    if (typeof max === "number" && max < RANGES.area.max) filters.area_max = toSqm(max);
  }
  const href = filtersToQuery(filters);

  try {
    const result = await searchListings(
      { gu: filters.gu, dong: [], floors, rent_max: filters.rent_max, deposit_max: deposit, area_min: filters.area_min, area_max: filters.area_max },
      SORTS.some((option) => option.key === keep.sort) ? (keep.sort as SortKey) : "recommended",
      0,
    );
    if (result.error || result.rate_limited || result.total === null) return { ok: false, href };
    const card = result.items[0];
    // 결과를 보여 줄 때 1회 차감한다. 맞는 매물이 0곳이면 차감하지 않는다.
    let remaining: number | null = null;
    if (result.total > 0) {
      const used = await consumeAi("ai4_assistant");
      if (!used.ok) return { ok: false, href, reason: "limit" };
      remaining = used.remaining;
    } else {
      remaining = (await getAiStatus()).remaining;
    }
    return {
      ok: true,
      total: result.total,
      remaining,
      href,
      first: card ? { place: `${card.gu} ${card.dong}${card.floor ? ` ${card.floor}` : ""}`, deposit: card.deposit, rent: card.rent } : null,
    };
  } catch {
    return { ok: false, href };
  }
}
