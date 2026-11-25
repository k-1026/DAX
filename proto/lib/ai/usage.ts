// AI 사용 횟수 확인·차감 (서버 전용). 회원은 본인 로그인으로, 비로그인은 서버가 접속지 값을 넣어 대신 부른다.
import "server-only";
import { guestIpHash } from "@/lib/net/guest";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type AiStatus = {
  ok: boolean;
  tier: "guest" | "member" | "subscriber" | "admin";
  /** null이면 제한 없음 */
  limit: number | null;
  remaining: number | null;
  period: "total" | "day";
};

type Caller = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>; guestHash: string | null; guest: boolean };

async function caller(): Promise<Caller | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (auth?.claims) {
    return { rpc: (name, args) => supabase.rpc(name, args), guestHash: null, guest: false };
  }
  const service = createServiceClient();
  const guestHash = await guestIpHash();
  if (!service || !guestHash) return null;
  return { rpc: (name, args) => service.rpc(name, args), guestHash, guest: true };
}

const UNKNOWN: AiStatus = { ok: false, tier: "guest", limit: 0, remaining: 0, period: "total" };

export async function getAiStatus(): Promise<AiStatus> {
  const c = await caller();
  if (!c) return UNKNOWN;
  const { data, error } = await c.rpc("ai_status", { p_guest_hash: c.guestHash });
  const value = data as { tier?: AiStatus["tier"]; limit?: number | null; remaining?: number | null; period?: AiStatus["period"]; error?: string } | null;
  if (error || !value || value.error) return UNKNOWN;
  return { ok: true, tier: value.tier ?? "guest", limit: value.limit ?? null, remaining: value.remaining ?? null, period: value.period ?? "day" };
}

// 1회 차감. 한도를 넘었으면 ok=false.
export async function consumeAi(feature: "ai1_search_text" | "ai2_explain" | "ai3_compare" | "ai4_assistant"): Promise<{ ok: boolean; remaining: number | null; reason?: string }> {
  const c = await caller();
  if (!c) return { ok: false, remaining: 0, reason: "unavailable" };
  const { data, error } = await c.rpc("ai_use", { p_feature: feature, p_guest_hash: c.guestHash });
  const value = data as { ok?: boolean; remaining?: number | null; reason?: string } | null;
  if (error || !value) return { ok: false, remaining: 0, reason: "unavailable" };
  return { ok: Boolean(value.ok), remaining: value.remaining ?? null, reason: value.reason };
}
