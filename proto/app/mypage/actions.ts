"use server";
// 마이페이지의 서버 동작: 내 정보 수정, 프로필 사진 삭제, 선택 동의 철회·재동의
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";
import { createClient } from "@/lib/supabase/server";

export type MypageState = { error?: string; message?: string };

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_NAME_LENGTH = 30;
const SAVE_ERROR = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  return { supabase, userId };
}

export async function updateProfile(
  _prev: MypageState,
  formData: FormData,
): Promise<MypageState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim();

  if (displayName.length > MAX_NAME_LENGTH) {
    return { error: `이름은 ${MAX_NAME_LENGTH}자 이내로 입력해 주세요.` };
  }
  if (contactEmail && !EMAIL_PATTERN.test(contactEmail)) {
    return { error: "메일 수신 주소를 정확히 입력해 주세요." };
  }

  const { supabase, userId } = await requireUser();

  // 주소를 지우면 메일을 보낼 수 없으므로 메일 수신 동의도 함께 철회한다.
  if (!contactEmail) {
    const { error } = await supabase
      .from("user_consents")
      .update({ withdrawn_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("consent_type", "email")
      .is("withdrawn_at", null);
    if (error) return { error: SAVE_ERROR };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName || null,
      contact_email: contactEmail || null,
    })
    .eq("id", userId);
  if (error) return { error: SAVE_ERROR };

  revalidatePath("/mypage");
  return { message: "저장했습니다." };
}

export async function removeAvatar(): Promise<void> {
  const { supabase, userId } = await requireUser();
  await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId);
  revalidatePath("/mypage");
}

export async function changeOptionalConsent(
  _prev: MypageState,
  formData: FormData,
): Promise<MypageState> {
  const type = formData.get("type");
  if (type !== "behavior_tracking" && type !== "email") {
    return { error: SAVE_ERROR };
  }

  const { supabase, userId } = await requireUser();

  if (formData.get("agree") !== "true") {
    const { error } = await supabase
      .from("user_consents")
      .update({ withdrawn_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("consent_type", type)
      .is("withdrawn_at", null);
    if (error) return { error: SAVE_ERROR };

    revalidatePath("/mypage");
    return { message: "동의를 철회했습니다." };
  }

  if (type === "email") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("contact_email")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.contact_email) {
      return { error: "메일 수신 주소를 먼저 저장해 주세요." };
    }
  }

  const { error } = await supabase.from("user_consents").insert({
    user_id: userId,
    consent_type: type,
    document_version: LEGAL_VERSIONS[type],
  });
  if (error) return { error: SAVE_ERROR };

  revalidatePath("/mypage");
  return { message: "동의했습니다." };
}
