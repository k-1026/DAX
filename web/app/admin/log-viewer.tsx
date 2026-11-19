"use client";
// 오케스트레이터 실행 로그 보기 (수준·에이전트로 거르기)
import { useState } from "react";
import { LOGS, type LogLevel } from "@/lib/admin-data";

const LEVEL_CLS: Record<LogLevel, string> = {
  INFO: "bg-tile-blue text-accent",
  WARN: "bg-warn-soft text-warn",
  ERROR: "bg-bad-soft text-bad",
};

export function LogViewer() {
  const [level, setLevel] = useState<LogLevel | "ALL">("ALL");
  const rows = LOGS.filter((l) => level === "ALL" || l.level === level);

  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-medium">실행 로그</h2>
        <div className="flex gap-1.5" role="group" aria-label="로그 수준">
          {(["ALL", "INFO", "WARN", "ERROR"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={level === l}
              onClick={() => setLevel(l)}
              className={`rounded-full px-3 py-1 text-xs ${level === l ? "bg-accent-soft text-ink" : "border border-line text-muted"}`}
            >
              {l === "ALL" ? "전체" : l} {l !== "ALL" && <span className="text-faint">{LOGS.filter((x) => x.level === l).length}</span>}
            </button>
          ))}
        </div>
      </header>
      <ul className="divide-y divide-line rounded-xl bg-soft font-mono text-[12.5px]">
        {rows.map((r) => (
          <li key={r.at + r.msg} className="grid grid-cols-[auto_auto_1fr] items-baseline gap-3 px-3 py-2 sm:grid-cols-[120px_56px_100px_1fr]">
            <span className="text-faint">{r.at}</span>
            <span className={`w-fit rounded px-1.5 text-[11px] ${LEVEL_CLS[r.level]}`}>{r.level}</span>
            <span className="hidden font-sans text-muted sm:block">{r.agent}</span>
            <span className="col-span-3 font-sans sm:col-span-1">{r.msg}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
