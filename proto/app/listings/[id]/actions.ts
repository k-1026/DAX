"use server";
// 매물 평가·리뷰 저장 (로그인 회원만). 리뷰 글의 개인정보는 DB가 저장할 때 가린다.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FeedbackState = { ok: boolean; message: string } | null;

const REASONS = ["rent_terms", "space", "location", "entry", "info_error", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveFeedback(_prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const listingId = String(formData.get("listing_id") ?? "");
  const rating = String(formData.get("rating") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const review = String(formData.get("review") ?? "").trim();

  if (!UUID.test(listingId)) return { ok: false, message: "매물을 찾을 수 없습니다." };
  if (rating !== "good" && rating !== "bad") return { ok: false, message: "좋아요 또는 싫어요를 골라 주세요." };
  if (rating === "bad" && !REASONS.includes(reason)) {
    return { ok: false, message: "싫어요 이유를 1개 골라 주세요." };
  }
  if (review.length > 500) return { ok: false, message: "리뷰는 500자까지 쓸 수 있습니다." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return { ok: false, message: "로그인 후 평가할 수 있습니다." };

  const values = {
    rating,
    bad_reasons: rating === "bad" ? [reason] : [],
    review: review || null,
  };

  // 업종 목록이 생기기 전까지는 업종 없이 매물마다 평가 1개
  const { data: existing } = await supabase
    .from("listing_feedback")
    .select("id")
    .eq("listing_id", listingId)
    .is("category_id", null)
    .maybeSingle();

  const { error } = existing
    ? await supabase.from("listing_feedback").update(values).eq("id", existing.id)
    : await supabase.from("listing_feedback").insert({ listing_id: listingId, ...values });

  if (error) return { ok: false, message: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  revalidatePath(`/listings/${listingId}`);
  return { ok: true, message: "저장했습니다. 개인정보는 가려서 저장됩니다." };
}
