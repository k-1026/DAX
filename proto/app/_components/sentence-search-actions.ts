"use server";
// "문장으로 찾기" [조건으로 바꾸기]. 성공했을 때만 횟수를 1회 차감한다.
import { filtersToQuery, interpretSearchText } from "@/lib/ai/search-text";
import { getAiStatus, consumeAi } from "@/lib/ai/usage";
import { getAreas } from "@/lib/search/listings";

export type SentenceResult =
  | { ok: true; chips: string[]; notes: string[]; href: string; remaining: number | null }
  | { ok: false; message: string; remaining: number | null };

export async function convertSearchText(text: string): Promise<SentenceResult> {
  const sentence = String(text ?? "").trim();
  if (sentence.length < 2) return { ok: false, message: "찾고 싶은 조건을 문장으로 적어 주세요.", remaining: null };
  if (sentence.length > 200) return { ok: false, message: "200자 이내로 적어 주세요.", remaining: null };

  const status = await getAiStatus();
  if (!status.ok) return { ok: false, message: "지금은 AI 기능을 쓸 수 없어요. 잠시 후 다시 시도해 주세요.", remaining: null };
  if (status.remaining !== null && status.remaining <= 0) {
    return {
      ok: false,
      message:
        status.tier === "guest"
          ? "비회원 AI 이용 횟수를 모두 썼어요. 로그인하면 하루 10회까지 쓸 수 있어요."
          : "오늘 AI 이용 횟수를 모두 썼어요. 내일 다시 이용할 수 있어요.",
      remaining: 0,
    };
  }

  const areas = await getAreas();
  const result = interpretSearchText(sentence, areas);
  if (!result.found) {
    // 조건을 하나도 찾지 못하면 횟수를 깎지 않는다.
    return { ok: false, message: "조건을 찾지 못했어요. 지역·월세·면적을 넣어 보세요. (횟수는 차감되지 않았어요)", remaining: status.remaining };
  }

  const used = await consumeAi("ai1_search_text");
  if (!used.ok) {
    return { ok: false, message: "AI 이용 횟수를 모두 썼어요.", remaining: used.remaining };
  }
  return { ok: true, chips: result.chips, notes: result.notes, href: filtersToQuery(result.filters), remaining: used.remaining };
}
