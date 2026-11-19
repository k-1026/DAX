// 피드백 분석(주 1회): AI 분류 → 2차 재검수 → 리포트·보정안
// 규칙: 앱 개발/01_에이전트_AI서비스_제안.md A-2-2, A-2-4
import type { DeliveryResult, MailMessage } from "../mail/batch";
import type { PipelineCall, Step } from "../pipeline/orchestrator";

export const REASONS = ["rent_terms", "space", "location", "entry", "info_error", "other"] as const;
export type Reason = (typeof REASONS)[number];

export type ReviewItem = { id: string; text: string };

export type Classifier = {
  provider: string;
  model: string;
  isTest: boolean;
  classify: (items: ReviewItem[]) => Promise<{ id: string; reason: string }[]>;
};

export type FeedbackDeps = {
  primary: Classifier;
  secondary: Classifier;
  alertTo: string[];
  deliver: (message: MailMessage) => Promise<DeliveryResult>;
  // 가짜 분류 결과를 리포트에 넣을지 (시험에서만 true)
  includeTest?: boolean;
};

const BATCH_SIZE = 50;
// Vercel 실행 시간 안에 끝나도록 한 번에 최대 1,000건만 분류한다. 남은 것은 다음 주에 이어서.
const MAX_ROUNDS = 20;

const LABELS: Record<string, string> = {
  rent_terms: "임대료·조건",
  space: "공간 상태",
  location: "입지·상권",
  entry: "입점 어려움",
  info_error: "정보 오류",
  other: "기타",
};

// 개발용 가짜 분류기: 낱말로 사유를 고른다. 결과는 시험용으로 표시되어 통계에서 빠진다.
// AI 키를 연결하면 같은 모양(Classifier)의 Claude·ChatGPT 분류기로 바꾼다.
const KEYWORDS: [Reason, RegExp][] = [
  ["info_error", /정보|다르|허위|사진|없는 매물|이미 나간/],
  ["entry", /용도|허가|입점|배기|업종 제한|전기 용량/],
  ["rent_terms", /월세|보증금|권리금|임대료|관리비|비싸|가격/],
  ["space", /좁|누수|화장실|낡|천장|주차|면적|구조/],
  ["location", /유동|상권|입지|위치|역|골목|사람이 없|접근/],
];

export function fakeClassifier(variant: "a" | "b" = "a"): Classifier {
  // b는 순서를 바꿔 두 AI가 가끔 다르게 판단하는 상황을 흉내 낸다.
  const order = variant === "a" ? KEYWORDS : [...KEYWORDS].reverse();
  return {
    provider: `fake-${variant}`,
    model: "keyword",
    isTest: true,
    classify: async (items) =>
      items.map((item) => ({
        id: item.id,
        reason: order.find(([, pattern]) => pattern.test(item.text))?.[0] ?? "other",
      })),
  };
}

function validReason(reason: unknown): reason is Reason {
  return typeof reason === "string" && (REASONS as readonly string[]).includes(reason);
}

async function classifyFirst(call: PipelineCall, deps: FeedbackDeps) {
  const { primary } = deps;
  let classified = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const items = (await call("feedback_to_classify", {
      p_provider: primary.provider,
      p_limit: BATCH_SIZE,
    })) as ReviewItem[];
    if (!items?.length) break;

    const results = (await primary.classify(items)).filter((result) => validReason(result.reason));
    const saved = (await call("feedback_record", {
      p_stage: "first",
      p_provider: primary.provider,
      p_model: primary.model,
      p_is_test: primary.isTest,
      p_items: results,
    })) as number;
    classified += saved;
    // 분류 결과가 하나도 저장되지 않으면 같은 리뷰를 계속 보내지 않도록 멈춘다.
    if (saved === 0) break;
  }
  return { classified };
}

async function classifySecond(call: PipelineCall, deps: FeedbackDeps) {
  const { primary, secondary } = deps;
  const items = (await call("feedback_second_sample", { p_provider: primary.provider })) as ReviewItem[];
  if (!items?.length) return { checked: 0 };

  const [first, second] = await Promise.all([primary.classify(items), secondary.classify(items)]);
  const other = new Map(second.map((result) => [result.id, result.reason]));
  const merged = first
    .filter((result) => validReason(result.reason) && validReason(other.get(result.id)))
    .map((result) => ({ id: result.id, reason: result.reason, other_reason: other.get(result.id) }));

  const checked = (await call("feedback_record", {
    p_stage: "second",
    p_provider: primary.provider,
    p_model: `${primary.model} vs ${secondary.provider}/${secondary.model}`,
    p_is_test: primary.isTest || secondary.isTest,
    p_items: merged,
  })) as number;
  return { checked };
}

type CheckSummary = { total: number; matched: number; rate: number | null; status: string };
type WeeklyReport = {
  alert: boolean;
  checks: { first: CheckSummary; second: CheckSummary };
  proposals: unknown[];
  categories: unknown[];
};

// 일치율이 기준에 못 미칠 때만 보내는 관리자 알림. 리뷰 글은 넣지 않고 건수와 비율만 적는다.
export function buildFeedbackAlertMail(to: string, report: WeeklyReport): MailMessage {
  const line = (name: string, check: CheckSummary) =>
    `${name}: ${check.total}건 중 ${check.matched}건 일치 (${check.rate ?? "-"}%, ${
      check.status === "fail" ? "기준 미달" : check.status === "pass" ? "통과" : "판단 보류"
    })`;
  const lines = [
    line("1. 1차 자동 채점", report.checks.first),
    line("2. 2차 AI 재검수", report.checks.second),
    "3. 관리자 화면에서 틀린 사례 5건을 확인해 주세요.",
  ];
  return {
    to,
    subject: "[대구 공실 매칭 알림] AI 리뷰 분류 일치율 기준 미달",
    text: lines.join("\n"),
    html: `<ol>${lines.map((text) => `<li>${text.replace(/^\d\. /, "")}</li>`).join("")}</ol>`,
  };
}

export function reasonLabel(reason: string) {
  return LABELS[reason] ?? reason;
}

export function feedbackSteps(deps: FeedbackDeps): Step[] {
  return [
    { key: "feedback_classify", run: (call) => classifyFirst(call, deps) },
    { key: "feedback_second_check", run: (call) => classifySecond(call, deps) },
    {
      key: "feedback_report",
      run: async (call) => {
        const report = (await call("feedback_weekly_report", {
          p_include_test: deps.includeTest ?? false,
        })) as WeeklyReport;
        let mailed = 0;
        if (report.alert) {
          for (const to of deps.alertTo) {
            try {
              await deps.deliver(buildFeedbackAlertMail(to, report));
              mailed += 1;
            } catch (cause) {
              console.error("피드백 알림 메일 발송 실패:", cause instanceof Error ? cause.message : cause);
            }
          }
        }
        return { ...report, mailed };
      },
    },
  ];
}
