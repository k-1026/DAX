// 수신 거부 완료 화면
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "수신 거부 완료 | 대구 공실 매칭",
  robots: { index: false, follow: false },
};

export default function UnsubscribeDonePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-bold">수신 거부가 완료되었습니다</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        앞으로 추천 메일을 보내지 않습니다. 다시 받으려면 마이페이지에서 동의할 수 있습니다.
      </p>
      <Link href="/" className="text-sm underline">
        첫 화면으로 이동
      </Link>
    </main>
  );
}
