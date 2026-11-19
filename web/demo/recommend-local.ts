// 발표용 단일 HTML: 서버 대신 브라우저 안에서 같은 엔진으로 계산한다 (매물 데이터는 HTML에 들어 있음).
import raw from "../data/listings.json";
import { initEngine, isEngineReady, recommend, type Raw } from "../lib/engine-core";
import type { Filters, Preference, Recommendation } from "../lib/listings";

export async function fetchRecommendation(filters: Filters, pref: Preference, previewAs?: string): Promise<Recommendation> {
  if (!isEngineReady()) initEngine(raw as unknown as Raw);
  await new Promise((r) => setTimeout(r, 250)); // 서버를 부르는 것처럼 아주 잠깐 기다림
  return recommend(filters, { member: previewAs === "member", pref });
}
