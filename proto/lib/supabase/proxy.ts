// 요청이 들어올 때마다 로그인 쿠키(세션)를 새로 고쳐 주는 도구
// proxy.ts 에서 불러 쓴다.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

// 필수 동의 전에도 열 수 있는 경로
const CONSENT_EXEMPT_PATHS = [
  "/consent",
  "/terms",
  "/privacy",
  "/login",
  "/auth",
  "/unsubscribe",
  "/withdrawn",
];

function needsConsentCheck(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const { pathname } = request.nextUrl;
  return !CONSENT_EXEMPT_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // .env.local 값이 없으면 사이트가 멈추지 않도록 그냥 통과시킨다.
  if (!url || !key) return response;

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // 이 호출이 만료된 로그인 토큰을 갱신한다. 지우지 말 것.
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims || !needsConsentCheck(request)) return response;

  // 로그인한 회원이 필수 동의를 마치지 않았으면 동의 화면으로 보낸다.
  const { data: completed, error } = await supabase.rpc("has_required_consents", {
    terms_version: LEGAL_VERSIONS.terms,
    privacy_version: LEGAL_VERSIONS.privacy,
  });
  if (error) {
    // 확인에 실패해도 사이트 전체가 멈추지 않도록 통과시키고 기록만 남긴다.
    console.error("필수 동의 확인 실패:", error.message);
    return response;
  }
  if (completed) return response;

  const target = request.nextUrl.clone();
  const nextUrl = request.nextUrl.clone();
  nextUrl.searchParams.delete("_rsc");
  target.pathname = "/consent";
  target.search = "";
  target.searchParams.set("next", `${nextUrl.pathname}${nextUrl.search}`);

  const redirectResponse = NextResponse.redirect(target);
  response.cookies
    .getAll()
    .forEach((cookie) => redirectResponse.cookies.set(cookie));
  return redirectResponse;
}
