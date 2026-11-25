"use server";
// 가입 직후 사진 설정 화면: 건너뛰기
import { redirect } from "next/navigation";
import { toSafePath } from "@/lib/legal/versions";
import { createClient } from "@/lib/supabase/server";

export async function skipAvatar(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  await supabase.from("profiles").update({ avatar_prompted_at: new Date().toISOString() }).eq("id", userId);
  redirect(toSafePath(formData.get("next")));
}
