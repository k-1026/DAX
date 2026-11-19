// 수집 결과를 받아 3일 갱신 파이프라인을 실행하는 API
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sendBatchMails } from "@/lib/mail/batch";
import { createMailDeps } from "@/lib/mail/runtime";
import { runPipeline, type PipelineCall } from "@/lib/pipeline/orchestrator";
import { createServiceClient } from "@/lib/supabase/service";

// Vercel 함수의 요청 크기 한도(4.5MB)보다 작게 둔다.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 10_000;

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function isAuthorized(header: string | null, secret: string) {
  if (!header?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

// 크기를 넘으면 끝까지 읽지 않고 중단한다.
async function readBody(request: NextRequest) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return reply(503, { error: "수집 API가 설정되지 않았습니다." });
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return reply(401, { error: "인증에 실패했습니다." });
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return reply(413, { error: "파일이 너무 큽니다." });
  }
  const text = await readBody(request);
  if (text === null) return reply(413, { error: "파일이 너무 큽니다." });

  let body: { source?: unknown; items?: unknown; collected_at?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "JSON 형식이 올바르지 않습니다." });
  }

  const { source, items, collected_at: collectedAt } = body ?? {};
  if (typeof source !== "string" || !/^[a-z0-9_-]{1,40}$/.test(source)) {
    return reply(400, { error: "source 값이 올바르지 않습니다." });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    return reply(400, { error: `items는 1건 이상 ${MAX_ITEMS}건 이하여야 합니다.` });
  }

  // 실제 수집 시각 (없으면 업로드 시각). 30일 이내만 받는다(DB에서 확인).
  if (collectedAt !== undefined && (typeof collectedAt !== "string" || Number.isNaN(Date.parse(collectedAt)))) {
    return reply(400, { error: "collected_at 값이 올바르지 않습니다." });
  }

  const supabase = createServiceClient();
  if (!supabase) return reply(503, { error: "수집 API가 설정되지 않았습니다." });

  const call: PipelineCall = async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };

  const { data: runId, error } = await supabase.rpc("pipeline_start_run", {
    p_source: source,
    p_items: items,
    p_collected_at: collectedAt ?? null,
  });
  if (error) {
    return error.code === "23505"
      ? reply(409, { error: "이미 실행 중인 갱신이 있습니다." })
      : reply(500, { error: "갱신을 시작하지 못했습니다." });
  }

  const result = await runPipeline(call, runId as string, undefined, (id) =>
    sendBatchMails(call, id, createMailDeps()),
  );
  if (result.status === "failed") {
    return reply(500, { runId, status: result.status, step: result.step });
  }
  return reply(result.status === "held" ? 202 : 200, {
    runId,
    status: result.status,
    step: result.step,
  });
}
