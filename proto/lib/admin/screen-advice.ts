// 관리자 화면 4곳의 "다음에 할 일 제안"에 쓰는 숫자(신호)를 한곳에서 만든다. 각 화면과 개요의 "현재 관리자 확인 필요 사항"이 같은 계산을 쓴다.
import type { createClient } from "@/lib/supabase/server";
import { loadAgentView } from "./agent-view";
import { buildAiSignals, type AiUsageForAdvice } from "./ai-signals";
import type { Advice, Signals } from "./playbook";
import { adviseScreen, type PlaybookScreen } from "./playbook-files";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ======================= 메일 =======================
export type MailRow = { kind: string; status: string; created_at: string };

// 지금 시각을 쓰는 계산은 화면 함수 밖에 둔다.
export function mailTimes() {
  const now = Date.now();
  const kst = new Date(now + 9 * HOUR);
  const monthStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * HOUR);
  const days = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - (13 - i)) - 9 * HOUR);
    return { start: day.getTime(), label: `${new Date(day.getTime() + 9 * HOUR).getUTCMonth() + 1}/${new Date(day.getTime() + 9 * HOUR).getUTCDate()}` };
  });
  return {
    monthStart: monthStart.toISOString(),
    since24h: new Date(now - DAY).toISOString(),
    overdue: new Date(now - HOUR).toISOString(),
    week1: new Date(now - 7 * DAY).toISOString(),
    week2: new Date(now - 14 * DAY).toISOString(),
    fetchFrom: new Date(Math.min(monthStart.getTime(), days[0].start)).toISOString(),
    days,
    now,
  };
}

export async function fetchMailInputs(supabase: Supabase) {
  const t = mailTimes();
  const consent = () => supabase.from("user_consents").select("user_id", { count: "exact", head: true }).eq("consent_type", "email");
  const [rowsRes, recent, waiting, overdue, unsubWeek, unsubPrev, consenting, minPct] = await Promise.all([
    supabase.from("email_sends").select("kind, status, created_at").gte("created_at", t.fetchFrom).order("created_at", { ascending: false }).limit(5000),
    supabase.from("email_sends").select("id, kind, status, error, created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("email_sends").select("id", { count: "exact", head: true }).in("status", ["deferred", "queued"]),
    supabase.from("email_sends").select("id", { count: "exact", head: true }).eq("status", "deferred").lt("scheduled_for", t.overdue),
    // 탈퇴한 회원의 동의 기록은 회원 번호가 비워진 채 "철회"로 남으므로, 직접 수신 거부한 사람(회원 번호가 있는 기록)만 센다.
    consent().not("user_id", "is", null).gte("withdrawn_at", t.week1),
    consent().not("user_id", "is", null).gte("withdrawn_at", t.week2).lt("withdrawn_at", t.week1),
    consent().is("withdrawn_at", null),
    supabase.from("app_settings").select("value").eq("description", "최근 24시간 메일 성공률 하한 (%)").maybeSingle(),
  ]);
  return { t, rowsRes, recent, waiting, overdue, unsubWeek, unsubPrev, consenting, minPct };
}
export type MailInputs = Awaited<ReturnType<typeof fetchMailInputs>>;

export function mailSignals(inputs: MailInputs): Signals {
  const { t, rowsRes, waiting, overdue, unsubWeek, unsubPrev, consenting, minPct } = inputs;
  const rows = (rowsRes.data ?? []) as MailRow[];
  const month = rows.filter((row) => row.created_at >= t.monthStart);
  const last24 = rows.filter((row) => row.created_at >= t.since24h);
  const count = (list: MailRow[], status: string) => list.filter((row) => row.status === status).length;
  const sent24 = count(last24, "sent");
  const failed24 = count(last24, "failed");
  const unsubNow = unsubWeek.count ?? 0;
  const unsubBefore = unsubPrev.count ?? 0;
  return {
    발송_24시간: sent24 + failed24,
    성공률_24시간: sent24 + failed24 === 0 ? 100 : Math.round((sent24 / (sent24 + failed24)) * 100),
    성공률_기준: typeof minPct.data?.value === "number" ? minPct.data.value : 95,
    실패_24시간: failed24,
    이번달_발송: count(month, "sent"),
    이번달_실패: count(month, "failed"),
    지연_미룸_수: overdue.count ?? 0,
    대기_수: waiting.count ?? 0,
    수신거부_7일: unsubNow,
    수신거부_전주: unsubBefore,
    수신거부_배수: Math.round((unsubNow / Math.max(unsubBefore, 1)) * 10) / 10,
    수신_동의_인원: consenting.count ?? 0,
    발송_7일: rows.filter((row) => row.created_at >= t.week1 && row.status === "sent").length,
  };
}

// ======================= 매물 갱신 =======================
export type ListingStep = { step_key: string; step_order: number; status: string; result: Record<string, unknown> | null; error: string | null };
export type ListingRun = { id: string; status: string; started_at: string; finished_at: string | null; error: string | null; agent_steps: ListingStep[] };

export const numberOrNull = (value: unknown) => (typeof value === "number" ? value : null);
export const stepOf = (run: ListingRun, key: string) => run.agent_steps.find((step) => step.step_key === key);
export const diffOf = (run: ListingRun) => (stepOf(run, "diff")?.result ?? null) as Record<string, unknown> | null;

const hoursSince = (date: Date) => Math.floor((Date.now() - date.getTime()) / HOUR);

export async function fetchListingsInputs(supabase: Supabase) {
  const [{ data }, active, limitRow] = await Promise.all([
    supabase
      .from("agent_runs")
      .select("id, status, started_at, finished_at, error, agent_steps(step_key, step_order, status, result, error)")
      .eq("run_type", "refresh")
      .order("started_at", { ascending: false })
      .limit(12),
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("app_settings").select("value").eq("description", "마지막 갱신 성공 후 경보까지 시간").maybeSingle(),
  ]);
  const runs = ((data ?? []) as unknown as ListingRun[]).map((run) => ({ ...run, agent_steps: [...run.agent_steps].sort((a, b) => a.step_order - b.step_order) }));
  return { runs, active, limitRow };
}
export type ListingsInputs = Awaited<ReturnType<typeof fetchListingsInputs>>;

export function listingsSignals({ runs, active, limitRow }: ListingsInputs): Signals {
  const last = runs[0];
  const lastAt = last ? new Date(last.finished_at ?? last.started_at) : null;
  const lastDiff = runs.map(diffOf).find((d) => d !== null) ?? null;
  const held = runs.filter((run) => run.status === "held");
  const succeeded = runs.find((run) => run.status === "succeeded");
  let zeroStreak = 0;
  for (const run of runs) {
    if (run.status !== "succeeded") continue;
    const diff = diffOf(run);
    if (!diff || numberOrNull(diff.new) !== 0) break;
    zeroStreak += 1;
  }
  const publicCount = active.count ?? 0;
  const goneNow = numberOrNull(lastDiff?.gone) ?? 0;
  return {
    기록_없음: runs.length === 0 ? 1 : 0,
    갱신_경과_시간: lastAt ? hoursSince(lastAt) : 0,
    갱신_경보_기준_시간: typeof limitRow.data?.value === "number" ? limitRow.data.value : 78,
    마지막_보류: last?.status === "held" ? 1 : 0,
    마지막_실패: last && (last.status === "failed" || last.status === "rejected") ? 1 : 0,
    보류_횟수: held.length,
    마지막_실패_단계_수: last ? last.agent_steps.filter((step) => step.status === "failed").length : 0,
    마지막_신규: numberOrNull(lastDiff?.new) ?? 0,
    마지막_바뀜: numberOrNull(lastDiff?.changed) ?? 0,
    마지막_나감: goneNow,
    공개_매물_수: publicCount,
    나감_비율_퍼센트: publicCount + goneNow > 0 ? Math.round((goneNow / (publicCount + goneNow)) * 100) : 0,
    연속_신규0_횟수: zeroStreak,
    마지막_성공_경과_시간: succeeded ? hoursSince(new Date(succeeded.finished_at ?? succeeded.started_at)) : 0,
  };
}


// ======================= 품질·개선 제안 =======================
export type QualityMetric = {
  agent: string;
  key: string;
  label: string;
  kind?: string;
  value: number | null;
  unit?: string | null;
  threshold?: string | null;
  samples?: number | null;
  status: string;
  detail?: string | null;
  previous?: number | null;
  change?: number | null;
  streak?: number | null;
};
export type QualityReport = { id: string; created_at: string; summary: string; before_collection: boolean; metrics: QualityMetric[]; warnings: QualityMetric[] };
export type Candidate = {
  id: string;
  source: "quality" | "review" | "urgent";
  agent: string | null;
  title: string;
  detail: string | null;
  users_count: number;
  evidence_count: number;
  streak: number;
  urgent: boolean;
  status: "candidate" | "adopted" | "held" | "rejected";
  reason: string | null;
  reviewed_at: string | null;
  is_test: boolean;
  created_at: string;
};

export async function fetchQualityInputs(supabase: Supabase) {
  const [reports, candidates, limitRow] = await Promise.all([
    supabase.from("quality_reports").select("id, created_at, summary, before_collection, metrics, warnings").order("created_at", { ascending: false }).limit(8),
    supabase
      .from("improvement_candidates")
      .select("id, source, agent, title, detail, users_count, evidence_count, streak, urgent, status, reason, reviewed_at, is_test, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("app_settings").select("value").eq("description", "주간 실행이 성공하지 않은 채 경보까지 일수").maybeSingle(),
  ]);
  return { reports, candidates, limitRow };
}
export type QualityInputs = Awaited<ReturnType<typeof fetchQualityInputs>>;

const asList = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function qualityParts(inputs: QualityInputs) {
  const reports = ((inputs.reports.data ?? []) as unknown as QualityReport[]).map((report) => ({ ...report, metrics: asList<QualityMetric>(report.metrics), warnings: asList<QualityMetric>(report.warnings) }));
  const all = (inputs.candidates.data ?? []) as unknown as Candidate[];
  const real = all.filter((item) => !item.is_test);
  return { reports, real, testCount: all.length - real.length };
}

export function qualitySignals(inputs: QualityInputs): Signals {
  const { reports, real, testCount } = qualityParts(inputs);
  const latest = reports[0];
  const open = real.filter((item) => item.status === "candidate" || item.status === "held");
  const fresh = real.filter((item) => item.status === "candidate");
  const oldest = open.length ? Math.max(...open.map((item) => Math.floor((Date.now() - new Date(item.created_at).getTime()) / DAY))) : 0;
  const metrics = latest?.metrics ?? [];
  return {
    리포트_없음: latest ? 0 : 1,
    리포트_경과_일: latest ? Math.floor((Date.now() - new Date(latest.created_at).getTime()) / DAY) : 0,
    리포트_경보_기준_일: typeof inputs.limitRow.data?.value === "number" ? inputs.limitRow.data.value : 8,
    측정전: latest?.before_collection ? 1 : 0,
    주의_지표_수: metrics.filter((item) => item.status === "warn").length,
    판단보류_지표_수: metrics.filter((item) => item.status === "pending").length,
    측정전_지표_수: metrics.filter((item) => item.status === "unmeasured").length,
    연속_주의_최대: Math.max(0, ...metrics.filter((item) => item.status === "warn").map((item) => item.streak ?? 0)),
    긴급_후보_수: open.filter((item) => item.urgent).length,
    열린_후보_수: open.length,
    새_후보_수: fresh.length,
    보류_후보_수: open.length - fresh.length,
    가장_오래된_후보_일: oldest,
    시험용_후보_수: testCount,
  };
}


// ======================= 가중치 보정안 =======================
export type WeightProposal = {
  id: string;
  target_group: "cost" | "space" | "location" | "fit";
  evidence: { samples?: number; users?: number; top_group?: string; top_pct?: number | null; good_ratio?: number | null; reason_counts?: Record<string, number> };
  small_sample: boolean;
  status: "pending" | "approved" | "rejected";
  review_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  business_categories: { name: string } | { name: string }[] | null;
};
export type FeedbackCheck = { total: number; matched: number; rate: number | null; status: "pending" | "pass" | "fail"; min_samples: number; pass_pct: number };
export type FeedbackReport = {
  threshold_set: boolean;
  categories: { category: string; total: number; good: number; bad: number; good_ratio: number | null; reason_counts: Record<string, number>; progress: { samples: number; min_samples: number; users: number; min_users: number }; ready: boolean; proposal_id: string | null }[];
  uncategorized: { total: number; good: number } | null;
  checks: { first: FeedbackCheck; second: FeedbackCheck };
};
export const REASON_LABEL: Record<string, string> = { rent_terms: "임대료·조건", space: "공간 상태", location: "입지·상권", entry: "입점 어려움", info_error: "정보 오류", other: "기타" };
export const REASON_KEYS = Object.keys(REASON_LABEL);

export async function fetchWeightsInputs(supabase: Supabase) {
  const [proposals, categories, versions, settings, total, good, bad, weekly] = await Promise.all([
    supabase.from("weight_proposals").select("id, target_group, evidence, small_sample, status, review_reason, reviewed_at, created_at, business_categories(name)").order("created_at", { ascending: false }).limit(50),
    supabase.from("business_categories").select("id", { count: "exact", head: true }),
    supabase.from("scoring_versions").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("app_settings").select("value, description").in("description", ["보정안을 내는 기준 비율 (%) — 스코어링 확정 때 정함", "보정안 최소 표본: 사유를 고른 bad 평가 수 (회원 증가 후 20)", "보정안 최소 사용자 수 (회원 증가 후 5)"]),
    supabase.from("listing_feedback").select("id", { count: "exact", head: true }),
    supabase.from("listing_feedback").select("id", { count: "exact", head: true }).eq("rating", "good"),
    supabase.from("listing_feedback").select("bad_reasons").eq("rating", "bad").limit(5000),
    supabase.from("agent_runs").select("id, started_at, agent_steps(step_key, status, result, finished_at)").eq("run_type", "weekly").order("started_at", { ascending: false }).limit(6),
  ]);
  return { proposals, categories, versions, settings, total, good, bad, weekly };
}
export type WeightsInputs = Awaited<ReturnType<typeof fetchWeightsInputs>>;

export function weightsParts(inputs: WeightsInputs) {
  const proposals = (inputs.proposals.data ?? []) as unknown as WeightProposal[];
  const setting = (word: string) => (inputs.settings.data ?? []).find((row) => row.description?.includes(word))?.value;
  const threshold = setting("기준 비율");
  const minSamples = typeof setting("최소 표본") === "number" ? (setting("최소 표본") as number) : 10;
  const minUsers = typeof setting("최소 사용자") === "number" ? (setting("최소 사용자") as number) : 3;
  const badRows = (inputs.bad.data ?? []) as { bad_reasons: string[] | null }[];
  const reasonCounts: Record<string, number> = Object.fromEntries(REASON_KEYS.map((key) => [key, 0]));
  let withReason = 0;
  for (const row of badRows) {
    const reasons = row.bad_reasons ?? [];
    if (reasons.length > 0) withReason += 1;
    for (const reason of reasons) if (reason in reasonCounts) reasonCounts[reason] += 1;
  }
  // 가장 최근 주간 분석의 피드백 리포트 결과
  let report: FeedbackReport | null = null;
  let reportAt: string | null = null;
  for (const run of (inputs.weekly.data ?? []) as unknown as { started_at: string; agent_steps: { step_key: string; status: string; result: unknown; finished_at: string | null }[] }[]) {
    const step = run.agent_steps.find((item) => item.step_key === "feedback_report" && item.result && typeof item.result === "object");
    if (step) {
      report = step.result as FeedbackReport;
      reportAt = step.finished_at ?? run.started_at;
      break;
    }
  }
  return {
    proposals,
    threshold,
    minSamples,
    minUsers,
    categoryCount: inputs.categories.count ?? 0,
    activeVersions: inputs.versions.count ?? 0,
    total: inputs.total.count ?? 0,
    good: inputs.good.count ?? 0,
    bad: badRows.length,
    withReason,
    reasonCounts,
    report,
    reportAt,
  };
}

export function weightsSignals(inputs: WeightsInputs): Signals {
  const parts = weightsParts(inputs);
  const pending = parts.proposals.filter((item) => item.status === "pending");
  const top = Object.entries(parts.reasonCounts).sort((a, b) => b[1] - a[1])[0];
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const thresholdSet = parts.threshold !== null && parts.threshold !== undefined;
  const ready = parts.categoryCount > 0 && parts.activeVersions > 0 && thresholdSet;
  const failing = parts.report ? [parts.report.checks?.first, parts.report.checks?.second].find((check) => check?.status === "fail") : undefined;
  const shown = parts.report?.checks?.first;
  return {
    보정안_대기_수: pending.length,
    보정안_승인_수: parts.proposals.filter((item) => item.status === "approved").length,
    보정안_반려_수: parts.proposals.filter((item) => item.status === "rejected").length,
    표본적음_대기_수: pending.filter((item) => item.small_sample).length,
    업종_수: parts.categoryCount,
    활성_점수_버전_수: parts.activeVersions,
    기준비율_정함: thresholdSet ? 1 : 0,
    기준비율_상태: thresholdSet ? "정해짐" : "미확정",
    준비_완료: ready ? 1 : 0,
    평가_전체: parts.total,
    평가_좋아요: parts.good,
    평가_싫어요: parts.bad,
    사유_선택_싫어요: parts.withReason,
    보정안_최소_표본: parts.minSamples,
    보정안_최소_사용자: parts.minUsers,
    표본_부족: parts.withReason < parts.minSamples ? 1 : 0,
    사유_최다_이름: top && top[1] > 0 ? REASON_LABEL[top[0]] : "없음",
    사유_최다_비율: top ? pct(top[1], parts.withReason) : 0,
    정보오류_비율: pct(parts.reasonCounts.info_error ?? 0, parts.withReason),
    주간_리포트_없음: parts.report ? 0 : 1,
    분류확인_실패: failing ? 1 : 0,
    분류확인_일치율: (failing ?? shown)?.rate ?? 0,
    분류확인_기준: (failing ?? shown)?.pass_pct ?? 80,
  };
}


// ======================= 사용자 현황 =======================
export const WITHDRAWAL_LABEL: Record<string, string> = {
  no_listing: "원하는 매물이 없어요",
  poor_recommendation: "추천이 잘 맞지 않아요",
  hard_to_use: "사용하기 불편해요",
  price: "요금이 부담돼요",
  plan_changed: "창업 계획이 바뀌었어요",
  privacy: "개인정보가 걱정돼요",
  other: "기타",
};

// 지금 시각을 쓰는 계산은 화면 함수 밖에 둔다. 날짜는 한국 시간 기준이다.
export function userTimes() {
  const now = Date.now();
  const kstDay = (offsetDays: number) => {
    const kst = new Date(now + 9 * HOUR);
    const start = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - offsetDays) - 9 * HOUR;
    return start;
  };
  return { now, nowIso: new Date(now).toISOString(), kstDay };
}

export async function fetchUsersInputs(supabase: Supabase) {
  const t = userTimes();
  const consent = (type: string) => supabase.from("user_consents").select("id", { count: "exact", head: true }).eq("consent_type", type).is("withdrawn_at", null).not("user_id", "is", null);
  const [profiles, subs, mailConsent, behaviorConsent, addresses, withdrawals] = await Promise.all([
    // 가입 시각과 역할만 읽는다(이름·이메일은 읽지 않는다).
    supabase.from("profiles").select("created_at, role").is("deleted_at", null).order("created_at", { ascending: false }).limit(20000),
    // 구독 회원 수를 중복 없이 세려고 회원 번호를 서버 안에서만 잠깐 읽는다(화면으로 보내지 않는다).
    supabase
      .from("subscriptions")
      .select("user_id")
      .or(`and(status.in.(active,canceled),current_period_end.gt.${t.nowIso}),and(status.eq.past_due,grace_until.gt.${t.nowIso})`)
      .limit(5000),
    consent("email"),
    consent("behavior_tracking"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).is("deleted_at", null).not("contact_email", "is", null),
    supabase.from("account_withdrawals").select("reason_code, withdrawn_at").order("withdrawn_at", { ascending: false }).limit(5000),
  ]);
  return { t, profiles, subs, mailConsent, behaviorConsent, addresses, withdrawals };
}
export type UsersInputs = Awaited<ReturnType<typeof fetchUsersInputs>>;

const dayKey = (ms: number) => new Date(ms + 9 * HOUR).toISOString().slice(0, 10);

export function usersParts(inputs: UsersInputs, days: number) {
  const { t } = inputs;
  const rows = (inputs.profiles.data ?? []) as { created_at: string; role: string }[];
  const members = rows.filter((row) => row.role !== "admin");
  const admins = rows.length - members.length;
  const signupsByDay = new Map<string, number>();
  for (const row of members) {
    const key = dayKey(new Date(row.created_at).getTime());
    signupsByDay.set(key, (signupsByDay.get(key) ?? 0) + 1);
  }
  const countRange = (fromOffset: number, toOffset: number) => {
    // fromOffset일 전 0시(한국 시간)부터 toOffset일 전 0시 직전까지
    let sum = 0;
    for (let i = toOffset; i < fromOffset; i += 1) sum += signupsByDay.get(dayKey(t.kstDay(i))) ?? 0;
    return sum;
  };
  const series = Array.from({ length: days }, (_, i) => {
    const offset = days - 1 - i;
    const start = t.kstDay(offset);
    return { day: new Date(start + 9 * HOUR).toISOString().slice(5, 10).replace("-", "/"), count: signupsByDay.get(dayKey(start)) ?? 0 };
  });

  const subscribers = new Set(((inputs.subs.data ?? []) as { user_id: string }[]).map((row) => row.user_id)).size;
  const withdrawalRows = (inputs.withdrawals.data ?? []) as { reason_code: string | null; withdrawn_at: string }[];
  const wdInRange = (fromOffset: number, toOffset: number) => {
    const from = t.kstDay(fromOffset);
    const to = t.kstDay(toOffset);
    return withdrawalRows.filter((row) => {
      const at = new Date(row.withdrawn_at).getTime();
      return at >= from && at < to;
    });
  };
  const wd7 = wdInRange(6, -1);
  const wdPrev7 = wdInRange(13, 6);
  const wd30 = wdInRange(29, -1);
  const wdPeriod = wdInRange(days - 1, -1);
  const reasons = (list: typeof withdrawalRows) => {
    const counts: Record<string, number> = {};
    for (const row of list) {
      const key = row.reason_code ?? "other";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };

  return {
    members: members.length,
    admins,
    subscribers: Math.min(subscribers, members.length),
    series,
    today: signupsByDay.get(dayKey(t.kstDay(0))) ?? 0,
    avg7: Math.round((countRange(8, 1) / 7) * 10) / 10,
    signups7: countRange(7, 0),
    signupsPrev7: countRange(14, 7),
    signups14: countRange(14, 0),
    signups30: countRange(30, 0),
    signupsPeriod: countRange(days, 0),
    signupsPrevPeriod: countRange(days * 2, days),
    mailConsent: inputs.mailConsent.count ?? 0,
    behaviorConsent: inputs.behaviorConsent.count ?? 0,
    addresses: inputs.addresses.count ?? 0,
    withdrawals7: wd7.length,
    withdrawalsPrev7: wdPrev7.length,
    withdrawals30: wd30.length,
    withdrawalsPeriod: wdPeriod.length,
    reasonsPeriod: reasons(wdPeriod),
    reasons30: reasons(wd30),
  };
}

export function usersSignals(inputs: UsersInputs): Signals {
  const p = usersParts(inputs, 30);
  const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);
  const topReason = Object.entries(p.reasons30).sort((a, b) => b[1] - a[1])[0];
  return {
    전체_회원: p.members,
    관리자_수: p.admins,
    구독_회원_수: p.subscribers,
    일반_회원_수: Math.max(0, p.members - p.subscribers),
    신규_오늘: p.today,
    신규_평소: p.avg7,
    신규_7일: p.signups7,
    신규_전주: p.signupsPrev7,
    신규_14일: p.signups14,
    신규_30일: p.signups30,
    탈퇴_7일: p.withdrawals7,
    탈퇴_전주: p.withdrawalsPrev7,
    탈퇴_배수: Math.round((p.withdrawals7 / Math.max(p.withdrawalsPrev7, 1)) * 10) / 10,
    탈퇴_30일: p.withdrawals30,
    탈퇴율_퍼센트: p.signups30 > 0 ? Math.round((p.withdrawals30 / p.signups30) * 100) : 0,
    탈퇴_최다_사유: topReason ? (WITHDRAWAL_LABEL[topReason[0]] ?? topReason[0]) : "없음",
    탈퇴_최다_사유_비율: topReason ? pct(topReason[1], p.withdrawals30) : 0,
    메일_동의_수: p.mailConsent,
    메일_동의_퍼센트: pct(p.mailConsent, p.members + p.admins),
    행동기록_동의_퍼센트: pct(p.behaviorConsent, p.members + p.admins),
    메일주소_등록_수: p.addresses,
    메일주소_등록_퍼센트: pct(p.addresses, p.members + p.admins),
    구독_전환_퍼센트: pct(p.subscribers, p.members),
  };
}

// ======================= 개요: 현재 관리자 확인 필요 사항 =======================
export type AttentionGroup = { screen: PlaybookScreen; label: string; href: string; now: Advice[]; soon: Advice[] };

export async function collectAttention(supabase: Supabase): Promise<AttentionGroup[]> {
  const split = (advice: Advice[]) => ({ now: advice.filter((item) => item.level === "now"), soon: advice.filter((item) => item.level === "soon") });

  const [listingsInputs, mailInputs, qualityInputs, weightsInputs, usersInputs, aiRpc, agents] = await Promise.all([
    fetchListingsInputs(supabase),
    fetchMailInputs(supabase),
    fetchQualityInputs(supabase),
    fetchWeightsInputs(supabase),
    fetchUsersInputs(supabase),
    supabase.rpc("admin_ai_usage", { p_days: 30 }),
    loadAgentView(supabase, "refresh", null),
  ]);
  const [listings, mail, quality, weights, users, ai] = await Promise.all([
    adviseScreen("listings", listingsSignals(listingsInputs)),
    adviseScreen("mail", mailSignals(mailInputs)),
    adviseScreen("quality", qualitySignals(qualityInputs)),
    adviseScreen("weights", weightsSignals(weightsInputs)),
    adviseScreen("users", usersSignals(usersInputs)),
    aiRpc.data ? adviseScreen("ai", buildAiSignals(aiRpc.data as AiUsageForAdvice)) : Promise.resolve({ advice: [] as Advice[], errors: [] as string[] }),
  ]);

  return [
    { screen: "listings", label: "매물 갱신", href: "/admin/listings", ...split(listings.advice) },
    { screen: "agents", label: "에이전트 실행", href: "/admin/agents", ...split(agents.advice) },
    { screen: "mail", label: "메일 발송", href: "/admin/mail", ...split(mail.advice) },
    { screen: "quality", label: "품질·개선 제안", href: "/admin/quality", ...split(quality.advice) },
    { screen: "weights", label: "가중치 보정안", href: "/admin/weights", ...split(weights.advice) },
    { screen: "users", label: "사용자 현황", href: "/admin/users", ...split(users.advice) },
    { screen: "ai", label: "AI 사용량", href: "/admin/ai", ...split(ai.advice) },
  ];
}
