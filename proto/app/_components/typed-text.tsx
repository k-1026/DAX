"use client";
// "AI가 쓰는 중" 느낌: 글자가 하나씩 나타난다. 화면 읽기 프로그램에는 전체 글을 바로 읽어 주고,
// 움직임을 줄이는 설정을 켠 사람에게는 효과 없이 바로 보여 준다.
import { useEffect, useState } from "react";

const MAX_MS = 1800;

function useTyped(text: string, active: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 움직임 줄이기: 글을 바로 모두 보여 준다
      setCount(text.length);
      return;
    }
    const step = Math.max(1, Math.ceil(text.length / (MAX_MS / 25)));
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(text.length, current + step);
      setCount(current);
      if (current >= text.length) clearInterval(timer);
    }, 25);
    return () => clearInterval(timer);
  }, [text, active]);
  return active ? count : text.length;
}

export function TypedText({ text, className = "", onDone }: { text: string; className?: string; onDone?: () => void }) {
  const count = useTyped(text, true);
  const done = count >= text.length;
  useEffect(() => {
    if (done) onDone?.();
  }, [done, onDone]);
  return (
    <p className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, count)}
        {!done && <span className="ai-caret" />}
      </span>
    </p>
  );
}

// 분석 요약: 쓰는 동안은 "AI 요약 생성 중…", 끝나면 "AI 분석 요약"
export function AiSummary({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div key={text}>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-accent">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={done ? "" : "animate-pulse"}>
          <path d="M12 2l2.2 6.3L20 10.5l-5.8 2.2L12 19l-2.2-6.3L4 10.5l5.8-2.2z" />
        </svg>
        {done ? "AI 분석 요약" : "AI 요약 생성 중…"}
      </p>
      <TypedText text={text} className="text-[15px] leading-7" onDone={() => setDone(true)} />
    </div>
  );
}
