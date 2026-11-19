// 서버 전용 Supabase 연결. 파이프라인처럼 사용자 권한 밖의 작업에만 쓴다.
// 서비스 키는 절대 화면 코드에서 불러오면 안 된다.
import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
