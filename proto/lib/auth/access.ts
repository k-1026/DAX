// 현재 사용자의 등급과 한도를 서버에서 확인한다.
// 등급과 한도는 DB의 my_access() 결과만 사용한다. 화면에서 보낸 값은 믿지 않는다.
import { createClient } from "@/lib/supabase/server";

export type Tier = "guest" | "member" | "subscriber" | "admin";

export type Access = {
  tier: Tier;
  /** null이면 제한 없음 */
  listing_limit: number | null;
  saved_limit: number | null;
  compare_limit: number | null;
  ai_limit: number | null;
  ai_period: "total" | "day";
  early_access: boolean;
};

export const TIER_LABELS: Record<Tier, string> = {
  guest: "비로그인",
  member: "로그인 회원",
  subscriber: "구독 회원",
  admin: "관리자",
};

// 등급을 확인하지 못하면 가장 낮은 권한으로 처리한다.
const NO_ACCESS: Access = {
  tier: "guest",
  listing_limit: 0,
  saved_limit: 0,
  compare_limit: 0,
  ai_limit: 0,
  ai_period: "total",
  early_access: false,
};

export async function getAccess(): Promise<Access> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_access");
  if (error || !data) return NO_ACCESS;
  return data as Access;
}
