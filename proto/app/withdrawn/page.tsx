// 회원 탈퇴 완료 화면
import { SiteLogo } from "@/app/_components/site-logo";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "탈퇴 완료 | 대구 공실 매칭" };

export default function WithdrawnPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <SiteLogo />
      <div className="card flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
        <h1 className="text-xl font-medium">탈퇴가 완료되었어요</h1>
        <p className="text-sm text-muted">그동안 대구 공실 매칭을 이용해 주셔서 감사합니다.</p>
        <Link href="/" className="rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-ink">
          첫 화면으로 이동
        </Link>
      </div>
    </main>
  );
}
