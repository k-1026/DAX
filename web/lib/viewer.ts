// 지금 화면을 보는 사람이 누구인지(비회원 / 회원 / 관리자) 알려주는 도구
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type Viewer = {
  loggedIn: boolean;
  name: string;
  email?: string;
  isAdmin: boolean;
  previewNote?: string; // 개발용 미리보기일 때 화면에 띄울 안내
  previewAs?: string; // 개발용 미리보기 값 (추천 API에도 그대로 전달)
};

const GUEST: Viewer = { loggedIn: false, name: "게스트", isAdmin: false };

function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 개발 중(npm run dev)에는 ?as=member / ?as=admin 으로 로그인 없이 화면을 미리 볼 수 있다.
 * 배포(production)에서는 이 값이 무시된다.
 */
export async function getViewer(previewAs?: string): Promise<Viewer> {
  const isDev = process.env.NODE_ENV === "development";
  if (isDev && previewAs === "member") {
    return { loggedIn: true, name: "미리보기 회원", isAdmin: false, previewNote: "개발 미리보기: 회원 화면", previewAs };
  }
  if (isDev && previewAs === "admin") {
    return { loggedIn: true, name: "미리보기 관리자", isAdmin: true, previewNote: "개발 미리보기: 관리자 화면", previewAs };
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return GUEST;

  // 로그인 정보는 사람마다 다르므로 요청 때마다 확인한다.
  // (없으면 로그인 상태에서 Date.now() 미리 렌더링 오류가 난다)
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return GUEST;

  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const email = typeof claims.email === "string" ? claims.email : undefined;
  const name =
    (meta.name as string) ?? (meta.full_name as string) ?? email?.split("@")[0] ?? "회원";

  return {
    loggedIn: true,
    name,
    email,
    isAdmin: !!email && adminEmails().includes(email.toLowerCase()),
  };
}
