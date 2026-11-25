// 마이페이지 "첫 추천 메일 미리보기": 내 선호 조건으로 만들어질 메일을 보내지 않고 화면에서만 보여 준다.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteLogo } from "@/app/_components/site-logo";
import { buildFirstMail, type FirstRecipient } from "@/lib/mail/batch";
import { createMailDeps } from "@/lib/mail/runtime";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "첫 추천 메일 미리보기 | 대구 공실 매칭" };

type Preview = {
  filters: Record<string, unknown>;
  sent_at: string | null;
  total: number;
  items: FirstRecipient["items"];
};

async function PreviewContent() {
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims) redirect("/login");

  const [{ data }, { data: profile }, { data: consents }] = await Promise.all([
    supabase.rpc("my_first_mail_preview"),
    supabase.from("profiles").select("contact_email").eq("id", claims.sub).maybeSingle(),
    supabase.from("user_consents").select("consent_type").eq("user_id", claims.sub).eq("consent_type", "email").is("withdrawn_at", null),
  ]);
  const preview = (data ?? { filters: {}, sent_at: null, total: 0, items: [] }) as Preview;
  const hasFilters = Object.keys(preview.filters).length > 0;
  const hasConsent = (consents ?? []).length > 0;
  const address = profile?.contact_email ?? "";

  const checks: [string, boolean][] = [
    ["추천 메일 수신 동의", hasConsent],
    ["메일 수신 주소", Boolean(address)],
    ["선호 조건 저장", hasFilters],
    ["조건에 맞는 매물", preview.total > 0],
  ];

  const message =
    hasFilters && preview.total > 0
      ? buildFirstMail(
          { user_id: claims.sub, to: address || "(메일 주소 없음)", filters: preview.filters, total: preview.total, items: preview.items },
          createMailDeps(),
        )
      : null;

  return (
    <>
      <section className="card flex flex-col gap-3 p-5 text-sm">
        <h2 className="font-medium">보내기 전 확인</h2>
        <ul className="flex flex-col gap-1">
          {checks.map(([label, ok]) => (
            <li key={label} className={ok ? "text-ok" : "text-muted"}>
              {ok ? "✓" : "·"} {label}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          {preview.sent_at
            ? "첫 추천 메일을 이미 받으셨어요. 첫 메일은 한 번만 보내요."
            : "위 조건이 모두 갖춰지면 가까운 발송 시간에 한 번만 보내요(밤 9시~아침 8시는 아침으로 미뤄요). 지금은 보내지 않고 미리보기만 해요."}
        </p>
      </section>
      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-medium">메일 미리보기</h2>
        {message ? (
          <>
            <p className="text-xs text-muted">제목: {message.subject}</p>
            <iframe title="첫 추천 메일 미리보기" sandbox="" srcDoc={message.html} className="h-[640px] w-full rounded-xl border border-line bg-white" />
          </>
        ) : (
          <p className="text-sm text-muted">
            {hasFilters ? "조건에 맞는 매물이 아직 없어서 보낼 메일이 없어요." : "선호 조건을 저장하면 여기서 첫 추천 메일을 미리 볼 수 있어요."}
          </p>
        )}
      </section>
    </>
  );
}

export default function MailPreviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-10">
      <div className="flex items-center justify-between">
        <SiteLogo />
        <Link href="/mypage" className="rounded-full border border-line bg-panel px-3.5 py-2 text-sm hover:bg-soft">
          마이페이지
        </Link>
      </div>
      <h1 className="text-xl font-medium">첫 추천 메일 미리보기</h1>
      <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
        <PreviewContent />
      </Suspense>
    </main>
  );
}
