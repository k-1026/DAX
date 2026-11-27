"use client";
// 조건 상자의 넓이·돈 입력. 자주 쓰는 값은 버튼 한 번으로, 세밀한 값은 짧은 바로 고른다.
// 값은 폼 입력(name)으로 담겨 그대로 검색에 쓰이고, 바뀌면 'change'를 알려 추천에 바로 반영된다.
import { useEffect, useRef, useState } from "react";
import { RANGES, SQM_PER_PYEONG } from "@/lib/search/ranges";

const pyeong = (sqm: number) => Math.round(sqm / SQM_PER_PYEONG);
const sqm = (py: number) => Math.round(py * SQM_PER_PYEONG);
const CHIP =
  "rounded-full border border-line px-3 py-1.5 text-sm hover:bg-soft aria-pressed:border-transparent aria-pressed:bg-accent-soft aria-pressed:text-accent";

// 값을 바꾼 뒤 폼에 'change'를 알려 자동 반영되게 한다(처음 그릴 때는 알리지 않음).
function useNotifyChange<T>(value: T, el: React.RefObject<HTMLInputElement | null>) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    el.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [value, el]);
}

// 넓이: 평 구간 버튼. 여러 개를 누르면 그 사이 구간까지 이어서 고른다(예: 10~20 + 30~50 → 10~50평).
const AREA_BUCKETS = [
  { label: "10평 이하", lo: 0, hi: 10 },
  { label: "10~20평", lo: 10, hi: 20 },
  { label: "20~30평", lo: 20, hi: 30 },
  { label: "30~50평", lo: 30, hi: 50 },
  { label: "50평 이상", lo: 50, hi: null },
] as const;

function initialBuckets(min?: number, max?: number): number[] {
  if (min === undefined && max === undefined) return [];
  const lo = min === undefined ? 0 : pyeong(min);
  const hi = max === undefined ? Infinity : pyeong(max);
  return AREA_BUCKETS.flatMap((b, i) => (b.lo >= lo - 1 && (b.hi ?? Infinity) <= hi + 1 ? [i] : []));
}

export function AreaButtons({ min, max }: { min?: number; max?: number }) {
  const [picked, setPicked] = useState<number[]>(() => initialBuckets(min, max));
  const ref = useRef<HTMLInputElement>(null);
  useNotifyChange(picked, ref);

  const first = picked.length ? Math.min(...picked) : null;
  const last = picked.length ? Math.max(...picked) : null;
  const areaMin = first === null || AREA_BUCKETS[first].lo === 0 ? "" : String(sqm(AREA_BUCKETS[first].lo));
  const hiPy = last === null ? null : AREA_BUCKETS[last].hi;
  const areaMax = hiPy === null ? "" : String(Math.min(sqm(hiPy), RANGES.area.max - 1));

  function toggle(i: number) {
    setPicked((cur) => {
      if (cur.length === 1 && cur[0] === i) return [];
      if (cur.includes(i) && (i === Math.min(...cur) || i === Math.max(...cur))) return cur.filter((x) => x !== i);
      const lo = Math.min(i, ...cur), hi = Math.max(i, ...cur);
      return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={ref} type="hidden" name="area_min" value={areaMin} />
      <input type="hidden" name="area_max" value={areaMax} />
      <button type="button" aria-pressed={picked.length === 0} onClick={() => setPicked([])} className={CHIP}>상관없음</button>
      {AREA_BUCKETS.map((b, i) => (
        <button key={b.label} type="button" aria-pressed={picked.includes(i)} onClick={() => toggle(i)} className={CHIP}>
          {b.label}
        </button>
      ))}
      <span className="text-xs text-faint">여러 개를 누르면 그 사이까지 이어서 골라요</span>
    </div>
  );
}

// 돈: 빠른 버튼 + 짧은 바. 바를 끝까지 밀면 제한 없음.
const PRESETS = {
  rent: [100, 200, 300, 500],
  deposit: [1000, 2000, 3000, 5000],
} as const;
const money = (v: number) => (v >= 10000 ? `${v / 10000}억` : v >= 1000 && v % 1000 === 0 ? `${v / 1000}천만` : `${v.toLocaleString("ko-KR")}만`);

export function MoneyField({ name, kind, value }: { name: string; kind: "deposit" | "rent"; value?: number }) {
  const range = RANGES[kind];
  const [v, setV] = useState(value ?? range.max);
  const ref = useRef<HTMLInputElement>(null);
  const [notify, setNotify] = useState(0);
  useNotifyChange(notify, ref);
  const pick = (next: number) => { setV(next); setNotify((n) => n + 1); };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS[kind].map((p) => (
        <button key={p} type="button" aria-pressed={v === p} onClick={() => pick(p)} className={CHIP}>
          {money(p)}원 이하
        </button>
      ))}
      <button type="button" aria-pressed={v >= range.max} onClick={() => pick(range.max)} className={CHIP}>제한 없음</button>
      <span className="flex items-center gap-2">
        <input
          ref={ref}
          type="range"
          name={name}
          aria-label={kind === "rent" ? "월세+관리비 직접 고르기" : "보증금 직접 고르기"}
          min={range.min}
          max={range.max}
          step={range.step}
          value={v}
          onChange={(event) => setV(Number(event.target.value))}
          className="w-36 accent-[var(--accent)]"
        />
        <span className="w-24 text-xs text-muted">{v >= range.max ? "제한 없음" : `${v.toLocaleString("ko-KR")}만원 이하`}</span>
      </span>
    </div>
  );
}
