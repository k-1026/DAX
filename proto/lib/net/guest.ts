// 비로그인 방문자 확인용 도구 (서버 전용)
// - IP는 비밀값으로 해시해서만 넘긴다. 원래 주소는 DB에 남지 않는다.
// - 비로그인 목록에서 보여 준 매물에만 상세 열람 표시를 붙인다.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

function secret() {
  return process.env.IP_HASH_SECRET ?? null;
}

export async function guestIpHash() {
  const key = secret();
  if (!key) return null;
  const list = await headers();
  const ip =
    list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || "unknown";
  return createHmac("sha256", key).update(ip).digest("hex");
}

export function signDetailToken(listingId: string) {
  const key = secret();
  if (!key) return null;
  return createHmac("sha256", key).update(`detail:${listingId}`).digest("hex").slice(0, 32);
}

export function verifyDetailToken(listingId: string, token: string | undefined) {
  const expected = signDetailToken(listingId);
  if (!expected || !token || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
