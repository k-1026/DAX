"use server";
// 문제 신고. 회원은 본인 로그인으로, 비로그인은 서버가 IP 해시와 함께 대신 보낸다.
// 결제·개인정보·장애 신고는 5분 점검이 관리자에게 바로 알린다.
import { guestIpHash } from "@/lib/net/guest";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type ReportState = { ok: boolean; message: string } | null;

const KINDS = ["payment", "privacy", "outage", "listing_error", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERRORS: Record<string, string> = {
  kind: "신고 종류를 골라 주세요.",
  empty: "내용을 적어 주세요.",
  too_long: "내용이 너무 깁니다.",
  listing: "매물을 찾을 수 없습니다.",
  rate_limited: "오늘은 신고를 더 받을 수 없습니다. 로그인하면 계속 신고할 수 있어요.",
};

export async function submitReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  // 사람에게는 보이지 않는 칸. 로봇이 채우면 받은 척하고 저장하지 않는다.
  if (String(formData.get("website") ?? "") !== "") return { ok: true, message: "신고를 받았습니다." };

  const kind = String(formData.get("kind") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const listingText = String(formData.get("listing_id") ?? "");
  const listing = UUID.test(listingText) ? listingText : null;
  if (!KINDS.includes(kind)) return { ok: false, message: ERRORS.kind };
  if (!body) return { ok: false, message: ERRORS.empty };

  const args = { p_kind: kind, p_body: body, p_listing: listing };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();

  let result: { ok: boolean; error?: string; max?: number } | null = null;
  if (auth?.claims) {
    const { data, error } = await supabase.rpc("submit_problem_report", args);
    result = error ? null : data;
  } else {
    const service = createServiceClient();
    const ipHash = await guestIpHash();
    if (service && ipHash) {
      const { data, error } = await service.rpc("submit_problem_report", { ...args, p_ip_hash: ipHash });
      result = error ? null : data;
    }
  }

  if (!result) return { ok: false, message: "신고를 보내지 못했습니다. 잠시 후 다시 시도해 주세요." };
  if (!result.ok) {
    const message = result.error === "too_long" ? `내용은 ${result.max}자까지 쓸 수 있습니다.` : ERRORS[result.error ?? ""];
    return { ok: false, message: message ?? "신고를 보내지 못했습니다." };
  }
  return { ok: true, message: "신고를 받았습니다. 확인 후 고치겠습니다. 개인정보는 가려서 저장됩니다." };
}
