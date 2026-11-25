"use server";
// 동의 화면의 서버 동작: 동의 내용을 검증하고 저장한다.
import { redirect } from "next/navigation";
import { LEGAL_VERSIONS, toSafePath } from "@/lib/legal/versions";
import { createClient } from "@/lib/supabase/server";

export type ConsentState = { error?: string };

type ConsentType = keyof typeof LEGAL_VERSIONS;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SAVE_ERROR = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";

export async function saveConsents(
  _prev: ConsentState,
  formData: FormData,
): Promise<ConsentState> {
  const checked = (name: string) => formData.get(name) === "on";
  const wantsEmail = checked("email");
  const contactEmail = String(formData.get("contactEmail") ?? "").trim();

  if (!checked("age14") || !checked("terms") || !checked("privacy")) {
    return { error: "필수 항목에 모두 동의해 주세요." };
  }
  if (wantsEmail && !EMAIL_PATTERN.test(contactEmail)) {
    return { error: "메일을 받을 주소를 정확히 입력해 주세요." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  // 메일 수신 동의는 주소가 저장되어 있어야 등록할 수 있다.
  if (wantsEmail) {
    const { error } = await supabase
      .from("profiles")
      .update({ contact_email: contactEmail })
      .eq("id", userId);
    if (error) return { error: SAVE_ERROR };
  }

  const wanted: ConsentType[] = ["terms", "privacy"];
  if (checked("behavior_tracking")) wanted.push("behavior_tracking");
  if (wantsEmail) wanted.push("email");

  const { data: active, error: readError } = await supabase
    .from("user_consents")
    .select("consent_type, document_version")
    .eq("user_id", userId)
    .is("withdrawn_at", null);
  if (readError) return { error: SAVE_ERROR };

  const missing = wanted.filter(
    (type) =>
      !active?.some(
        (row) =>
          row.consent_type === type && row.document_version === LEGAL_VERSIONS[type],
      ),
  );

  if (missing.length > 0) {
    const { error } = await supabase.from("user_consents").insert(
      missing.map((type) => ({
        user_id: userId,
        consent_type: type,
        document_version: LEGAL_VERSIONS[type],
      })),
    );
    if (error) return { error: SAVE_ERROR };
  }

  const next = toSafePath(formData.get("next"));

  // 이메일로 가입했고 사진이 없고 사진 설정 화면을 본 적이 없으면, 사진 설정 화면을 한 번 보여 준다.
  // (카카오·구글 가입자는 그쪽 프로필 사진이 자동으로 들어온다.)
  const provider = (data?.claims?.app_metadata as { provider?: string } | undefined)?.provider;
  if (provider === "email") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url, avatar_prompted_at")
      .eq("id", userId)
      .maybeSingle();
    if (profile && !profile.avatar_url && !profile.avatar_prompted_at) {
      redirect(`/welcome/avatar?next=${encodeURIComponent(next)}`);
    }
  }

  redirect(next);
}
