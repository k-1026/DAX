// 로그인 화면: SNS(카카오·구글) 또는 이메일로 로그인/가입
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

async function LoginFormWithError({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return <LoginForm initialError={typeof error === "string" ? error : undefined} />;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-8 rounded-3xl border border-line bg-panel px-6 py-10 text-center sm:px-10">
        <div className="flex flex-col items-center gap-3">
          <span className="grid size-12 place-items-center rounded-full bg-brand text-xl text-brand-ink">📍</span>
          <h1 className="text-2xl font-medium">대구 공실 매칭</h1>
          <p className="text-sm text-muted">
            로그인하면 전체 추천, 점수 근거, 관심 매물 저장,
            <br />
            새 매물 추천 메일을 받을 수 있어요.
          </p>
        </div>
        <Suspense fallback={<LoginForm />}>
          <LoginFormWithError {...props} />
        </Suspense>
        <Link href="/" className="text-sm text-muted hover:text-ink">로그인 없이 둘러보기</Link>
      </div>
    </main>
  );
}
