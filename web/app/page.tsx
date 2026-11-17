// 첫 화면: 서비스 이름과 Supabase 연결 상태를 보여준다.
import { Suspense } from "react";

type Status = { ok: boolean; message: string };

async function checkSupabase(): Promise<Status> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return { ok: false, message: ".env.local 에 Supabase 값이 아직 없습니다." };
  }

  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: "no-store",
    });
    return res.ok
      ? { ok: true, message: "Supabase 연결 정상" }
      : { ok: false, message: `Supabase 응답 오류 (코드 ${res.status})` };
  } catch {
    return { ok: false, message: "Supabase 주소에 접속할 수 없습니다." };
  }
}

async function SupabaseStatus() {
  const status = await checkSupabase();

  return (
    <p
      className={`rounded-full px-4 py-2 text-sm font-medium ${
        status.ok
          ? "bg-green-100 text-green-800"
          : "bg-amber-100 text-amber-800"
      }`}
    >
      {status.ok ? "●" : "○"} {status.message}
    </p>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-bold">대구 공실 매칭</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        업종에 맞는 대구 공실을 추천하는 AI 서비스 (개발 중)
      </p>
      <Suspense fallback={<p className="text-sm text-zinc-500">연결 확인 중…</p>}>
        <SupabaseStatus />
      </Suspense>
    </main>
  );
}
