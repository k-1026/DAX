import type { Tier } from "@/lib/auth/access";

export type SavedData = {
  gu: string | null;
  dong: string | null;
  building_name: string | null;
  address: string | null;
  floor: string | null;
  area_m2: number | null;
  deposit: number | null;
  rent: number | null;
  maintenance_fee: number | null;
  confirmed_at: string | null;
};
export type SavedItem = {
  listing_id: string;
  list_id?: string;
  saved_at?: string;
  available: boolean;
  status?: "active" | "gone" | "sold_out";
  source?: string;
  checked_at?: string;
  data?: SavedData;
  needs_check?: boolean;
  /** 담은 매물 메모(구독 회원이 씀). 구독이 끝나도 읽을 수는 있다. */
  memo?: string | null;
};
export type SavedState = {
  ok: boolean;
  tier: Tier;
  saved_limit: number | null;
  compare_limit: number;
  lists: { id: string; name: string }[];
  items: SavedItem[];
  total: number;
};
export type SavedResult = { ok: boolean; message?: string; id?: string; items?: SavedItem[] };
