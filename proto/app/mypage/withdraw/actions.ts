"use server";
// 회원 탈퇴 처리
import { redirect } from "next/navigation";
import { WITHDRAWAL_REASONS } from "@/lib/legal/withdrawal-reasons";
import { createClient } from "@/lib/supabase/server";

export type WithdrawState = { error?: string };

export async function withdrawAccount(
  _prev: WithdrawState,
  formData: FormData,
): Promise<WithdrawState> {
  if (formData.get("confirm") !== "on") {
    return { error: "탈퇴 확인 항목을 체크해 주세요." };
  }

  const selected = formData.get("reason");
  const reason = WITHDRAWAL_REASONS.find((item) => item.code === selected)?.code;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const { error } = await supabase.rpc("withdraw_account", { reason });
  if (error) {
    return { error: "탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  // 계정이 삭제되었으므로 이 브라우저의 로그인 정보도 지운다.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/withdrawn");
}
