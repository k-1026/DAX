"use client";
// 조건 패널의 지역 목록: "모든 지역 선택" + 구별 체크 (데모 모양). 아무것도 고르지 않거나 모두 고르면 지역 조건 없음.
import { useState } from "react";

export function RegionList({ areas, selected }: { areas: string[]; selected: string[] }) {
  // 지역 조건이 없으면(처음 상태) 모두 선택된 모양으로 보여 준다.
  const [checked, setChecked] = useState<string[]>(selected.length === 0 ? areas : selected);
  const all = checked.length === areas.length;
  const toggle = (gu: string) => setChecked((current) => (current.includes(gu) ? current.filter((v) => v !== gu) : [...current, gu]));

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm">지역</legend>
      <div className="overflow-hidden rounded-xl border border-line">
        <label className="flex cursor-pointer items-center justify-between bg-soft px-3 py-2.5 text-sm text-muted">
          <span>모든 지역 선택</span>
          <input type="checkbox" checked={all} onChange={() => setChecked(all ? [] : areas)} className="size-4 accent-[var(--accent)]" />
        </label>
        {areas.map((gu) => (
          <label key={gu} className="flex cursor-pointer items-center justify-between border-t border-line px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-faint" aria-hidden="true">
                <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
              </svg>
              {gu}
            </span>
            <input type="checkbox" name="gu" value={gu} checked={checked.includes(gu)} onChange={() => toggle(gu)} className="size-4 accent-[var(--accent)]" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
