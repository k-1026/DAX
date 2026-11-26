"use server";
// 시험 사이트 입장 비밀번호 확인
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GATE_COOKIE, gatePassword, gateToken } from "@/lib/gate";

export async function enterGate(_: string | null, form: FormData): Promise<string | null> {
  const password = gatePassword();
  const next = String(form.get("next") ?? "/");
  // 다른 사이트로 보내지 않도록 우리 사이트 안 경로만 허용
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (!password) redirect(target);
  if (String(form.get("password") ?? "") !== password) return "비밀번호가 맞지 않아요.";
  (await cookies()).set(GATE_COOKIE, await gateToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(target);
}
