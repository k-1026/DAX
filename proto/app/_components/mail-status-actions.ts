"use server";

// 스튜디오 "추천 메일 받기" 패널용: 내 메일 발송 준비 상태를 알려 준다(보내지는 않는다).
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export type MailStatus =
  | { ok: false }
  | { ok: true; tier: string; hasConsent: boolean; hasAddress: boolean; hasFilters: boolean; total: number; sentAt: string | null };

export async function getMailStatus(): Promise<MailStatus> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getClaims();
    const claims = auth?.claims;
    if (!claims) return { ok: false };
    const [access, { data: preview }, { data: profile }, { data: consents }] = await Promise.all([
      getAccess(),
      supabase.rpc("my_first_mail_preview"),
      supabase.from("profiles").select("contact_email").eq("id", claims.sub).maybeSingle(),
      supabase.from("user_consents").select("consent_type").eq("user_id", claims.sub).eq("consent_type", "email").is("withdrawn_at", null),
    ]);
    const p = (preview ?? { filters: {}, sent_at: null, total: 0 }) as { filters: Record<string, unknown>; sent_at: string | null; total: number };
    return {
      ok: true,
      tier: access.tier,
      hasConsent: (consents ?? []).length > 0,
      hasAddress: Boolean(profile?.contact_email),
      hasFilters: Object.keys(p.filters ?? {}).length > 0,
      total: p.total ?? 0,
      sentAt: p.sent_at,
    };
  } catch {
    return { ok: false };
  }
}
