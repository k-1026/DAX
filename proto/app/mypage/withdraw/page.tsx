// 회원 탈퇴 화면
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { WithdrawForm } from "./withdraw-form";

export const metadata: Metadata = { title: "회원 탈퇴 | 대구 공실 매칭" };

async function WithdrawContent() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  return <WithdrawForm />;
}

export default function WithdrawPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-10">
      <h1 className="text-2xl font-bold">회원 탈퇴</h1>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 text-sm leading-6 dark:border-zinc-800">
        <div>
          <h2 className="font-semibold">바로 삭제되는 정보</h2>
          <p>로그인 계정, 이름, 프로필 사진, 메일 수신 주소, 선호 조건, 담은 매물</p>
        </div>
        <div>
          <h2 className="font-semibold">법령과 기록 보관을 위해 남는 정보</h2>
          <ul className="list-disc pl-5">
            <li>동의 기록: 누구인지 알 수 없게 바꿔 5년 보관 후 삭제</li>
            <li>결제 기록: 관련 법령에 따라 5년 보관 후 삭제</li>
            <li>평가와 리뷰: 개인을 알아볼 수 없게 처리해 통계로만 사용</li>
          </ul>
        </div>
        <p>
          카카오로 가입한 경우, 카카오 계정과의 연결은 카카오 계정 설정에서 해제할 수 있습니다.
        </p>
      </section>

      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <WithdrawContent />
      </Suspense>
    </main>
  );
}
