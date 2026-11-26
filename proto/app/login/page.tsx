// 로그인 화면: 카카오 또는 이메일로 로그인/가입
import { SiteLogo } from "@/app/_components/site-logo";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

async function LoginFormWithError({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return <LoginForm initialError={typeof error === "string" ? error : undefined} />;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <SiteLogo />
      <div className="card flex w-full max-w-md flex-col gap-6 p-6 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-medium">로그인</h1>
          <p className="text-sm text-muted">{process.env.NEXT_PUBLIC_SOCIAL_LOGIN === "on" ? "SNS 계정 또는 이메일로 시작하세요." : "이메일로 시작하세요."}</p>
        </div>
        <Suspense fallback={<LoginForm />}>
          <LoginFormWithError {...props} />
        </Suspense>
      </div>
    </main>
  );
}
