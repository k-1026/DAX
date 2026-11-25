// 추천 패널 위쪽 요약용 집계 (서버 전용). 회원은 본인 로그인으로, 비로그인은 서버가 대신 부른다(개별 매물은 DB가 막는다).
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { SearchFilters } from "./listings";

export type SummaryListing = {
  id: string;
  gu: string | null;
  dong: string | null;
  floor: string | null;
  rent: number | null;
  monthly: number | null;
  deposit: number | null;
  area: number | null;
};

export type SearchSummary = {
  total: number;
  by_gu: { name: string; count: number }[];
  by_dong: { name: string; count: number }[];
  monthly_p25: number | null;
  monthly_median: number | null;
  monthly_p75: number | null;
  new_count: number;
  cheapest?: SummaryListing | null;
  widest?: SummaryListing | null;
  newest?: SummaryListing | null;
};

export async function getSearchSummary(filters: SearchFilters): Promise<{ summary: SearchSummary | null; guest: boolean }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const guest = !auth?.claims;
  const client = guest ? createServiceClient() : supabase;
  if (!client) return { summary: null, guest };
  const { data, error } = await client.rpc("search_summary", { p_filters: filters });
  if (error || !data) return { summary: null, guest };
  return { summary: data as SearchSummary, guest };
}
