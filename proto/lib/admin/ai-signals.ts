// AI 사용량 화면의 숫자(집계 함수 결과)를 규칙 파일이 읽는 "신호"로 바꾼다. 계산만 하고 문구·기준은 md에 있다.
import type { Signals } from "./playbook";

type Buckets = { b1: number; b2: number; b3: number; b4: number } | null;
export type AiUsageForAdvice = {
  days: number;
  today: number;
  period: number;
  prev_period: number;
  avg7: number;
  features: Record<string, { today: number; month: number; period: number }>;
  series: { day: string; guest: number; member: number; subscriber: number; admin: number; withdrawn: number; ai1: number; ai2: number; ai3: number; ai4: number }[];
  distribution: { member: Buckets; subscriber: Buckets };
  reached: { member: number; subscriber: number; guest_total: number };
  guest_today: number;
  limits: { member: number; subscriber: number; guest_total: number; guest_cap: number };
};

const TIER_NAME = { guest: "비회원", member: "로그인 회원", subscriber: "구독 회원", admin: "관리자", withdrawn: "탈퇴 회원 기록" } as const;
const FEATURE_NAME = { ai1: "문장으로 찾기", ai2: "질문 칩·질문 입력창", ai3: "비교 요약", ai4: "공실이 대화" } as const;
const FEATURE_KEY = { ai1: "ai1_search_text", ai2: "ai2_explain", ai3: "ai3_compare", ai4: "ai4_assistant" } as const;

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function shares(b: Buckets) {
  const total = b ? b.b1 + b.b2 + b.b3 + b.b4 : 0;
  return { total, near: b ? pct(b.b3 + b.b4, total) : 0, full: b ? pct(b.b4, total) : 0, low: b ? pct(b.b1, total) : 0 };
}

export function buildAiSignals(usage: AiUsageForAdvice): Signals {
  const today = usage.series[usage.series.length - 1];
  const tierCounts = (Object.keys(TIER_NAME) as (keyof typeof TIER_NAME)[]).map((key) => [key, today?.[key] ?? 0] as const).sort((a, b) => b[1] - a[1]);
  const featureCounts = (Object.keys(FEATURE_NAME) as (keyof typeof FEATURE_NAME)[]).map((key) => [key, today?.[key] ?? 0] as const).sort((a, b) => b[1] - a[1]);
  const topTier = tierCounts[0] && tierCounts[0][1] > 0 ? tierCounts[0] : null;
  const topFeature = featureCounts[0] && featureCounts[0][1] > 0 ? featureCounts[0] : null;
  const featureSum = Object.values(usage.features).reduce((sum, item) => sum + item.period, 0);
  const featureTop = Object.entries(usage.features).sort((a, b) => b[1].period - a[1].period)[0];
  const featureTopKey = (Object.keys(FEATURE_KEY) as (keyof typeof FEATURE_KEY)[]).find((key) => FEATURE_KEY[key] === featureTop?.[0]);
  const member = shares(usage.distribution.member);
  const subscriber = shares(usage.distribution.subscriber);

  return {
    기간_일수: usage.days,
    오늘_사용: usage.today,
    평소_하루평균: usage.avg7,
    급증_배수: usage.avg7 > 0 ? Math.round((usage.today / usage.avg7) * 10) / 10 : 0,
    오늘_비회원_비중: pct(today?.guest ?? 0, usage.today),
    가장_늘어난_등급: topTier ? TIER_NAME[topTier[0]] : "없음",
    가장_늘어난_등급_횟수: topTier ? topTier[1] : 0,
    가장_늘어난_기능: topFeature ? FEATURE_NAME[topFeature[0]] : "없음",
    가장_늘어난_기능_횟수: topFeature ? topFeature[1] : 0,
    기간_사용: usage.period,
    지난기간_사용: usage.prev_period,
    증가_배수: usage.prev_period > 0 ? Math.round((usage.period / usage.prev_period) * 10) / 10 : 0,
    증가_퍼센트: usage.prev_period > 0 ? Math.round(((usage.period - usage.prev_period) / usage.prev_period) * 100) : 0,
    비회원_오늘: usage.guest_today,
    비회원_하루상한: usage.limits.guest_cap,
    비회원_상한_퍼센트: usage.limits.guest_cap > 0 ? Math.round((usage.guest_today / usage.limits.guest_cap) * 100) : 0,
    비회원_전체한도: usage.limits.guest_total,
    비회원_소진_접속수: usage.reached.guest_total,
    로그인_한도: usage.limits.member,
    로그인_표본: member.total,
    로그인_한도근접_퍼센트: member.near,
    로그인_한도소진_퍼센트: member.full,
    로그인_넉넉_퍼센트: member.low,
    구독_한도: usage.limits.subscriber,
    구독_표본: subscriber.total,
    구독_한도근접_퍼센트: subscriber.near,
    구독_한도소진_퍼센트: subscriber.full,
    기능_합계: featureSum,
    상위기능_이름: featureTopKey ? FEATURE_NAME[featureTopKey] : "없음",
    상위기능_비중: pct(featureTop?.[1].period ?? 0, featureSum),
    공실이_기간_사용: usage.features[FEATURE_KEY.ai4]?.period ?? 0,
  };
}
