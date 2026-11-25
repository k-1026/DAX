// 수신 거부 완료 화면
import { SiteLogo } from "@/app/_components/site-logo";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "수신 거부 완료 | 대구 공실 매칭",
  robots: { index: false, follow: false },
};

export default function UnsubscribeDonePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <SiteLogo />
      <div className="card flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
        <h1 className="text-xl font-medium">수신 거부가 완료되었어요</h1>
        <p className="text-sm text-muted">앞으로 추천 메일을 보내지 않아요. 다시 받으려면 마이페이지에서 동의할 수 있어요.</p>
        <Link href="/" className="rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-ink">
          첫 화면으로 이동
        </Link>
      </div>
    </main>
  );
}
