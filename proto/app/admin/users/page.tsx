// 관리자 "사용자 현황": 가입·등급·동의·탈퇴를 숫자로만 보여 준다(읽기만). 이름·이메일·회원 번호는 화면에 나오지 않는다.
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { adviseScreen } from "@/lib/admin/playbook-files";
import { WITHDRAWAL_LABEL, fetchUsersInputs, usersParts, usersSignals } from "@/lib/admin/screen-advice";
import { createClient } from "@/lib/supabase/server";
import { AdviceBox } from "../_components/advice-box";
import { PeriodGuide } from "../_components/period-guide";

export const metadata: Metadata = { title: "사용자 현황 | DːON 관리자", robots: { index: false, follow: false } };

const PERIODS = [7, 30, 90] as const;
type Tone = "ok" | "warn" | "bad" | "";
const toneText: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", "": "text-muted" };
const n = (value: number) => value.toLocaleString("ko-KR");
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

function Tile({ label, value, hint, tone = "" }: { label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <div className="rounded-xl bg-soft px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5">
        <span className="text-xl font-medium">{value}</span>
        {hint && <span className={`ml-1.5 text-xs ${toneText[tone]}`}>{hint}</span>}
      </p>
    </div>
  );
}

function Heading({ title, know }: { title: string; know: string }) {
  return (
    <div className="mb-2.5">
      <h2 className="text-[0.9375rem] font-medium">{title}</h2>
      <p className="text-xs text-muted">알 수 있는 것: {know}</p>
    </div>
  );
}

function Bar({ label, value, whole, note }: { label: string; value: number; whole: number; note?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-soft">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct(value, whole)}%` }} />
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums text-muted">{n(value)}명 ({pct(value, whole)}%)</span>
      {note && <span className="hidden text-faint sm:inline">{note}</span>}
    </div>
  );
}

async function AdminUsersContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const raw = Number(Array.isArray(params.days) ? params.days[0] : params.days);
  const days = (PERIODS as readonly number[]).includes(raw) ? raw : 30;

  const supabase = await createClient();
  const inputs = await fetchUsersInputs(supabase);
  const p = usersParts(inputs, days);
  const { advice, errors: adviceErrors } = await adviseScreen("users", usersSignals(inputs));

  const everyone = p.members + p.admins;
  const general = Math.max(0, p.members - p.subscribers);
  const maxBar = Math.max(1, ...p.series.map((day) => day.count));
  const labelEvery = p.series.length > 31 ? 7 : p.series.length > 14 ? 3 : 1;
  const change = p.signupsPrev7 > 0 ? Math.round(((p.signups7 - p.signupsPrev7) / p.signupsPrev7) * 100) : null;
  const wdRate = p.signupsPeriod > 0 ? Math.round((p.withdrawalsPeriod / p.signupsPeriod) * 100) : 0;
  const reasonEntries = Object.entries(WITHDRAWAL_LABEL).map(([code, label]) => [label, p.reasonsPeriod[code] ?? 0] as const);

  return (
    <>
      <AdviceBox advice={advice} errors={adviceErrors} scope="가입·탈퇴·동의 숫자를 풀어서, 관리자가 지금 할 일을 정리했어요." />

      <section className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4" aria-label="보기 설정">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">기간</span>
          {PERIODS.map((value) => (
            <Link key={value} href={`/admin/users?days=${value}`} aria-current={days === value ? "true" : undefined} className={`rounded-full border px-3.5 py-1.5 text-sm ${days === value ? "border-ink bg-brand text-brand-ink" : "border-line bg-panel hover:bg-soft"}`}>
              {value}일
            </Link>
          ))}
        </div>
        <p className="basis-full text-xs text-faint">이 화면으로 알 수 있는 것: 회원이 늘고 있는지, 갑자기 몰리거나 빠지는지, 메일 수신에 동의한 사람이 얼마나 되는지, 탈퇴 이유가 무엇인지. 이름·이메일은 보여 주지 않고 숫자만 보여 줘요.</p>
        <PeriodGuide
          current={days}
          rows={[
            { days: 7, text: "이번 주 흐름이에요. 갑자기 가입이 몰렸거나 탈퇴가 늘었는지 바로 보여요. 요일 영향이 한 바퀴 들어가는 가장 짧은 길이이기도 해요." },
            { days: 30, text: "한 달 흐름이에요. 가입 대비 탈퇴율, 탈퇴 사유 분포를 보기에 표본이 넉넉해요. 기본값이에요." },
            { days: 90, text: "분기 흐름이에요. 가입이 늘고 있는지 큰 추세를 봐요. 한 달 단위 변동이 섞이지 않아요." },
          ]}
        />
      </section>

      <section className="card p-4">
        <Heading title="한눈에" know="회원이 몇 명인지, 오늘·이번 주 가입 흐름, 구독 회원 비율, 최근 탈퇴" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
          <Tile label="전체 회원" value={`${n(p.members)}명`} hint={`관리자 ${p.admins}명 제외`} />
          <Tile label="오늘 가입" value={`${n(p.today)}명`} hint={p.avg7 > 0 ? `평소 하루 ${p.avg7}명` : ""} />
          <Tile label="최근 7일 가입" value={`${n(p.signups7)}명`} hint={change === null ? "전주 기록 없음" : `전주 대비 ${change >= 0 ? "+" : ""}${change}%`} tone={change !== null && change < -30 ? "warn" : ""} />
          <Tile label="구독 중" value={`${n(p.subscribers)}명`} hint={p.members > 0 ? `${pct(p.subscribers, p.members)}%` : ""} />
          <Tile label="추천 메일 수신 동의" value={`${n(p.mailConsent)}명`} hint={everyone > 0 ? `${pct(p.mailConsent, everyone)}%` : ""} />
          <Tile label={`최근 ${days}일 탈퇴`} value={`${n(p.withdrawalsPeriod)}명`} hint={p.signupsPeriod > 0 ? `가입 대비 ${wdRate}%` : ""} tone={p.withdrawalsPeriod > 0 && wdRate >= 30 ? "warn" : ""} />
        </div>
        <p className="mt-2.5 text-xs text-faint">전체 회원은 관리자 계정을 뺀 수예요. 구독 중은 유효한 구독을 가진 회원(구독 해지 후 기간이 남은 회원 포함)이에요. 결제(6-G)가 연결되기 전에는 시험 계정만 있어요.</p>
      </section>

      <section className="card p-4">
        <Heading title={`최근 ${days}일 가입`} know="가입이 늘고 있는지, 어느 날 몰렸는지" />
        <div className="flex h-28 items-end gap-[3px]" role="img" aria-label={`최근 ${days}일 가입 수. 가장 많은 날 ${maxBar}명`}>
          {p.series.map((day) => (
            <div key={day.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${day.day} 가입 ${day.count}명`}>
              <div className="w-full rounded-sm bg-accent" style={{ height: `${(day.count / maxBar) * 100}%`, minHeight: day.count > 0 ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-[3px]" aria-hidden="true">
          {p.series.map((day, index) => (
            <span key={day.day} className="min-w-0 flex-1 text-center text-[0.625rem] text-faint">
              {(p.series.length - 1 - index) % labelEvery === 0 ? day.day.split("/")[1] : ""}
            </span>
          ))}
        </div>
        <p className="mt-1 text-xs text-faint">막대 하나가 하루예요(한국 시간 기준, 관리자 계정 제외). 최근 {days}일 가입 {n(p.signupsPeriod)}명, 그 전 {days}일 {n(p.signupsPrevPeriod)}명.</p>
      </section>

      <section className="card p-4">
        <Heading title="회원 구성" know="일반 회원과 구독 회원의 비율" />
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-soft" role="img" aria-label={`일반 ${general}명, 구독 ${p.subscribers}명, 관리자 ${p.admins}명`}>
          {general > 0 && <div style={{ flexGrow: general, background: "#378ADD" }} />}
          {p.subscribers > 0 && <div style={{ flexGrow: p.subscribers, background: "#2e9e5b" }} />}
          {p.admins > 0 && <div style={{ flexGrow: p.admins, background: "#7F77DD" }} />}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <li><i className="mr-1 inline-block size-2 rounded-sm" style={{ background: "#378ADD" }} />일반 회원 {n(general)}명</li>
          <li><i className="mr-1 inline-block size-2 rounded-sm" style={{ background: "#2e9e5b" }} />구독 회원 {n(p.subscribers)}명</li>
          <li><i className="mr-1 inline-block size-2 rounded-sm" style={{ background: "#7F77DD" }} />관리자 {n(p.admins)}명</li>
        </ul>
      </section>

      <section className="card p-4">
        <Heading title="동의·연락처 현황" know="추천 메일을 받을 수 있는 사람이 얼마나 되는지, 행동 기록 저장에 동의한 사람이 얼마나 되는지" />
        {everyone === 0 ? (
          <p className="text-sm text-muted">아직 회원이 없어요.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Bar label="추천 메일 수신 동의" value={p.mailConsent} whole={everyone} />
            <Bar label="메일 받을 주소 등록" value={p.addresses} whole={everyone} />
            <Bar label="행동 기록 저장 동의" value={p.behaviorConsent} whole={everyone} />
          </div>
        )}
        <p className="mt-2.5 text-xs text-faint">비율은 관리자를 포함한 전체 계정 기준이에요. 메일은 &quot;동의&quot;와 &quot;주소&quot;가 둘 다 있어야 갈 수 있어요(카카오 가입자는 주소를 따로 입력해요).</p>
      </section>

      <section className="card p-4">
        <Heading title={`탈퇴 현황 (최근 ${days}일)`} know="탈퇴가 늘고 있는지, 어떤 이유로 떠나는지" />
        {p.withdrawalsPeriod === 0 ? (
          <p className="text-sm text-muted">이 기간에 탈퇴한 회원이 없어요.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {reasonEntries.map(([label, count]) => (
              <Bar key={label} label={label} value={count} whole={p.withdrawalsPeriod} />
            ))}
          </div>
        )}
        <p className="mt-2.5 text-xs text-faint">탈퇴하면 회원 정보는 모두 삭제되고, 누가 탈퇴했는지 알 수 없게 탈퇴 이유만 남아요. 최근 7일 탈퇴 {n(p.withdrawals7)}명(전주 {n(p.withdrawalsPrev7)}명).</p>
      </section>
    </>
  );
}

export default function AdminUsers(props: PageProps<"/admin/users">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
      <AdminUsersContent searchParams={props.searchParams} />
    </Suspense>
  );
}
