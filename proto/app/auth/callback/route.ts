// 카카오 로그인, 이메일 인증 링크를 누른 뒤 돌아오는 주소
// Supabase가 붙여 준 code 를 로그인 세션(쿠키)으로 바꾼다.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  // 외부 주소로 튕기지 않도록 우리 사이트 안의 경로만 허용
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  const reason =
    searchParams.get("error_description") ?? "로그인 처리 중 문제가 생겼습니다.";
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(reason)}`,
  );
}
