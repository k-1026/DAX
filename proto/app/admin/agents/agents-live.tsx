"use client";

// 에이전트 카드(불빛) + 로그 박스. 실행 중이면 3초, 아니면 30초마다 새로 읽는다. "멈추기"로 자동 갱신을 끌 수 있다.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { AgentKey, AgentView } from "@/lib/admin/agent-view";
import { AdviceBox } from "../_components/advice-box";
import { refreshAgents } from "./actions";

const LIGHT_LEGEND: [string, string][] = [["run", "실행 중"], ["ok", "정상"], ["warn", "경고"], ["fail", "실패"], ["idle", "꺼짐·기록 없음"]];
const LEVEL_CLASS = { info: "text-[#d7dde6]", ok: "text-[#6fd39a]", warn: "text-[#f6c453]", error: "text-[#ff8a80]" } as const;

export function AgentsLive({ initial }: { initial: AgentView }) {
  const [view, setView] = useState(initial);
  const [paused, setPaused] = useState(false);
  const [, startTransition] = useTransition();
  const selectedRef = useRef<{ key: AgentKey; runId: string | null }>({ key: initial.selected, runId: initial.runId });
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback((key: AgentKey, runId: string | null) => {
    selectedRef.current = { key, runId };
    startTransition(async () => {
      const next = await refreshAgents(key, runId);
      if (next && selectedRef.current.key === key) setView(next);
    });
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => load(selectedRef.current.key, selectedRef.current.runId), view.anyRunning ? 3000 : 30000);
    return () => clearInterval(id);
  }, [paused, view.anyRunning, load]);

  useEffect(() => {
    const box = logRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [view.lines.length, view.selected]);

  const selectedCard = view.cards.find((card) => card.key === view.selected);

  return (
    <>
      <AdviceBox advice={view.advice} errors={view.adviceErrors} scope="에이전트 상태를 풀어서, 관리자가 지금 할 일을 정리했어요. 화면과 같이 몇 초마다 새로 읽어요." />
      <section className="card p-4">
        <h2 className="mb-2.5 text-[0.9375rem] font-medium">에이전트 상태</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2.5">
          {view.cards.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => load(card.key, null)}
              aria-pressed={card.key === view.selected}
              className={`rounded-xl border px-3 py-2.5 text-left ${card.key === view.selected ? "border-accent bg-panel" : "border-transparent bg-soft hover:border-line"}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <i className="agent-dot" data-light={card.light} aria-hidden="true" />
                {card.name}
              </span>
              <span className="mt-0.5 block text-xs text-muted">{card.text}</span>
            </button>
          ))}
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="불빛 설명">
          {LIGHT_LEGEND.map(([light, text]) => (
            <li key={light} className="flex items-center gap-1.5">
              <i className="agent-dot" data-light={light} aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[0.9375rem] font-medium">로그 · {selectedCard?.name}</h2>
          <div className="flex items-center gap-2 text-xs text-muted">
            {view.runs.length > 0 && (
              <select
                aria-label="실행 선택"
                value={view.runId ?? ""}
                onChange={(event) => load(view.selected, event.target.value)}
                className="rounded-lg border border-line bg-panel px-2 py-1 text-xs"
              >
                {view.runs.map((run) => (
                  <option key={run.id} value={run.id}>{run.label}</option>
                ))}
              </select>
            )}
            <span>{paused ? "자동 갱신 멈춤" : view.anyRunning ? "실시간 갱신 중 · 3초마다" : "30초마다 갱신"}</span>
            <button type="button" onClick={() => setPaused((value) => !value)} className="rounded-lg border border-line bg-panel px-2.5 py-1 hover:bg-soft">
              {paused ? "다시 시작" : "멈추기"}
            </button>
          </div>
        </div>
        <div ref={logRef} className="h-56 overflow-auto rounded-xl bg-[#14171c] px-3 py-2.5 font-mono text-xs" role="log" aria-live="off">
          {view.lines.length === 0 ? (
            <p className="text-[#7f8895]">아직 기록이 없어요.</p>
          ) : (
            view.lines.map((line, index) => (
              <div key={index} className="whitespace-nowrap">
                {line.time && <span className="mr-2 text-[#7f8895]">{line.time}</span>}
                <span className={LEVEL_CLASS[line.level]}>{line.text}</span>
              </div>
            ))
          )}
        </div>
        <p className="mt-2 text-xs text-faint">읽기만 하는 화면이에요. 메일 주소와 메일 제목은 보여 주지 않아요.</p>
      </section>
    </>
  );
}
