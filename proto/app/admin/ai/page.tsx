// 관리자 "AI 사용량": 누가·무엇에·얼마나 썼는지, 한도가 맞는지, 급증하는지를 숫자와 그래프로 보여 준다(읽기만).
// 회원 번호·접속 정보는 다루지 않는다.
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buildAiSignals } from "@/lib/admin/ai-signals";
import { adviseScreen } from "@/lib/admin/playbook-files";
import { AdviceBox } from "../_components/advice-box";
import { PeriodGuide } from "../_components/period-guide";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "AI 사용량 | DːON 관리자", robots: { index: false, follow: false } };

type SeriesDay = { day: string; guest: number; member: number; subscriber: number; admin: number; withdrawn: number; ai1: number; ai2: number; ai3: number; ai4: number };
type Buckets = { b1: number; b2: number; b3: number; b4: number } | null;
type Usage = {
  days: number;
  today: number;
  month: number;
  period: number;
  prev_period: number;
  avg7: number;
  features: Record<string, { today: number; month: number; period: number }>;
  tiers_today: Record<string, { uses: number; people: number }>;
  series: SeriesDay[];
  distribution: { member: Buckets; subscriber: Buckets };
  reached: { member: number; subscriber: number; guest_total: number };
  guest_today: number;
  limits: { member: number; subscriber: number; guest_total: number; guest_cap: number };
};

const PERIODS = [7, 30, 90] as const;
type View = "tier" | "feature";

const FEATURES = [
  { key: "ai1_search_text", series: "ai1", name: "문장으로 찾기", note: "공실이에게 직접 쓴 말도 포함", color: "#378ADD" },
  { key: "ai2_explain", series: "ai2", name: "질문 칩·질문 입력창", note: "월세·넓이·최근 확인·동네 질문", color: "#2e9e5b" },
  { key: "ai4_assistant", series: "ai4", name: "공실이 대화", note: "선택지 대화로 결과를 찾았을 때 1회", color: "#E07B39" },
  { key: "ai3_compare", series: "ai3", name: "비교 요약", note: "AI 없이 만들어서 사용 안 함", color: "#B4B2A9" },
] as const;
const TIERS = [
  { key: "guest", name: "비회원", color: "#B4B2A9" },
  { key: "member", name: "로그인 회원", color: "#378ADD" },
  { key: "subscriber", name: "구독 회원", color: "#2e9e5b" },
  { key: "admin", name: "관리자", color: "#7F77DD" },
  { key: "withdrawn", name: "탈퇴 회원(등급 모름)", color: "#d6d3cc" },
] as const;
const BUCKETS = [
  { key: "b1", name: "조금 씀", hint: "한도의 30% 미만" },
  { key: "b2", name: "보통", hint: "30~60%" },
  { key: "b3", name: "많이 씀", hint: "60~99%" },
  { key: "b4", name: "한도까지 다 씀", hint: "100%" },
] as const;

type Tone = "ok" | "warn" | "bad" | "";
const toneText: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", "": "text-muted" };
const n = (value: number | undefined) => (value ?? 0).toLocaleString("ko-KR");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

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

function ControlLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={on ? "true" : undefined} className={`rounded-full border px-3.5 py-1.5 text-sm ${on ? "border-ink bg-brand text-brand-ink" : "border-line bg-panel hover:bg-soft"}`}>
      {children}
    </Link>
  );
}

async function AdminAiContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const rawDays = Number(Array.isArray(params.days) ? params.days[0] : params.days);
  const days = (PERIODS as readonly number[]).includes(rawDays) ? rawDays : 30;
  const view: View = (Array.isArray(params.view) ? params.view[0] : params.view) === "feature" ? "feature" : "tier";
  const link = (nextDays: number, nextView: View) => `/admin/ai?days=${nextDays}&view=${nextView}`;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_ai_usage", { p_days: days });
  if (error || !data) {
    return <p role="alert" className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad">AI 사용량을 불러오지 못했어요. 잠시 후 다시 열어 주세요.</p>;
  }
  const usage = data as Usage;
  const cap = usage.limits.guest_cap;
  const capRatio = cap > 0 ? usage.guest_today / cap : 0;
  const people = (key: string) => usage.tiers_today[key]?.people ?? 0;
  const loggedPeople = people("member") + people("subscriber") + people("admin");
  const reachedToday = usage.reached.member + usage.reached.subscriber;

  // ① 평소(최근 7일 평균) 대비
  const spike = usage.avg7 > 0 ? usage.today / usage.avg7 : null;
  const spikeBad = spike !== null && usage.today >= 10 && spike >= 3;
  // ③ 지난 기간 대비
  const change = usage.prev_period > 0 ? Math.round(((usage.period - usage.prev_period) / usage.prev_period) * 100) : null;
  const growthBad = usage.prev_period >= 20 && usage.period >= usage.prev_period * 2;
  // ② 한도 대비 사용 비율
  const dist = (key: "member" | "subscriber") => {
    const b = usage.distribution[key];
    const total = b ? b.b1 + b.b2 + b.b3 + b.b4 : 0;
    return { b, total };
  };
  const dm = dist("member");
  const ds = dist("subscriber");
  const nearLimit = (d: ReturnType<typeof dist>) => (d.b && d.total >= 10 ? pct(d.b.b3 + d.b.b4, d.total) : null);
  const memberNear = nearLimit(dm);
  const subscriberNear = nearLimit(ds);
  const lowMember = dm.b && dm.total >= 20 ? pct(dm.b.b1, dm.total) : null;

  const { advice, errors: adviceErrors } = await adviseScreen("ai", buildAiSignals(usage));
  const series = usage.series;
  const dayTotal = (day: SeriesDay) => day.guest + day.member + day.subscriber + day.admin + day.withdrawn;
  const maxBar = Math.max(1, ...series.map(dayTotal));
  const labelEvery = series.length > 31 ? 7 : series.length > 14 ? 3 : 1;
  const featureTotal = FEATURES.reduce((sum, feature) => sum + (usage.features[feature.key]?.period ?? 0), 0);
  const segments = view === "tier" ? TIERS.map((tier) => ({ key: tier.key, name: tier.name, color: tier.color, value: (day: SeriesDay) => day[tier.key] })) : FEATURES.map((feature) => ({ key: feature.series, name: feature.name, color: feature.color, value: (day: SeriesDay) => day[feature.series] }));

  const limitText: Record<string, string> = {
    guest: `전체 ${usage.limits.guest_total}회 (접속 하나당)`,
    member: `하루 ${usage.limits.member}회`,
    subscriber: `하루 ${usage.limits.subscriber}회`,
    admin: "제한 없음",
    withdrawn: "—",
  };
  const reachedText: Record<string, string> = {
    guest: `${usage.reached.guest_total}곳 (누적)`,
    member: `${usage.reached.member}명 (오늘)`,
    subscriber: `${usage.reached.subscriber}명 (오늘)`,
    admin: "—",
    withdrawn: "—",
  };

  return (
    <>
      {capRatio >= 1 && (
        <div className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad" role="alert">
          비회원 하루 전체 AI 상한({n(cap)}회)을 다 썼어요. 오늘은 비회원이 AI를 더 쓸 수 없어요.
        </div>
      )}
      {capRatio >= 0.8 && capRatio < 1 && (
        <div className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn" role="alert">
          비회원 하루 전체 AI 상한의 {Math.round(capRatio * 100)}%를 썼어요({n(usage.guest_today)} / {n(cap)}회). 평소보다 많다면 남용인지 확인해 보세요.
        </div>
      )}
      {spikeBad && spike !== null && (
        <div className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad" role="alert">
          오늘 AI 사용({n(usage.today)}회)이 최근 7일 평균({usage.avg7}회)의 {spike.toFixed(1)}배예요. 갑자기 늘어난 이유를 확인해 보세요.
        </div>
      )}
      {growthBad && change !== null && (
        <div className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn" role="alert">
          최근 {usage.days}일 사용({n(usage.period)}회)이 그 전 {usage.days}일({n(usage.prev_period)}회)의 2배를 넘었어요(+{change}%). 비용이 함께 늘 수 있어요.
        </div>
      )}
      {((memberNear !== null && memberNear >= 30) || (subscriberNear !== null && subscriberNear >= 30)) && (
        <div className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn" role="alert">
          회원 중 한도의 60% 넘게 쓰는 날이 {memberNear !== null && memberNear >= 30 ? `로그인 회원 ${memberNear}%` : `구독 회원 ${subscriberNear}%`}예요. 한도가 낮아서 불편할 수 있어요.
        </div>
      )}
      {reachedToday > 0 && (
        <div className="rounded-xl bg-soft px-3.5 py-2.5 text-sm text-muted">오늘 한도를 다 쓴 회원이 {reachedToday}명 있어요.</div>
      )}

      <section className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4" aria-label="보기 설정">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">기간</span>
          {PERIODS.map((value) => (
            <ControlLink key={value} href={link(value, view)} on={days === value}>{value}일</ControlLink>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">막대 색</span>
          <ControlLink href={link(days, "tier")} on={view === "tier"}>등급별</ControlLink>
          <ControlLink href={link(days, "feature")} on={view === "feature"}>기능별</ControlLink>
        </div>
        <p className="basis-full text-xs text-faint">이 화면으로 알 수 있는 것: 갑자기 늘었는지, 한도가 알맞은지, 비용이 늘고 있는지, 어떤 기능이 많이 쓰이는지, 비회원이 로그인으로 넘어오는지.</p>
        <PeriodGuide
          current={days}
          rows={[
            { days: 7, text: "이번 주 흐름이에요. 오늘 사용이 평소보다 갑자기 늘었는지 바로 보여요. 요일 영향이 한 바퀴 들어가는 가장 짧은 길이이기도 해요." },
            { days: 30, text: "한 달 흐름이에요. 비용 추세와 한도 대비 사용(한도가 알맞은지)을 보기에 표본이 넉넉해요. 기본값이에요." },
            { days: 90, text: "분기 흐름이에요. AI 사용이 늘고 있는지 큰 추세를 봐요. 한 달 단위 변동이 섞이지 않아요." },
          ]}
        />
      </section>

      <AdviceBox advice={advice} errors={adviceErrors} scope={`아래 숫자와 그래프를 풀어서, 관리자가 지금 할 일을 정리했어요(최근 ${usage.days}일 기준).`} />

      <section className="card p-4">
        <Heading title="한눈에" know="오늘이 평소보다 많은지, 이번 기간이 지난 기간보다 늘었는지, 비회원 한도 소진(로그인 전환 신호)" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
          <Tile label="오늘 사용" value={`${n(usage.today)}회`} hint={spike === null ? "평소 기록 없음" : `평소의 ${spike.toFixed(1)}배`} tone={spikeBad ? "bad" : ""} />
          <Tile label={`최근 ${usage.days}일 사용`} value={`${n(usage.period)}회`} hint={change === null ? "비교할 지난 기록 없음" : `지난 ${usage.days}일 대비 ${change >= 0 ? "+" : ""}${change}%`} tone={growthBad ? "warn" : ""} />
          <Tile label="이번 달 사용" value={`${n(usage.month)}회`} />
          <Tile label="오늘 쓴 로그인 회원" value={`${n(loggedPeople)}명`} />
          <Tile label="오늘 한도를 다 쓴 회원" value={`${n(reachedToday)}명`} tone={reachedToday > 0 ? "warn" : ""} />
          <Tile label="비회원 한도 소진 (누적)" value={`${n(usage.reached.guest_total)}곳`} hint="로그인 전환 대상" />
          <Tile label="비회원 오늘 사용" value={`${n(usage.guest_today)}회`} hint={`상한 ${n(cap)}`} tone={capRatio >= 1 ? "bad" : capRatio >= 0.8 ? "warn" : ""} />
        </div>
        <p className="mt-2.5 text-xs text-faint">횟수는 AI를 성공적으로 쓴 것만 세요. 한도에 막혀서 거절된 시도는 기록되지 않아요. &quot;평소&quot;는 오늘을 뺀 최근 7일의 하루 평균이에요.</p>
      </section>

      <section className="card p-4">
        <Heading title={`최근 ${series.length}일 사용`} know="사용이 늘고 있는지(비용 추세), 어느 날 몰렸는지, 누가(등급별) 또는 무엇에(기능별) 쓰는지" />
        <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={`최근 ${series.length}일 AI 사용 횟수. 가장 많은 날 ${maxBar}회`}>
          {series.map((day) => {
            const total = dayTotal(day);
            return (
              <div key={day.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${day.day} 총 ${total}회`}>
                <div className="flex w-full flex-col-reverse" style={{ height: `${(total / maxBar) * 100}%` }}>
                  {segments.map((segment) => {
                    const value = segment.value(day);
                    return value > 0 ? <div key={segment.key} className="w-full" style={{ flexGrow: value, background: segment.color, minHeight: 2 }} /> : null;
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-[3px]" aria-hidden="true">
          {series.map((day, index) => (
            <span key={day.day} className="min-w-0 flex-1 text-center text-[0.625rem] text-faint">
              {(series.length - 1 - index) % labelEvery === 0 ? day.day.split("/")[1] : ""}
            </span>
          ))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {segments.map((segment) => (
            <li key={segment.key}>
              <i className="mr-1 inline-block size-2 rounded-sm" style={{ background: segment.color }} />
              {segment.name}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-faint">막대 하나가 하루이고, 전체 높이가 그날 AI를 쓴 횟수예요. 막대에 마우스를 올리면 총 횟수가 보여요. 날짜는 한국 시간 기준이에요.</p>
      </section>

      <section className="card p-4">
        <Heading title={`한도 대비 사용 (최근 ${usage.days}일)`} know="한도가 너무 낮아서 불편한지, 너무 넉넉해서 의미가 없는지 (사람이 하루에 한도의 몇 %를 쓰는지)" />
        <div className="flex flex-col gap-4">
          {([["로그인 회원", usage.limits.member, dm], ["구독 회원", usage.limits.subscriber, ds]] as const).map(([name, limit, d]) => (
            <div key={name}>
              <p className="mb-1.5 text-sm">
                {name} <span className="text-xs text-muted">· 하루 한도 {limit}회 · {n(d.total)}명·일</span>
              </p>
              {d.b === null || d.total === 0 ? (
                <p className="text-xs text-faint">기록이 아직 없어요.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {BUCKETS.map((bucket) => {
                    const value = d.b![bucket.key];
                    return (
                      <div key={bucket.key} className="flex items-center gap-2 text-xs">
                        <span className="w-28 shrink-0">{bucket.name} <span className="text-faint">({bucket.hint})</span></span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-soft">
                          <div className={`h-full rounded-full ${bucket.key === "b4" ? "bg-bad" : bucket.key === "b3" ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct(value, d.total)}%` }} />
                        </div>
                        <span className="w-14 shrink-0 text-right tabular-nums text-muted">{pct(value, d.total)}% ({n(value)})</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-xs text-faint">
          {lowMember !== null && lowMember >= 90 ? "대부분 한도의 30%도 안 쓰고 있어요. 한도가 넉넉한 편이에요. " : ""}
          표본이 적으면 판단하기 이르다는 뜻으로 알림을 띄우지 않아요(한도 근접 알림은 10명·일, &quot;넉넉하다&quot; 안내는 20명·일부터).
        </p>
      </section>

      <section className="card p-4">
        <Heading title={`기능별 (최근 ${usage.days}일)`} know="어떤 AI 기능이 많이 쓰이는지, 기능마다 비중이 어떤지" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.8125rem]">
            <thead>
              <tr className="text-faint">
                {["기능", `최근 ${usage.days}일`, "비중", "오늘", "이번 달"].map((head) => (
                  <th key={head} scope="col" className="border-b border-line px-1.5 py-1.5 font-normal">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((feature) => {
                const row = usage.features[feature.key];
                return (
                  <tr key={feature.key}>
                    <td className="border-b border-line px-1.5 py-2">
                      <span className="mr-1.5 inline-block size-2 rounded-sm align-middle" style={{ background: feature.color }} />
                      {feature.name}
                      <span className="block text-xs text-muted">{feature.note}</span>
                    </td>
                    <td className="border-b border-line px-1.5 py-2 tabular-nums">{n(row?.period)}</td>
                    <td className="border-b border-line px-1.5 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full" style={{ width: `${pct(row?.period ?? 0, featureTotal)}%`, background: feature.color }} /></div>
                        <span className="text-xs tabular-nums text-muted">{pct(row?.period ?? 0, featureTotal)}%</span>
                      </div>
                    </td>
                    <td className="border-b border-line px-1.5 py-2 tabular-nums">{n(row?.today)}</td>
                    <td className="border-b border-line px-1.5 py-2 tabular-nums">{n(row?.month)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-4">
        <Heading title="등급별 (오늘)" know="누가 많이 쓰는지, 등급마다 한도가 얼마인지, 한도를 다 쓴 사람이 있는지" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.8125rem]">
            <thead>
              <tr className="text-faint">
                {["등급", "사용", "쓴 사람", "한도", "한도 소진"].map((head) => (
                  <th key={head} scope="col" className="border-b border-line px-1.5 py-1.5 font-normal">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIERS.map((tier) => (
                <tr key={tier.key}>
                  <td className="border-b border-line px-1.5 py-2">
                    <span className="mr-1.5 inline-block size-2 rounded-sm align-middle" style={{ background: tier.color }} />
                    {tier.name}
                  </td>
                  <td className="border-b border-line px-1.5 py-2 tabular-nums">{n(usage.tiers_today[tier.key]?.uses)}</td>
                  <td className="border-b border-line px-1.5 py-2 tabular-nums">{n(usage.tiers_today[tier.key]?.people)}</td>
                  <td className="border-b border-line px-1.5 py-2 text-muted">{limitText[tier.key]}</td>
                  <td className="border-b border-line px-1.5 py-2 text-muted">{reachedText[tier.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 text-xs text-faint">등급은 지금 기준이에요. 구독을 해지한 사람의 옛 사용은 현재 등급으로 세어져요. 탈퇴한 회원의 기록은 등급을 알 수 없어서 따로 모아요. 비회원은 접속 하나당 전체 한도라서 오늘이 아니라 지금까지 다 쓴 접속 수를 세요.</p>
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-[0.9375rem] font-medium">비용·토큰</h2>
        <p className="text-sm text-muted">미연결 — 실제 AI를 연결하면 제공사, 모델, 토큰, 비용이 여기에 나오고, 위 막대가 &quot;횟수&quot;에서 &quot;비용(원)&quot;으로 바뀌어요. 지금은 규칙 기반 시험용이라 비용이 들지 않아요.</p>
      </section>
    </>
  );
}

export default function AdminAi(props: PageProps<"/admin/ai">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
      <AdminAiContent searchParams={props.searchParams} />
    </Suspense>
  );
}
