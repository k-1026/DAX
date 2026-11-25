"use server";
// 추천 패널 질문 칩. 눌렀을 때만 AI 횟수를 1회 차감한다(규칙 기반 시험용 답변).
import { chipAnswer, CHIPS, type ChipKey } from "@/lib/ai/summary-text";
import { consumeAi, getAiStatus } from "@/lib/ai/usage";
import { parseSearchParams } from "@/lib/search/listings";
import { getSearchSummary, type SummaryListing } from "@/lib/search/summary";

export type ChipResult = { ok: boolean; text: string; listing?: SummaryListing; remaining: number | null; guest?: boolean };

export async function askSummaryChip(key: string, search: string): Promise<ChipResult> {
  const chip = CHIPS.find((item) => item.key === key);
  if (!chip) return { ok: false, text: "알 수 없는 질문이에요.", remaining: null };

  // 주소의 검색 조건을 서버에서 다시 읽는다(범위 확인 포함).
  const params: Record<string, string[]> = {};
  for (const [name, value] of new URLSearchParams(String(search ?? "").slice(0, 2000))) (params[name] ??= []).push(value);
  const { filters } = parseSearchParams(params);

  const { summary, guest } = await getSearchSummary(filters);
  if (!summary) return { ok: false, text: "지금은 답을 만들 수 없어요. 잠시 후 다시 시도해 주세요.", remaining: null };
  if (guest && chip.needsLogin) return { ok: false, text: "이 질문은 로그인하면 답해 드려요.", remaining: null };

  const status = await getAiStatus();
  if (!status.ok) return { ok: false, text: "지금은 AI 기능을 쓸 수 없어요.", remaining: null };
  if (status.remaining !== null && status.remaining <= 0) {
    return {
      ok: false,
      text: guest ? "비회원 AI 이용 횟수를 모두 썼어요. 로그인하면 하루 10회까지 쓸 수 있어요." : "오늘 AI 이용 횟수를 모두 썼어요. 내일 다시 이용할 수 있어요.",
      remaining: 0,
    };
  }

  const used = await consumeAi("ai2_explain");
  if (!used.ok) return { ok: false, text: "AI 이용 횟수를 모두 썼어요.", remaining: used.remaining };
  const answer = chipAnswer(key as ChipKey, summary);
  return { ok: true, text: answer.text, listing: answer.listing, remaining: used.remaining, guest };
}
