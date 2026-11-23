// 문제 신고 (회원·비로그인 모두. 비로그인은 IP당 하루 3건, 300자)
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ReportForm } from "./report-form";

async function ReportSection({ searchParams }: PageProps<"/report">) {
  await connection();
  const params = await searchParams;
  const kind = typeof params.kind === "string" ? params.kind : undefined;
  const listingId = typeof params.listing === "string" ? params.listing : undefined;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const member = Boolean(data?.claims);

  return (
    <>
      {!member && (
        <p className="text-xs text-zinc-500">로그인하지 않아도 신고가 가능해요.</p>
      )}
      <ReportForm kind={kind} listingId={listingId} maxLength={member ? 500 : 300} />
    </>
  );
}

export default function ReportPage(props: PageProps<"/report">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      <Link href="/" className="text-sm text-zinc-600 underline dark:text-zinc-400">
        ← 처음으로
      </Link>
      <h1 className="text-xl font-bold">문제 신고</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        사이트 오류, 결제·개인정보 문제, 실제와 다른 매물 정보를 알려 주세요. 결제·개인정보·장애 신고는 관리자에게 바로 전달됩니다.
      </p>
      <Suspense fallback={null}>
        <ReportSection {...props} />
      </Suspense>
    </main>
  );
}
