"use client";
// 조건 패널 맨 위 "문장으로 찾기" (데모 모양). 규칙 기반 시험용 응답이다.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { mergeQuery } from "@/lib/search/query";
import { convertSearchText, type SentenceResult } from "./sentence-search-actions";

export type AiSummary = { ok: boolean; tier: string; limit: number | null; remaining: number | null; period: "total" | "day" };

function remainingText(summary: AiSummary, remaining: number | null) {
  if (remaining === null) return "횟수 제한 없음";
  if (summary.period === "total") return `비회원 AI ${summary.limit}회 중 ${remaining}회 남았어요`;
  return `오늘 ${remaining}회 남았어요`;
}

export function SentenceSearch({ summary }: { summary: AiSummary }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<SentenceResult | null>(null);
  const [remaining, setRemaining] = useState<number | null>(summary.remaining);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function convert() {
    startTransition(async () => {
      const next = summary.ok ? await convertSearchText(text) : ({ ok: false, message: "AI를 지금 쓸 수 없어요. 잠시 후 다시 시도해 주세요.", remaining: null } as SentenceResult);
      setResult(next);
      if (next.remaining !== null) setRemaining(next.remaining);
      // 알아들은 조건을 바로 추천에 반영한다(지금 정렬은 그대로).
      if (next.ok) router.replace(mergeQuery(window.location.search, next.href, ["sort"]), { scroll: false });
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-soft p-4">
      <label htmlFor="sentence-search" className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-accent" aria-hidden="true">
          <path d="M12 2l2.2 6.3L20 10.5l-5.8 2.2L12 19l-2.2-6.3L4 10.5l5.8-2.2z" />
        </svg>
        문장으로 찾기
      </label>
      <textarea
        id="sentence-search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={2}
        maxLength={200}
        placeholder="예: 수성구 20평 카페, 월세 200 이하 1층"
        className="mt-2 w-full resize-none bg-transparent text-sm outline-none placeholder:text-faint"
      />
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          onClick={convert}
          disabled={pending}
          className="shrink-0 whitespace-nowrap rounded-full bg-panel px-4 py-1.5 text-sm font-medium shadow-sm disabled:opacity-50"
        >
          {pending ? "AI가 읽는 중…" : "조건으로 바꾸기"}
        </button>
      </div>

      {result && (
        <div role="status" className="mt-3 flex flex-col gap-2 border-t border-line pt-3 text-sm">
          {result.ok ? (
            <>
              <p className="text-xs font-medium text-muted">이렇게 바꿨어요</p>
              <div className="flex flex-wrap gap-1.5">
                {result.chips.map((chip) => (
                  <span key={chip} className="rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">
                    {chip}
                  </span>
                ))}
              </div>
              {result.notes.map((note) => (
                <p key={note} className="text-xs text-warn">
                  {note}
                </p>
              ))}
              <p className="text-xs font-medium text-ok">✓ 조건 상자와 추천에 바로 반영했어요.</p>
              <p className="text-[11px] text-faint">
                {remainingText(summary, remaining)} · 시험용 응답(규칙 기반)이에요. 바뀐 조건은 아래에서 바로 고칠 수 있어요.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs text-bad">{result.message}</p>
              {summary.ok && <p className="text-[11px] text-faint">{remainingText(summary, remaining)}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
