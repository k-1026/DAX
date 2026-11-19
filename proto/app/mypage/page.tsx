// 마이페이지: 내 정보 열람·수정과 동의 관리
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAccess, TIER_LABELS } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { removeAvatar } from "./actions";
import { OptionalConsentRow, ProfileForm } from "./mypage-forms";

export const metadata: Metadata = { title: "마이페이지 | 대구 공실 매칭" };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function formatLimit(limit: number | null, unit: string) {
  return limit === null ? "제한 없음" : `${limit}${unit}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

async function MypageContent() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect("/login");

  const [access, { data: profile }, { data: consents }] = await Promise.all([
    getAccess(),
    supabase
      .from("profiles")
      .select("display_name, avatar_url, contact_email, created_at")
      .eq("id", claims.sub)
      .maybeSingle(),
    supabase
      .from("user_consents")
      .select("consent_type, document_version, agreed_at")
      .eq("user_id", claims.sub)
      .is("withdrawn_at", null)
      .order("agreed_at", { ascending: false }),
  ]);

  const agreedAt = (type: string) => {
    const row = consents?.find((consent) => consent.consent_type === type);
    return row ? formatDate(row.agreed_at) : null;
  };

  return (
    <>
      <Section title="내 등급">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <dt className="text-zinc-600 dark:text-zinc-400">등급</dt>
          <dd className="font-semibold">{TIER_LABELS[access.tier]}</dd>
          <dt className="text-zinc-600 dark:text-zinc-400">담기</dt>
          <dd>{formatLimit(access.saved_limit, "곳")}</dd>
          <dt className="text-zinc-600 dark:text-zinc-400">나란히 비교</dt>
          <dd>{formatLimit(access.compare_limit, "곳")}</dd>
          <dt className="text-zinc-600 dark:text-zinc-400">AI 기능</dt>
          <dd>{access.ai_limit === null ? "제한 없음" : `하루 ${access.ai_limit}회`}</dd>
          <dt className="text-zinc-600 dark:text-zinc-400">신규 매물</dt>
          <dd>{access.early_access ? "24시간 먼저 열람" : "일반 공개"}</dd>
        </dl>
        {access.tier === "admin" && (
          <Link href="/admin" className="self-start text-sm underline">
            관리자 화면으로 이동
          </Link>
        )}
      </Section>

      <Section title="내 정보">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <dt className="text-zinc-600 dark:text-zinc-400">로그인 이메일</dt>
          <dd>{claims.email ?? "제공되지 않음"}</dd>
          <dt className="text-zinc-600 dark:text-zinc-400">가입일</dt>
          <dd>{profile ? formatDate(profile.created_at) : "-"}</dd>
          <dt className="text-zinc-600 dark:text-zinc-400">프로필 사진</dt>
          <dd className="flex items-center gap-3">
            {profile?.avatar_url ? "등록됨" : "없음"}
            {profile?.avatar_url && (
              <form action={removeAvatar}>
                <button type="submit" className="underline">
                  사진 삭제
                </button>
              </form>
            )}
          </dd>
        </dl>
        <ProfileForm
          displayName={profile?.display_name ?? ""}
          contactEmail={profile?.contact_email ?? ""}
        />
      </Section>

      <Section title="동의 관리">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <div className="py-3 text-sm">
            <p className="font-medium">
              [필수] <Link href="/terms" className="underline">이용약관</Link>
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {agreedAt("terms") ? `${agreedAt("terms")} 동의` : "동의 기록 없음"}
            </p>
          </div>
          <div className="py-3 text-sm">
            <p className="font-medium">
              [필수] <Link href="/privacy" className="underline">개인정보 처리방침</Link>
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {agreedAt("privacy") ? `${agreedAt("privacy")} 동의` : "동의 기록 없음"}
            </p>
          </div>
          <OptionalConsentRow
            type="behavior_tracking"
            label="검색 조건과 정렬 방식 기록"
            agreedAt={agreedAt("behavior_tracking")}
          />
          <OptionalConsentRow
            type="email"
            label="추천 메일 수신"
            agreedAt={agreedAt("email")}
          />
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          필수 항목의 동의를 철회하려면 회원 탈퇴가 필요합니다.
        </p>
      </Section>

      <Section title="회원 탈퇴">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          탈퇴하면 계정을 복구할 수 없습니다.
        </p>
        <Link href="/mypage/withdraw" className="self-start text-sm text-red-700 underline dark:text-red-400">
          회원 탈퇴하기
        </Link>
      </Section>
    </>
  );
}

export default function MypagePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">마이페이지</h1>
        <Link href="/" className="text-sm underline">
          첫 화면
        </Link>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <MypageContent />
      </Suspense>
    </main>
  );
}
