// 모든 페이지 요청 전에 실행: 시험 사이트 입장 확인 → 로그인 상태(쿠키)를 최신으로 유지한다.
import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateExempt, gatePassword, gateToken } from "@/lib/gate";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // 시험 사이트 입장 비밀번호(SITE_GATE_PASSWORD가 있을 때만)
  const password = gatePassword();
  const { pathname, search } = request.nextUrl;
  if (password && !gateExempt(pathname)) {
    const cookie = request.cookies.get(GATE_COOKIE)?.value;
    if (cookie !== (await gateToken(password))) {
      const url = request.nextUrl.clone();
      url.pathname = "/gate";
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // 이미지·CSS 같은 정적 파일은 제외
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
