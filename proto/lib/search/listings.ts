// 매물 검색 (서버 전용). 등급별 범위는 DB 함수 search_listings가 정한다.
// 로그인 회원은 본인 로그인으로, 비로그인은 서버가 IP 제한을 걸어 대신 호출한다.
import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const SORTS = [
  { key: "recommended", label: "추천순" },
  { key: "rent", label: "월세 낮은 순" },
  { key: "deposit", label: "보증금 낮은 순" },
  { key: "area", label: "넓은 순" },
  { key: "recent", label: "최근 확인순" },
] as const;

export type SortKey = (typeof SORTS)[number]["key"];

export type SearchFilters = {
  gu: string[];
  dong: string[];
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

// 주소창의 값은 믿지 않고 범위를 확인한 뒤에만 쓴다.
export function parseSearchParams(params: Record<string, string | string[] | undefined>) {
  const filters: SearchFilters = {
    gu: list(params.gu),
    dong: list(params.dong),
    rent_max: amount(params.rent_max),
    deposit_max: amount(params.deposit_max),
    area_min: amount(params.area_min),
    area_max: amount(params.area_max),
  };
  const sortText = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  const sort: SortKey = SORTS.some((option) => option.key === sortText)
    ? (sortText as SortKey)
    : "recommended";
  const offset = Math.min(Math.max(amount(params.offset) ?? 0, 0), 100_000);
  return { filters, sort, offset: Math.floor(offset) };
}

// 비로그인 IP는 비밀값으로 해시해서 넘긴다. 원래 주소는 DB에 남지 않는다.
async function guestIpHash() {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret) return null;
  const list = await headers();
  const ip =
    list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || "unknown";
  return createHmac("sha256", secret).update(ip).digest("hex");
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
  return data as SearchResult;
}

export async function getAreas(): Promise<Record<string, string[]>> {
  const service = createServiceClient();
  if (!service) return {};
  const { data } = await service.rpc("search_areas");
  const areas = (data ?? {}) as Record<string, string[]>;
  for (const gu of Object.keys(areas)) areas[gu] = [...areas[gu]].sort((a, b) => a.localeCompare(b, "ko"));
  return areas;
}
