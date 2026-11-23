// 매물 상세 (서버 전용). 등급별 범위는 DB 함수 listing_detail이 정한다.
import "server-only";
import { verifyDetailToken } from "@/lib/net/guest";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type ListingDetail = {
  found: true;
  tier: "guest" | "member" | "subscriber" | "admin";
  id: string;
  status: "active" | "gone" | "sold_out";
  source: string;
  checked_at: string;
  gone_at: string | null;
  stale_days: number;
  data: {
    gu: string;
    dong: string;
    floor: string | null;
    total_floors: string | null;
    area_m2: number | null;
    supply_area_m2: number | null;
    deposit: number | null;
    rent: number | null;
    maintenance_fee: number | null;
    property_type: string | null;
    subtype: string | null;
    building_name: string | null;
    current_use: string | null;
    recommended_use: string | null;
    approval_date: string | null;
    posted_at: string | null;
    confirmed_at: string | null;
    features: string | null;
    station_distance_m: number | null;
    bus_stop_distance_m: number | null;
    url: string | null;
  };
  flags: { signal: string; reason: string }[];
  my_feedback: {
    rating: "good" | "bad";
    bad_reasons: string[];
    review: string | null;
    masked_count: number;
    updated_at: string;
  } | null;
};

export type DetailResult =
  | ListingDetail
  | { found: false; reason: "not_found" | "login_required" | "error" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getListingDetail(id: string, token?: string): Promise<DetailResult> {
  if (!UUID.test(id)) return { found: false, reason: "not_found" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();

  if (auth?.claims) {
    const { data, error } = await supabase.rpc("listing_detail", { p_listing: id });
    if (error) return { found: false, reason: "error" };
    return data?.found ? (data as ListingDetail) : { found: false, reason: "not_found" };
  }

  // 비로그인은 목록에서 보여 준 매물(확인 표시가 맞는 것)만 연다.
  if (!verifyDetailToken(id, token)) return { found: false, reason: "login_required" };
  const service = createServiceClient();
  if (!service) return { found: false, reason: "error" };
  const { data, error } = await service.rpc("listing_detail", { p_listing: id });
  if (error) return { found: false, reason: "error" };
  return data?.found ? (data as ListingDetail) : { found: false, reason: "not_found" };
}

// 중개사 확인 후 지난 일수 (한국 날짜 기준)
export function daysSince(date: string | null, now = new Date()) {
  if (!date) return null;
  const start = new Date(date.length === 10 ? `${date}T00:00:00+09:00` : date);
  if (Number.isNaN(start.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
}
