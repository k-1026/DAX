"use client";
// 추천 패널 질문 칩 (데모 모양). 점수가 필요한 두 질문은 "미확정"으로 흐리게 둔다.
import { useCallback, useEffect, useState, useTransition } from "react";
import { ASK_EVENT } from "./ask-bar";
import { CHIPS } from "@/lib/ai/summary-text";
import { InlineListing } from "./inline-listing";
import { TypedText } from "./typed-text";
import { askSummaryChip, type ChipResult } from "./summary-chips-actions";

const chipClass = "rounded-full border border-line bg-panel px-3.5 py-1.5 text-sm hover:bg-soft disabled:opacity-60";

export function SummaryChips({ search, guest, remaining: initialRemaining }: { search: string; guest: boolean; remaining: number | null }) {
  const [answers, setAnswers] = useState<Record<string, ChipResult>>({});
  const [remaining, setRemaining] = useState<number | null>(initialRemaining);
  const [asking, setAsking] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const [scrollTo, setScrollTo] = useState<string | null>(null);

  const ask = useCallback(
    (key: string) => {
      // 이미 받은 답은 다시 차감하지 않는다.
      if (answers[key]?.ok) {
        setScrollTo(key);
        return;
      }
      setAsking(key);
      startTransition(async () => {
        const result = await askSummaryChip(key, search);
        setAnswers((current) => ({ ...current, [key]: result }));
        if (result.remaining !== null) setRemaining(result.remaining);
        setAsking(null);
        setScrollTo(key);
      });
    },
    [answers, search],
  );

  // 아래 질문 입력창에서 보낸 질문도 같은 방식으로 답한다.
  useEffect(() => {
    const handler = (event: Event) => {
      const key = (event as CustomEvent<{ key: string }>).detail?.key;
      if (key) ask(key);
    };
    window.addEventListener(ASK_EVENT, handler);
    return () => window.removeEventListener(ASK_EVENT, handler);
  }, [ask]);

  useEffect(() => {
    if (scrollTo && answers[scrollTo]) {
      document.getElementById(`chip-answer-${scrollTo}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 답이 나온 뒤 한 번만 그 위치로 이동한다
      setScrollTo(null);
    }
  }, [scrollTo, answers]);

  const shown = CHIPS.filter((chip) => answers[chip.key]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button key={chip.key} type="button" disabled={pending} onClick={() => ask(chip.key)} className={chipClass}>
            {asking === chip.key ? "AI 검색 중…" : chip.label}
          </button>
        ))}
        {["1위는 왜 추천됐어?", "1위와 2위 비교해줘"].map((label) => (
          <span key={label} aria-disabled="true" className="rounded-full border border-dashed border-line px-3.5 py-1.5 text-sm text-faint">
            {label} <span className="text-[11px]">미확정</span>
          </span>
        ))}
      </div>
      {asking && (
        <div role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm">
          <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="animate-pulse" aria-hidden="true">
              <path d="M12 2l2.2 6.3L20 10.5l-5.8 2.2L12 19l-2.2-6.3L4 10.5l5.8-2.2z" />
            </svg>
            <span className="ai-dots">AI가 매물을 찾아 답을 만드는 중</span>
          </p>
        </div>
      )}
      {shown.map((chip) => {
        const answer = answers[chip.key];
        return (
          <div key={chip.key} id={`chip-answer-${chip.key}`} role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm leading-6">
            <p className="text-xs font-medium text-muted">{chip.label}</p>
            {answer.ok ? <TypedText key={answer.text} text={answer.text} /> : <p className="text-bad">{answer.text}</p>}
            {answer.ok && answer.listing && (
              <>
                <button
                  type="button"
                  aria-expanded={opened.includes(chip.key)}
                  onClick={() => setOpened((current) => (current.includes(chip.key) ? current.filter((k) => k !== chip.key) : [...current, chip.key]))}
                  className="mt-1 text-xs text-accent underline"
                >
                  {opened.includes(chip.key) ? "매물 접기" : "매물 보기"}
                </button>
                {opened.includes(chip.key) && <InlineListing listing={answer.listing} guest={guest} />}
              </>
            )}
          </div>
        );
      })}
      {shown.length > 0 && (
        <p className="text-[11px] text-faint">
          {guest ? `비회원 AI ${remaining ?? 0}회 남았어요` : remaining === null ? "횟수 제한 없음" : `오늘 ${remaining}회 남았어요`} · 시험용 응답(규칙 기반)이에요.
        </p>
      )}
    </div>
  );
}
