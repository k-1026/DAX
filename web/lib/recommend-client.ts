// 브라우저에서 추천 API 부르기
import type { Filters, Preference, Recommendation } from "./listings";

export async function fetchRecommendation(filters: Filters, pref: Preference, previewAs?: string): Promise<Recommendation> {
  const res = await fetch("/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filters, pref, as: previewAs }),
  });
  if (!res.ok) throw new Error(`추천 서버 응답 오류 (${res.status})`);
  return res.json();
}
