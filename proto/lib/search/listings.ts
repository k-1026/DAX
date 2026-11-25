// 매물 검색 (서버 전용). 등급별 범위는 DB 함수 search_listings가 정한다.
// 로그인 회원은 본인 로그인으로, 비로그인은 서버가 IP 제한을 걸어 대신 호출한다.
import "server-only";
import { guestIpHash, signDetailToken } from "@/lib/net/guest";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { RANGES } from "./ranges";

export const SORTS = [
  { key: "recommended", label: "추천순" },
  { key: "rent", label: "월세 낮은 순" },
  { key: "deposit", label: "보증금 낮은 순" },
  { key: "area", label: "넓은 순" },
  { key: "recent", label: "최근 확인순" },
] as const;

export type SortKey = (typeof SORTS)[number]["key"];

export const FLOOR_OPTIONS = [
  { key: "ground1", label: "1층" },
  { key: "upper", label: "지상 2층 이상" },
  { key: "basement", label: "지하" },
] as const;

export type SearchFilters = {
  gu: string[];
  dong: string[];
  floors: string[];
  rent_max?: number;
  deposit_max?: number;
  area_min?: number;
  area_max?: number;
};

export type ListingCard = {
  id: string;
  gu: string;
  dong: string;
  floor: string | null;
  total_floors: string | null;
  area_m2: number | null;
  deposit: number | null;
  rent: number | null;
  maintenance_fee: number | null;
  property_type: string | null;
  subtype: string | null;
  building_name: string | null;
  current_use: string | null;
  recommended_use: string | null;
  confirmed_at: string | null;
  checked_at: string;
  source: string;
  score: number | null;
  is_new: boolean;
  price_changed: boolean;
  needs_check: boolean;
  /** 비로그인에게 보여 준 매물에만 붙는 상세 열람 표시 */
  detail_token?: string;
};

export type SearchResult = {
  tier: "guest" | "member" | "subscriber" | "admin";
  total: number | null;
  offset: number;
  page_size: number;
  sort: SortKey;
  has_scores: boolean;
  items: ListingCard[];
  rate_limited: boolean;
  error?: string;
};

const list = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean).slice(0, 50);

const amount = (value: string | string[] | undefined) => {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 && number < 1_000_000 ? number : undefined;
};

const below = (value: number | undefined, limit: number) => (value !== undefined && value < limit ? value : undefined);
const above = (value: number | undefined, limit: number) => (value !== undefined && value > limit ? value : undefined);

// 주소창의 값은 믿지 않고 범위를 확인한 뒤에만 쓴다.
export function parseSearchParams(params: Record<string, string | string[] | undefined>) {
  const filters: SearchFilters = {
    gu: list(params.gu),
    dong: list(params.dong),
    floors: list(params.floors).filter((key) => FLOOR_OPTIONS.some((option) => option.key === key)),
    // 슬라이더를 끝까지 민 값은 "제한 없음"으로 본다.
    rent_max: below(amount(params.rent_max), RANGES.rent.max),
    deposit_max: below(amount(params.deposit_max), RANGES.deposit.max),
    area_min: above(amount(params.area_min), RANGES.area.min),
    area_max: below(amount(params.area_max), RANGES.area.max),
  };
  const sortText = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  const sort: SortKey = SORTS.some((option) => option.key === sortText)
    ? (sortText as SortKey)
    : "recommended";
  const offset = Math.min(Math.max(amount(params.offset) ?? 0, 0), 100_000);
  return { filters, sort, offset: Math.floor(offset) };
}

const FAILED: SearchResult = {
  tier: "guest",
  total: null,
  offset: 0,
  page_size: 0,
  sort: "recommended",
  has_scores: false,
  items: [],
  rate_limited: false,
  error: "search_failed",
};

export async function searchListings(
  filters: SearchFilters,
  sort: SortKey,
  offset: number,
): Promise<SearchResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const args = { p_filters: filters, p_sort: sort, p_offset: offset };

  if (auth?.claims) {
    const { data, error } = await supabase.rpc("search_listings", args);
    if (error || !data) return FAILED;
    return data as SearchResult;
  }

  const service = createServiceClient();
  const ipHash = await guestIpHash();
  if (!service || !ipHash) return FAILED;
  const { data, error } = await service.rpc("search_listings", { ...args, p_ip_hash: ipHash });
  if (error || !data) return FAILED;
  const result = data as SearchResult;
  result.items = result.items.map((item) => ({ ...item, detail_token: signDetailToken(item.id) ?? undefined }));
  return result;
}

export type MapPoint = { id: string; lat: number; lng: number };

// 회원은 본인 로그인으로, 비로그인은 서버가 목록에 보여 준 매물(3곳) 좌표만 대신 가져온다.
export async function getMapPoints(ids: string[], guest: boolean): Promise<MapPoint[] | null> {
  if (ids.length === 0) return [];
  const client = guest ? createServiceClient() : await createClient();
  if (!client) return null;
  const { data, error } = await client.rpc(guest ? "guest_map_points" : "listing_map_points", {
    p_ids: ids.slice(0, 50),
  });
  if (error) return null;
  return (data ?? []) as MapPoint[];
}

export async function getAreas(): Promise<Record<string, string[]>> {
  const service = createServiceClient();
  if (!service) return {};
  const { data } = await service.rpc("search_areas");
  const areas = (data ?? {}) as Record<string, string[]>;
  for (const gu of Object.keys(areas)) areas[gu] = [...areas[gu]].sort((a, b) => a.localeCompare(b, "ko"));
  return areas;
}
