// 마이페이지: 내 정보 열람·수정과 동의 관리
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAccess, TIER_LABELS } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { SiteLogo } from "@/app/_components/site-logo";
import { getAreas } from "@/lib/search/listings";
import { TierBadge } from "./tier-badge";
import { OptionalConsentRow, PreferencesForm, type Preferences } from "./mypage-forms";
import type { FeedbackPage } from "./actions";
import { FeedbackHistory } from "./feedback-history";
import { ProfileCard } from "./profile-card";

export const metadata: Metadata = { title: "마이페이지 | DːON" };

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

function Section({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

// 등급 배지에 보여 줄 기능. 일반 회원에게는 신규 매물·구독 안내를 넣지 않는다.
function tierFeatures(access: Awaited<ReturnType<typeof getAccess>>) {
  const features = [
    `담기 ${formatLimit(access.saved_limit, "곳")}`,
    `나란히 비교 ${formatLimit(access.compare_limit, "곳")}`,
    `AI 기능 ${access.ai_limit === null ? "제한 없음" : `하루 ${access.ai_limit}회`}`,
  ];
  if (access.early_access) features.push("새 매물을 24시간 먼저 볼 수 있어요");
  return features;
}

async function MypageContent() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect("/login");

  const [access, { data: prefData }, { data: feedbackData }, areaMap, { data: profile }, { data: consents }] = await Promise.all([
    getAccess(),
    supabase.rpc("my_preferences"),
    supabase.rpc("my_feedback_list", { p_limit: 5, p_offset: 0 }),
    getAreas(),
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

  // 첫 추천 메일을 받으려면 수신 동의, 메일 주소, 선호 조건이 모두 필요하다.
  const prefs = (prefData ?? {}) as Preferences;
  const hasPrefs =
    (prefs.gu?.length ?? 0) > 0 ||
    [prefs.rent_max, prefs.deposit_max, prefs.area_min, prefs.area_max].some((v) => v !== undefined);
  const missing = [
    !agreedAt("email") && "추천 메일 수신 동의",
    !profile?.contact_email && "메일 수신 주소",
    !hasPrefs && "선호 조건 저장",
  ].filter(Boolean);
  const mailReady = missing.length === 0;
  const mailStatus = mailReady
    ? "추천 메일을 받을 준비가 됐어요."
    : `첫 추천 메일을 받으려면 다음이 필요해요: ${missing.join(", ")}`;

  return (
    <>
      <ProfileCard
        avatarUrl={profile?.avatar_url ?? null}
        displayName={profile?.display_name ?? ""}
        contactEmail={profile?.contact_email ?? ""}
        loginEmail={claims.email ?? "이메일 정보 없음"}
        joinedAt={profile ? formatDate(profile.created_at) : "-"}
        badge={<TierBadge label={TIER_LABELS[access.tier] === "로그인 회원" ? "일반 회원" : TIER_LABELS[access.tier]} features={tierFeatures(access)} />}
        adminLink={
          access.tier === "admin" ? (
            <Link href="/admin" className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
              관리자 화면
            </Link>
          ) : undefined
        }
      />

      <Section title="선호 조건">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          한 세트만 저장돼요. 검색 화면에서 &ldquo;내 선호 조건으로 검색&rdquo;을 누르면 바로 적용돼요.
        </p>
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            mailReady
              ? "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200"
              : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          }`}
        >
          {mailStatus}
        </p>
        <Link href="/mypage/mail-preview" className="self-start text-sm text-accent underline">
          첫 추천 메일 미리보기
        </Link>
        <PreferencesForm areas={Object.keys(areaMap)} saved={prefs} />
      </Section>

      <Section title="내 평가">
        <FeedbackHistory initial={(feedbackData ?? { total: 0, items: [] }) as FeedbackPage} />
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
          <p className="py-2 text-xs text-zinc-600 dark:text-zinc-400">
            가입 후 선호 조건을 저장하면 첫 추천 메일을 한 번 보내요. 실제 발송은 서비스 준비 후 시작돼요.
          </p>
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
        <SiteLogo />
        <Link href="/" className="rounded-full border border-line bg-panel px-3.5 py-2 text-sm hover:bg-soft">
          첫 화면
        </Link>
      </div>
      <h1 className="text-xl font-medium">마이페이지</h1>
      <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중…</p>}>
        <MypageContent />
      </Suspense>
    </main>
  );
}
