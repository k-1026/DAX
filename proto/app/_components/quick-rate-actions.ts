"use server";
// 목록 카드의 좋아요·싫어요 빠른 평가. 저장 규칙은 매물 상세 평가와 같다(매물마다 평가 1개, 업종 없음).
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const REASONS = ["rent_terms", "space", "location", "entry", "info_error", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RateInput = {
  listingId: string;
  /** null이면 내 평가를 지운다 */
  rating: "good" | "bad" | null;
  reason?: string;
  review?: string;
};
export type RateResult = { ok: boolean; message?: string };

export async function rateListing({ listingId, rating, reason, review }: RateInput): Promise<RateResult> {
  if (!UUID.test(listingId)) return { ok: false, message: "매물을 찾을 수 없어요." };
  if (rating !== null && rating !== "good" && rating !== "bad") return { ok: false, message: "평가를 확인해 주세요." };
  const text = (review ?? "").trim();
  if (text.length > 500) return { ok: false, message: "리뷰는 500자까지 쓸 수 있어요." };
  if (reason && !REASONS.includes(reason)) return { ok: false, message: "이유를 확인해 주세요." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return { ok: false, message: "로그인 후 평가할 수 있어요." };

  const { data: existing, error: lookupError } = await supabase
    .from("listing_feedback")
    .select("id, review")
    // user_id 칸은 읽기 권한이 없어 조건에 쓰지 않는다. 내 평가만 보이는 것은 DB 규칙이 보장한다.
    .eq("listing_id", listingId)
    .is("category_id", null)
    .maybeSingle();

  if (lookupError) return { ok: false, message: "저장하지 못했어요. 잠시 후 다시 시도해 주세요." };

  if (rating === null) {
    if (existing) {
      const { error } = await supabase.from("listing_feedback").delete().eq("id", existing.id);
      if (error) return { ok: false, message: "취소하지 못했어요. 잠시 후 다시 시도해 주세요." };
    }
  } else {
    const values = {
      rating,
      bad_reasons: rating === "bad" && reason ? [reason] : [],
      // 아이콘만 눌렀을 때는 이미 쓴 리뷰를 지우지 않는다.
      review: review === undefined ? (existing?.review ?? null) : text || null,
    };
    const { error } = existing
      ? await supabase.from("listing_feedback").update(values).eq("id", existing.id)
      : await supabase.from("listing_feedback").insert({ listing_id: listingId, ...values });
    if (error) return { ok: false, message: "저장하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/mypage");
  revalidatePath(`/listings/${listingId}`);
  return { ok: true };
}

// 담은 매물들에 내가 남긴 평가를 한꺼번에 읽는다 (스튜디오 "평가 남기기").
export async function myRatingsFor(ids: string[]): Promise<Record<string, "good" | "bad">> {
  const valid = ids.filter((id) => UUID.test(id)).slice(0, 50);
  if (valid.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase.from("listing_feedback").select("listing_id, rating").in("listing_id", valid).is("category_id", null);
  const map: Record<string, "good" | "bad"> = {};
  for (const row of data ?? []) map[row.listing_id] = row.rating as "good" | "bad";
  return map;
}

// 내가 남긴 평가(좋아요·싫어요) 수. 내 것만 읽히는 권한 규칙을 그대로 쓴다.
export async function myRatingCount(): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("listing_feedback").select("id", { count: "exact", head: true }).is("category_id", null);
  return error ? null : (count ?? 0);
}
