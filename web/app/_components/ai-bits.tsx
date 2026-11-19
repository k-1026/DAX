"use client";
// "AI가 일하고 있다"는 느낌을 주는 부품: 진행 시계, 스코어링 단계 표시, 한 글자씩 써지는 답변
import { useEffect, useState } from "react";
import { Icon } from "./ui";

export const TICK_MS = 80;

/** runId가 바뀔 때마다 0부터 max까지 올라가는 시계. 화면 연출을 전부 이 숫자로 계산한다. */
export function useTicker(runId: number, max: number) {
  const [s, setS] = useState({ run: runId, t: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      setS((p) => {
        if (p.run !== runId) return { run: runId, t: 1 };
        return p.t >= max ? p : { run: runId, t: p.t + 1 };
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [runId, max]);
  const t = s.run === runId ? s.t : 0;
  const skip = () => setS({ run: runId, t: max });
  return { t, skip };
}

export function ScoringSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="animate-rise rounded-2xl border border-line bg-soft p-4" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-[15px] font-medium">
        <span className="relative grid size-7 place-items-center rounded-full bg-tile-blue text-accent">
          <Icon name="spark" size={16} className="animate-pulse" />
        </span>
        AI가 스코어링 중입니다
        <span className="flex gap-0.5" aria-hidden>
          <i className="typing-dot size-1 rounded-full bg-muted" />
          <i className="typing-dot size-1 rounded-full bg-muted" />
          <i className="typing-dot size-1 rounded-full bg-muted" />
        </span>
      </p>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-2.5 text-sm transition-opacity ${i > current ? "opacity-30" : ""}`}
          >
            <span
              className={`grid size-5 place-items-center rounded-full ${
                i < current ? "bg-ok text-panel" : i === current ? "border-2 border-accent border-t-transparent animate-spin" : "border border-line"
              }`}
            >
              {i < current && <Icon name="check" size={13} />}
            </span>
            <span className={i === current ? "font-medium" : "text-muted"}>{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.min(100, ((current + 0.5) / steps.length) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** 써지는 중인 글자 뒤에 깜빡이는 커서 */
export function Caret() {
  return <span aria-hidden className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-accent" />;
}

export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-2" aria-label="답변 작성 중">
      <i className="typing-dot size-1.5 rounded-full bg-muted" />
      <i className="typing-dot size-1.5 rounded-full bg-muted" />
      <i className="typing-dot size-1.5 rounded-full bg-muted" />
    </span>
  );
}

/** 잠깐 생각하는 점(…)을 보여 준 뒤 한 글자씩 써 내려가는 AI 답변. 다 쓰면 children(인용 칩 등)을 붙인다. */
export function AiText({
  text,
  children,
  thinkTicks = 9,
  charsPerTick = 3,
  onDone,
}: {
  text: string;
  children?: React.ReactNode;
  thinkTicks?: number;
  charsPerTick?: number;
  onDone?: () => void;
}) {
  const max = thinkTicks + Math.ceil(text.length / charsPerTick);
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setT((x) => {
        if (x >= max) {
          clearInterval(id);
          return x;
        }
        if (x + 1 === max) setTimeout(() => onDone?.(), 0);
        return x + 1;
      });
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 한 번만 써 내려간다
  }, []);
  if (t < thinkTicks) return <TypingDots />;
  const shown = Math.min(text.length, (t - thinkTicks) * charsPerTick);
  return (
    <>
      {text.slice(0, shown)}
      {shown < text.length ? <Caret /> : children}
    </>
  );
}
