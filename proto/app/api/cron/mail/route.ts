// 예약 실행용: 야간에 미룬 메일과 2년 주기 수신 동의 안내를 보낸다.
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runMailMaintenance, type MailCall } from "@/lib/mail/batch";
import { createMailDeps } from "@/lib/mail/runtime";
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

  const call: MailCall = async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };

  return NextResponse.json(await runMailMaintenance(call, createMailDeps()));
}
