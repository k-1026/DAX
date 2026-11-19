// 회원 탈퇴 완료 화면
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "탈퇴 완료 | 대구 공실 매칭" };

export default function WithdrawnPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-bold">탈퇴가 완료되었습니다</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        그동안 대구 공실 매칭을 이용해 주셔서 감사합니다.
      </p>
      <Link href="/" className="text-sm underline">
        첫 화면으로 이동
      </Link>
    </main>
  );
}
