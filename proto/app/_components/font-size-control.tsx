"use client";
// 글자 크기 조절 (U23). 이 브라우저에만 저장한다.
import { useEffect, useSyncExternalStore } from "react";

const SIZES = [
  { key: "normal", label: "가", title: "보통 글자" },
  { key: "large", label: "가+", title: "큰 글자" },
  { key: "xlarge", label: "가++", title: "아주 큰 글자" },
] as const;

type Size = (typeof SIZES)[number]["key"];
const STORAGE_KEY = "font-size";
const CHANGE_EVENT = "font-size-change";

function readSize(): Size {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (SIZES.some((option) => option.key === value)) return value as Size;
  } catch {
    // 저장소를 쓸 수 없으면 기본 크기로 둔다.
  }
  return "normal";
}

function applyToPage(size: Size) {
  document.documentElement.dataset.fontSize = size;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function FontSizeControl() {
  const size = useSyncExternalStore(subscribe, readSize, () => "normal" as Size);

  useEffect(() => {
    applyToPage(size);
  }, [size]);

  function choose(next: Size) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 저장하지 못하면 이번 화면에만 적용한다.
      applyToPage(next);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <div role="group" aria-label="글자 크기" className="flex items-center gap-1">
      {SIZES.map((option) => (
        <button
          key={option.key}
          type="button"
          title={option.title}
          aria-pressed={size === option.key}
          onClick={() => choose(option.key)}
          className={`rounded border px-2 py-1 text-xs ${
            size === option.key
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
