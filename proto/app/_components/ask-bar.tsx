"use client";
// 추천 패널 아래 질문 입력창 (데모 모양). AI 없이 질문 속 낱말로 기존 질문 칩 답변에 연결한다.
// 점수가 필요한 질문("왜 추천", "비교")은 5단계 전까지 안내만 한다. 칩과 같은 방식으로 횟수를 차감한다.
import { useState } from "react";

export const ASK_EVENT = "dax:ask-chip";

const RULES: { key: "cheapest" | "widest" | "newest" | "dong"; words: RegExp }[] = [
  { key: "cheapest", words: /싼|싸|저렴|월세|부담|낮은|비용|가격|렌트|임대료/ },
  { key: "widest", words: /넓|큰|평수|면적|크기/ },
  { key: "newest", words: /최근|새로|신규|최신|방금|갱신/ },
  { key: "dong", words: /동네|많은|어디|지역|몰려|밀집/ },
];
const NEEDS_SCORE = /왜|이유|점수|비교|1위|2위|경쟁|상권|유동/;

export function AskBar({ total, enabled }: { total: number; enabled: boolean }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const question = text.trim();
    if (!question) {
      setNote("궁금한 점을 적어 주세요.");
      return;
    }
    const rule = RULES.find((item) => item.words.test(question));
    if (rule) {
      setNote("");
      window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { key: rule.key, question } }));
      setText("");
    } else if (NEEDS_SCORE.test(question)) {
      setNote("점수와 주변 상권 기준이 정해지면 답할 수 있어요. 지금은 위의 질문 칩을 눌러 보세요.");
    } else {
      setNote("아직 이런 질문에는 답하지 못해요. “월세가 싼 곳은?”, “가장 넓은 곳은?”, “최근 확인된 곳은?”처럼 물어봐 주세요.");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-full border border-line bg-panel py-1.5 pl-4 pr-1.5">
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (note) setNote("");
          }}
          maxLength={100}
          disabled={!enabled}
          aria-label="추천 결과에 대해 물어보기"
          placeholder={enabled ? "추천 결과에 대해 물어보세요" : "검색 결과가 있으면 물어볼 수 있어요"}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint disabled:opacity-60"
        />
        <span className="hidden whitespace-nowrap text-[11px] text-faint sm:inline">공실 {total.toLocaleString("ko-KR")}곳</span>
        <button type="submit" disabled={!enabled} aria-label="보내기" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink disabled:opacity-40">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14 M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <p role="status" className={`px-2 text-center text-[11px] ${note ? "text-warn" : "text-faint"}`}>
        {note || "AI 추천은 참고용이에요. 계약 전 현장 확인과 등기부등본·건축물대장 확인을 꼭 해 주세요."}
      </p>
    </form>
  );
}
