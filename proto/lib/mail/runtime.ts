// 서버 전용 메일 설정: Resend 발송과 수신 거부 링크
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeliveryResult, MailDeps, MailMessage } from "./batch";

// MAIL_MODE=live 를 직접 설정하기 전까지는 실제 회원에게 보내지 않고 시험 주소로만 보낸다.
const TEST_RECIPIENT = "delivered@resend.dev";

function signature(userId: string) {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET이 설정되지 않았습니다.");
  return createHmac("sha256", secret).update(userId).digest("base64url");
}

export function createUnsubscribeToken(userId: string) {
  return `${userId}.${signature(userId)}`;
}

export function readUnsubscribeToken(token: string | null) {
  const [userId, given] = (token ?? "").split(".");
  if (!userId || !given || !process.env.UNSUBSCRIBE_SECRET) return null;
  const expected = Buffer.from(signature(userId));
  const received = Buffer.from(given);
  if (expected.length !== received.length) return null;
  return timingSafeEqual(expected, received) ? userId : null;
}

async function deliver(message: MailMessage): Promise<DeliveryResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: "preview" };

  const live = process.env.MAIL_MODE === "live";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "대구 공실 매칭 <onboarding@resend.dev>",
      to: [live ? message.to : TEST_RECIPIENT],
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) throw new Error(body.message ?? `메일 발송 실패 (${response.status})`);
  return { status: "sent", id: body.id };
}

export function createMailDeps(): MailDeps {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return {
    deliver,
    siteUrl,
    contact: process.env.MAIL_CONTACT || "출시 전 등록 예정",
    unsubscribeUrl: (userId) =>
      `${siteUrl}/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(userId))}`,
  };
}
