// 요청이 들어올 때마다 로그인 쿠키(세션)를 새로 고쳐 주는 도구
// proxy.ts 에서 불러 쓴다.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
  await supabase.auth.getClaims();

  return response;
}
