// 3일 갱신 오케스트레이터: 단계를 순서대로 실행하고, 실패하면 3회까지 재시도한다.
// 실제 처리는 DB 함수(pipeline_*)가 맡고, 이 파일은 순서와 재시도만 관리한다.

export type PipelineCall = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type PipelineResult = {
  status: "succeeded" | "held" | "failed";
  step?: string;
  error?: string;
};

// 수집 품질 검사에서 비어 있으면 안 되는 항목 (11월 5일 자료로 확정, 2026-11-19)
export const REQUIRED_FIELDS = [
  "id",
  "gu",
  "dong",
  "floor",
  "area_m2",
  "deposit",
  "rent",
  "url",
  "confirmed_at",
];

export const MAX_ATTEMPTS = 3;

type StepResult = { status?: string; skipped?: boolean };

export type MailStep = (runId: string) => Promise<unknown>;

const STEPS: {
  key: string;
  run: (call: PipelineCall, runId: string, mail?: MailStep) => Promise<unknown>;
}[] = [
  {
    key: "quality_check",
    run: (call, runId) =>
      call("pipeline_quality_check", { p_run: runId, p_required: REQUIRED_FIELDS }),
  },
  { key: "diff", run: (call, runId) => call("pipeline_diff", { p_run: runId }) },
  { key: "validate", run: (call, runId) => call("pipeline_validate", { p_run: runId }) },
  { key: "score", run: (call, runId) => call("pipeline_score", { p_run: runId }) },
  {
    key: "mail",
    run: async (_call, runId, mail) =>
      mail ? mail(runId) : { skipped: true, reason: "메일 설정 전" },
  },
];

function finishStatus(result: StepResult) {
  if (result.status === "held") return "held";
  if (result.skipped) return "skipped";
  return "succeeded";
}

export type Step = {
  key: string;
  run: (call: PipelineCall, runId: string) => Promise<unknown>;
};

const defaultWait = (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, attempt * 1000));

export function runPipeline(
  call: PipelineCall,
  runId: string,
  wait: (attempt: number) => Promise<void> = defaultWait,
  mail?: MailStep,
): Promise<PipelineResult> {
  return runSteps(
    call,
    runId,
    STEPS.map((step) => ({ key: step.key, run: (c, id) => step.run(c, id, mail) })),
    wait,
  );
}

// 3일 갱신과 주간 실행이 함께 쓰는 단계 실행기
export async function runSteps(
  call: PipelineCall,
  runId: string,
  steps: Step[],
  wait: (attempt: number) => Promise<void> = defaultWait,
): Promise<PipelineResult> {
  for (const step of steps) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const shouldRun = await call("pipeline_step_begin", { p_run: runId, p_step: step.key });
      if (!shouldRun) break;

      try {
        const result = ((await step.run(call, runId)) ?? {}) as StepResult;
        const status = finishStatus(result);
        await call("pipeline_step_finish", {
          p_run: runId,
          p_step: step.key,
          p_status: status,
          p_result: result,
        });
        if (status === "held") return { status: "held", step: step.key };
        break;
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        const lastAttempt = attempt === MAX_ATTEMPTS;
        await call("pipeline_step_finish", {
          p_run: runId,
          p_step: step.key,
          p_status: lastAttempt ? "failed" : "retry",
          p_error: error,
        });
        if (lastAttempt) return { status: "failed", step: step.key, error };
        await wait(attempt);
      }
    }
  }
  return { status: "succeeded" };
}
