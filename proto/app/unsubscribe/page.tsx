// 수신 거부 확인 화면. 로그인 없이 버튼 한 번으로 처리한다.
import { SiteLogo } from "@/app/_components/site-logo";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "수신 거부 | DːON",
  robots: { index: false, follow: false },
};

async function UnsubscribeForm({ searchParams }: PageProps<"/unsubscribe">) {
  const { token } = await searchParams;
  if (typeof token !== "string") {
    return <p className="text-sm text-red-600">수신 거부 링크가 올바르지 않습니다.</p>;
  }

  return (
    <form action={`/api/unsubscribe?token=${encodeURIComponent(token)}`} method="post">
      <button
        type="submit"
        className="rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        수신 거부하기
      </button>
    </form>
  );
}

export default function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <SiteLogo />
      <div className="card flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
        <h1 className="text-xl font-medium">추천 메일 수신 거부</h1>
        <p className="text-sm text-muted">버튼을 누르면 추천 메일을 더 이상 받지 않아요.</p>
        <Suspense fallback={null}>
          <UnsubscribeForm {...props} />
        </Suspense>
      </div>
    </main>
  );
}
