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
  await removeOldAvatars(supabase, userId);
  revalidatePath("/mypage");
  revalidatePath("/");
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

// 선호 조건 1세트 저장 (지역, 금액, 면적). 비워 둔 칸은 조건 없음.
export async function savePreferences(
  _prev: MypageState,
  formData: FormData,
): Promise<MypageState> {
  const filters: Record<string, unknown> = {
    gu: formData.getAll("gu").map(String).filter(Boolean).slice(0, 20),
  };
  for (const key of ["rent_max", "deposit_max", "area_min", "area_max"]) {
    const text = String(formData.get(key) ?? "").trim();
    if (!text) continue;
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0 || value >= 1_000_000) {
      return { error: "금액과 면적은 0 이상의 숫자로 입력해 주세요." };
    }
    filters[key] = value;
  }

  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("set_my_preferences", { p_filters: filters });
  if (error || !(data as { ok?: boolean } | null)?.ok) return { error: SAVE_ERROR };
  revalidatePath("/mypage");
  return { message: "선호 조건을 저장했습니다." };
}

const AVATAR_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

// 프로필 사진 올리기: JPG·PNG·WebP, 2MB 이하. 새로 올리면 이전 사진은 지운다.
export async function uploadAvatar(_prev: MypageState, formData: FormData): Promise<MypageState> {
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { error: "사진 파일을 골라 주세요." };
  const ext = AVATAR_TYPES[file.type];
  if (!ext) return { error: "JPG, PNG, WebP 사진만 올릴 수 있어요." };
  if (file.size > AVATAR_MAX_BYTES) return { error: "사진은 2MB 이하만 올릴 수 있어요." };

  const { supabase, userId } = await requireUser();
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type });
  if (uploadError) return { error: "사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요." };

  const { data: publicUrl } = supabase.storage.from("avatars").getPublicUrl(path);
  const { error } = await supabase.from("profiles").update({ avatar_url: publicUrl.publicUrl }).eq("id", userId);
  if (error) {
    await supabase.storage.from("avatars").remove([path]);
    return { error: SAVE_ERROR };
  }

  await removeOldAvatars(supabase, userId, path);
  revalidatePath("/mypage");
  revalidatePath("/");
  return { message: "프로필 사진을 바꿨어요." };
}

// 방금 올린 파일(keep)만 남기고 내 폴더의 이전 사진을 지운다. 실패해도 사용에는 영향이 없다.
async function removeOldAvatars(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, keep?: string) {
  const { data } = await supabase.storage.from("avatars").list(userId);
  const old = (data ?? []).map((item) => `${userId}/${item.name}`).filter((name) => name !== keep);
  if (old.length > 0) await supabase.storage.from("avatars").remove(old);
}

export type FeedbackItem = {
  id: string;
  listing_id: string;
  rating: "good" | "bad";
  bad_reasons: string[];
  review: string | null;
  created_at: string;
  gu: string | null;
  dong: string | null;
  floor: string | null;
};
export type FeedbackPage = { total: number; items: FeedbackItem[] };

// 내 평가 목록 한 쪽 (최신순)
export async function loadMyFeedback(offset: number, limit = 5): Promise<FeedbackPage | null> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("my_feedback_list", {
    p_limit: limit,
    p_offset: Math.max(0, Math.floor(offset)),
  });
  if (error || !data) return null;
  return data as FeedbackPage;
}

// 내 평가 하나 삭제 (본인 것만: DB 규칙이 막는다)
export async function deleteMyFeedback(id: string): Promise<boolean> {
  // user_id 칸은 읽기 권한이 없어 조건에 쓰지 않는다. 본인 평가만 지워지는 것은 DB 규칙이 보장한다.
  const { supabase } = await requireUser();
  const { error } = await supabase.from("listing_feedback").delete().eq("id", id);
  if (error) return false;
  revalidatePath("/mypage");
  return true;
}
