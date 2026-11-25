"use client";
// 내 정보 제목 옆 등급 배지. PC는 커서를 올리면, 모바일은 탭하면 쓸 수 있는 기능이 펼쳐진다.
import { useState } from "react";

export function TierBadge({ label, features }: { label: string; features: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
      >
        {label}
      </button>
      <ul
        className={`absolute right-0 z-10 mt-2 w-64 flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900 ${
          open ? "flex" : "hidden sm:group-hover:flex"
        }`}
      >
        <li className="mb-1 text-sm font-medium">{label} 혜택</li>
        {features.map((feature) => (
          <li key={feature}>· {feature}</li>
        ))}
      </ul>
    </div>
  );
}
