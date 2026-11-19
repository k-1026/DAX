// 첫 화면: 서비스 이름, Supabase 연결 상태, 로그인 상태를 보여준다.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

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

async function UserStatus() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;

  // 로그인 상태는 요청할 때마다 확인한다.
  await connection();

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) {
    return (
      <Link
        href="/login"
        className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        로그인 / 회원가입
      </Link>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", claims.sub)
    .maybeSingle();
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    profile?.display_name ??
    (meta.name as string) ??
    (meta.full_name as string) ??
    claims.email ??
    "회원";

  return (
    <div className="flex items-center gap-3 text-sm">
      <span>{name} 님, 환영합니다.</span>
      <Link href="/mypage" className="underline">
        마이페이지
      </Link>
      <form action={signOut}>
        <button type="submit" className="text-zinc-600 underline dark:text-zinc-400">
          로그아웃
        </button>
      </form>
    </div>
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
      <Suspense fallback={null}>
        <UserStatus />
      </Suspense>
    </main>
  );
}
