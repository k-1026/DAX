"use client";
// 조건 패널 슬라이더. 끝까지 밀면 제한 없음. 값은 폼에 담겨 그대로 검색에 쓰인다.
import { useState } from "react";
import { RANGES, SQM_PER_PYEONG } from "@/lib/search/ranges";

const pyeong = (sqm: number) => Math.round(sqm / SQM_PER_PYEONG);
const sliderClass = "w-full accent-[var(--accent)]";

function Head({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span>{label}</span>
      <span className="text-xs text-muted">{value}</span>
    </div>
  );
}

export function AreaRange({ min, max }: { min?: number; max?: number }) {
  const [lo, setLo] = useState(min ?? RANGES.area.min);
  const [hi, setHi] = useState(max ?? RANGES.area.max);
  const none = lo <= RANGES.area.min && hi >= RANGES.area.max;
  const hasLo = lo > RANGES.area.min;
  const hasHi = hi < RANGES.area.max;
  const text = none
    ? "제한 없음"
    : hasLo && hasHi
      ? `${pyeong(lo)}~${pyeong(hi)}평 (${lo}~${hi}㎡)`
      : hasLo
        ? `${pyeong(lo)}평 이상 (${lo}㎡ 이상)`
        : `${pyeong(hi)}평 이하 (${hi}㎡ 이하)`;
  return (
    <div className="flex flex-col gap-1">
      <Head label="면적" value={text} />
      <input type="range" name="area_min" aria-label="면적 최소" min={RANGES.area.min} max={RANGES.area.max} step={RANGES.area.step}
        value={lo} onChange={(event) => { const v = Number(event.target.value); setLo(v); if (v > hi) setHi(v); }} className={sliderClass} />
      <input type="range" name="area_max" aria-label="면적 최대" min={RANGES.area.min} max={RANGES.area.max} step={RANGES.area.step}
        value={hi} onChange={(event) => { const v = Number(event.target.value); setHi(v); if (v < lo) setLo(v); }} className={sliderClass} />
    </div>
  );
}

export function LimitSlider({ name, label, kind, value }: { name: string; label: string; kind: "deposit" | "rent"; value?: number }) {
  const range = RANGES[kind];
  const [v, setV] = useState(value ?? range.max);
  return (
    <div className="flex flex-col gap-1">
      <Head label={label} value={v >= range.max ? "제한 없음" : `${v.toLocaleString("ko-KR")}만원 이하`} />
      <input type="range" name={name} aria-label={label} min={range.min} max={range.max} step={range.step}
        value={v} onChange={(event) => setV(Number(event.target.value))} className={sliderClass} />
    </div>
  );
}
