// 추천 메일 수신 거부. 로그인 없이 메일의 링크만으로 처리한다.
import { NextResponse, type NextRequest } from "next/server";
import { buildUnsubscribeResult } from "@/lib/mail/batch";
import { createMailDeps, readUnsubscribeToken } from "@/lib/mail/runtime";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const userId = readUnsubscribeToken(request.nextUrl.searchParams.get("token"));
  if (!userId) {
    return NextResponse.json({ error: "수신 거부 링크가 올바르지 않습니다." }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 503 });
  }

  const form = await request.text();
  const { data, error } = await supabase.rpc("mail_unsubscribe", { p_user: userId });
  if (error) {
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 500 });
  }

  // 처리 결과 안내 메일. 실패해도 수신 거부 자체는 이미 완료되었다.
  const result = data as { changed: boolean; to: string | null };
  if (result.changed && result.to) {
    const deps = createMailDeps();
    const message = buildUnsubscribeResult(result.to, deps);
    const { data: sendId } = await supabase.rpc("mail_record_send", {
      p_user: userId,
      p_kind: "unsubscribe_result",
      p_run: null,
      p_to: result.to,
      p_subject: message.subject,
      p_status: "queued",
    });
    try {
      const delivery = await deps.deliver(message);
      await supabase.rpc("mail_mark_result", {
        p_send: sendId,
        p_status: delivery.status,
        p_resend_id: delivery.id ?? null,
      });
    } catch (cause) {
      await supabase.rpc("mail_mark_result", {
        p_send: sendId,
        p_status: "failed",
        p_error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  // 메일 앱의 원클릭 수신 거부는 화면 이동 없이 응답만 받는다.
  if (form.includes("List-Unsubscribe=One-Click")) {
    return new NextResponse(null, { status: 200 });
  }
  return NextResponse.redirect(new URL("/unsubscribe/done", request.url), 303);
}
