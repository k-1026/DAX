// 로그인 화면: 카카오 또는 이메일로 로그인/가입
import { Suspense } from "react";
import { LoginForm } from "./login-form";

async function LoginFormWithError({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return <LoginForm initialError={typeof error === "string" ? error : undefined} />;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">대구 공실 매칭 로그인</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          SNS 계정 또는 이메일로 시작하세요.
        </p>
      </div>
      <Suspense fallback={<LoginForm />}>
        <LoginFormWithError {...props} />
      </Suspense>
    </main>
  );
}
