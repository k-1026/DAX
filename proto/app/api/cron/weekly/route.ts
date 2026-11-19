// 예약 실행용: 매주 월요일 새벽 3시 주간 실행 (피드백 분석 → 품질 평가 → 개선 제안)
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { fakeClassifier, feedbackSteps } from "@/lib/feedback/analysis";
import { fakeGrouper, improvementSteps } from "@/lib/improvement/candidates";
import { createMailDeps } from "@/lib/mail/runtime";
import { runSteps, type PipelineCall } from "@/lib/pipeline/orchestrator";
import { qualityStep } from "@/lib/quality/report";
import { createServiceClient } from "@/lib/supabase/service";

function isAuthorized(header: string | null, secret: string) {
  if (!header?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !isAuthorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "인증에 실패했습니다." }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "설정이 완료되지 않았습니다." }, { status: 503 });
  }

  const call: PipelineCall = async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };

  const { data: runId, error } = await supabase.rpc("weekly_start_run");
  if (error) {
    return error.code === "23505"
      ? NextResponse.json({ error: "이미 실행 중인 주간 작업이 있습니다." }, { status: 409 })
      : NextResponse.json({ error: "주간 작업을 시작하지 못했습니다." }, { status: 500 });
  }

  const { deliver } = createMailDeps();
  const alertTo = (process.env.MONITOR_ALERT_TO ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);

  // AI 키를 연결하기 전까지는 가짜 분류기·가짜 묶기를 쓴다. 결과는 시험용으로 표시되어 통계·후보에서 빠진다.
  const result = await runSteps(
    call,
    runId as string,
    [
      ...feedbackSteps({ primary: fakeClassifier("a"), secondary: fakeClassifier("b"), alertTo, deliver }),
      qualityStep(),
      ...improvementSteps(fakeGrouper()),
    ],
  );

  return NextResponse.json(
    { runId, status: result.status, step: result.step },
    { status: result.status === "failed" ? 500 : 200 },
  );
}
