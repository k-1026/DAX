// 동의 화면: 필수 동의를 마치지 않은 회원이 거쳐 가는 화면
import { SiteLogo } from "@/app/_components/site-logo";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LEGAL_VERSIONS, toSafePath } from "@/lib/legal/versions";
import { createClient } from "@/lib/supabase/server";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "약관 동의 | 대구 공실 매칭" };

async function ConsentContent({ searchParams }: PageProps<"/consent">) {
  // 로그인 상태는 요청할 때마다 확인한다.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect("/login");

  const { next } = await searchParams;
  const safeNext = toSafePath(next);

  const { data: completed } = await supabase.rpc("has_required_consents", {
    terms_version: LEGAL_VERSIONS.terms,
    privacy_version: LEGAL_VERSIONS.privacy,
  });
  if (completed) redirect(safeNext);

  const { data: profile } = await supabase
    .from("profiles")
    .select("contact_email")
    .eq("id", claims.sub)
    .maybeSingle();

  return (
    <ConsentForm
      next={safeNext}
      defaultEmail={profile?.contact_email ?? claims.email ?? ""}
    />
  );
}

export default function ConsentPage(props: PageProps<"/consent">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <SiteLogo />
      <div className="card flex w-full max-w-md flex-col gap-6 p-6 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-medium">서비스 이용 동의</h1>
          <p className="text-sm text-muted">필수 항목에 동의하면 서비스를 이용할 수 있어요.</p>
        </div>
        <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
          <ConsentContent {...props} />
        </Suspense>
      </div>
    </main>
  );
}
