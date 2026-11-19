// 품질 평가(주 1회): 에이전트별 지표를 계산해 주간 리포트로 남긴다.
// 수치는 DB 함수(quality_weekly_report)가 계산한다. 규칙: 앱 개발/01_에이전트_AI서비스_제안.md A-2-5
import type { Step } from "../pipeline/orchestrator";

export function qualityStep(includeTest = false): Step {
  return {
    key: "quality_eval",
    run: (call, runId) =>
      call("quality_weekly_report", { p_run: runId, p_include_test: includeTest }),
  };
}
