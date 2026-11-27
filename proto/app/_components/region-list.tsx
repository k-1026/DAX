"use client";
// 조건 상자의 지역 버튼: "전체" + 구별 버튼(여러 개 선택). 아무것도 고르지 않으면 전체.
import { useEffect, useRef, useState } from "react";

const CHIP =
  "cursor-pointer rounded-full border border-line px-3 py-1.5 text-sm hover:bg-soft has-[:checked]:border-transparent has-[:checked]:bg-accent-soft has-[:checked]:text-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent";

export function RegionList({ areas, selected }: { areas: string[]; selected: string[] }) {
  // 예전 주소처럼 모든 구가 다 들어 있으면 "전체"로 본다.
  const [checked, setChecked] = useState<string[]>(selected.length >= areas.length ? [] : selected);
  const allRef = useRef<HTMLButtonElement>(null);
  const cleared = useRef(false);

  // "전체"를 누른 뒤 폼에 바뀜을 알려 추천에 바로 반영한다.
  useEffect(() => {
    if (!cleared.current) return;
    cleared.current = false;
    allRef.current?.closest("form")?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [checked]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        ref={allRef}
        type="button"
        aria-pressed={checked.length === 0}
        onClick={() => { cleared.current = checked.length > 0; setChecked([]); }}
        className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-soft aria-pressed:border-transparent aria-pressed:bg-accent-soft aria-pressed:text-accent"
      >
        전체
      </button>
      {areas.map((gu) => (
        <label key={gu} className={CHIP}>
          <input
            type="checkbox"
            name="gu"
            value={gu}
            checked={checked.includes(gu)}
            onChange={() => setChecked((cur) => (cur.includes(gu) ? cur.filter((v) => v !== gu) : [...cur, gu]))}
            className="sr-only"
          />
          {gu}
        </label>
      ))}
    </div>
  );
}
