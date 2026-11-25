// 관리자 공통 틀: 위쪽 로고 + 왼쪽 메뉴 + 오른쪽 내용. 관리자가 아니면 페이지가 없는 것처럼 처리한다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { getAccess } from "@/lib/auth/access";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = {
  title: "관리자 | DːON",
  robots: { index: false, follow: false },
};

async function Gate({ children }: { children: ReactNode }) {
  await connection();
  const access = await getAccess();
  if (access.tier !== "admin") notFound();
  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <Link href="/admin" className="flex items-center gap-3" aria-label="관리자 첫 화면">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand text-brand-ink" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </span>
          <span className="text-base font-medium">DːON</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-line bg-panel px-3.5 py-2 text-sm">관리자 계정</span>
          <Link href="/" className="rounded-full border border-line bg-panel px-3.5 py-2 text-sm hover:bg-soft">
            서비스 화면
          </Link>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <AdminNav />
        <div className="flex min-w-0 flex-col gap-3">
          <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
            <Gate>{children}</Gate>
          </Suspense>
        </div>
      </div>
    </main>
  );
}
