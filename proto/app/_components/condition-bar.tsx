"use client";
// 추천 위의 조건 상자(PC). 접으면 한 줄 요약만 남아 지도가 커진다. 접어도 입력한 내용은 지워지지 않는다.
import { useEffect, useState } from "react";
import { APPLY_EVENT } from "./auto-apply-form";

export function ConditionBar({
  summary,
  defaultOpen,
  actions,
  children,
}: {
  summary: string;
  defaultOpen: boolean;
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    const on = (event: Event) => setApplying(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener(APPLY_EVENT, on);
    return () => window.removeEventListener(APPLY_EVENT, on);
  }, []);
  return (
    <section aria-label="검색 조건" className="hidden min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-3xl border border-line bg-panel lg:flex">
      <div className="flex items-center gap-3 px-5 py-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <h2 className="shrink-0 text-sm font-medium">조건</h2>
          <span className="truncate text-xs text-muted">{summary || "조건을 정하면 더 좁혀 보여 드려요"}</span>
          {applying && <span role="status" className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">추천에 반영 중…</span>}
          <span className="ml-auto shrink-0 rounded-full border border-line px-3 py-1 text-xs hover:bg-soft">{open ? "접기 ▲" : "펼치기 ▼"}</span>
        </button>
        {actions}
      </div>
      <div className={open ? "max-h-[42vh] overflow-y-auto border-t border-line px-5 py-4" : "hidden"}>{children}</div>
    </section>
  );
}
