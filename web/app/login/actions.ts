"use server";
// 로그인 관련 서버 동작: 이메일 로그인/가입, SNS(카카오·구글) 로그인, 로그아웃
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; message?: string };

async function getOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function readForm(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

const ERROR_KO: Record<string, string> = {
  "Invalid login credentials": "이메일 또는 비밀번호가 맞지 않습니다.",
  "Email not confirmed": "메일함에서 인증 링크를 먼저 눌러 주세요.",
  "User already registered": "이미 가입된 이메일입니다. 로그인해 주세요.",
};

function toKorean(message: string) {
  return ERROR_KO[message] ?? message;
}

export async function signInWithEmail(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { email, password } = readForm(formData);
  if (!email || !password) return { error: "이메일과 비밀번호를 입력해 주세요." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: toKorean(error.message) };

  redirect("/");
}

export async function signUpWithEmail(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { email, password } = readForm(formData);
  if (!email || !password) return { error: "이메일과 비밀번호를 입력해 주세요." };
  if (password.length < 6) return { error: "비밀번호는 6자 이상이어야 합니다." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await getOrigin()}/auth/callback` },
  });
  if (error) return { error: toKorean(error.message) };

  // Supabase에서 "Confirm email"을 꺼 두면 바로 로그인된다.
  if (data.session) redirect("/");

  return { message: "인증 메일을 보냈습니다. 메일함에서 링크를 눌러 주세요." };
}

// SNS 로그인 버튼 종류
// (네이버는 회원 정보 형식이 Supabase와 맞지 않아 제외했다)
const SOCIAL_PROVIDERS = {
  kakao: { provider: "kakao", label: "카카오" },
  google: { provider: "google", label: "구글" },
} as const;

export type SocialProvider = keyof typeof SOCIAL_PROVIDERS;

export async function signInWithSocial(formData: FormData) {
  const key = String(formData.get("provider")) as SocialProvider;
  const target = SOCIAL_PROVIDERS[key];
  if (!target) redirect("/login");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: target.provider,
    options: { redirectTo: `${await getOrigin()}/auth/callback` },
  });
  if (error || !data.url) {
    redirect(
      `/login?error=${encodeURIComponent(`${target.label} 로그인을 시작할 수 없습니다.`)}`,
    );
  }
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
