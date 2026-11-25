"use client";
// "AI가 분석 중입니다…" 로딩: 단계가 하나씩 나타나고 끝난 단계는 체크가 된다. 모두 끝나면 onDone을 부른다.
// 움직임 줄이기 설정을 켠 사람에게는 기다리지 않고 바로 onDone을 부른다.
import { useEffect, useState } from "react";

export function AiWorking({ steps, onDone, stepMs = 600, title = "AI가 분석 중입니다…" }: { steps: string[]; onDone?: () => void; stepMs?: number; title?: string }) {
  const [shown, setShown] = useState(1);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDone?.();
      return;
    }
    let count = 1;
    const timer = setInterval(() => {
      count += 1;
      setShown(count);
      // 마지막 단계까지 보여 준 뒤 한 박자 쉬고 끝낸다.
      if (count > steps.length) {
        clearInterval(timer);
        setTimeout(() => onDone?.(), stepMs * 0.6);
      }
    }, stepMs);
    return () => clearInterval(timer);
  }, [steps.length, stepMs, onDone]);

  return (
    <div role="status" aria-live="polite" className="rounded-2xl bg-soft p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="animate-pulse text-accent" aria-hidden="true">
          <path d="M12 2l2.2 6.3L20 10.5l-5.8 2.2L12 19l-2.2-6.3L4 10.5l5.8-2.2z" />
        </svg>
        <span className="ai-dots">{title.replace(/…$/, "")}</span>
      </p>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {steps.slice(0, Math.min(shown, steps.length)).map((step, index) => {
          const finished = shown > index + 1;
          return (
            <li key={step} className="card-in flex items-center gap-2.5 text-muted">
              <span className="relative inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                {finished ? (
                  <svg className="text-ok" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                ) : (
                  <span className="inline-block size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                )}
              </span>
              {step}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
