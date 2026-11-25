"use client";
// 상단 바 [공유]: 지금 화면 주소(검색 조건 포함)를 복사한다. 로그인 없이 쓸 수 있다.
import { useRef, useState } from "react";

export function ShareButton() {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function share() {
    let text = "링크를 복사했어요.";
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      text = "복사하지 못했어요. 주소창의 주소를 직접 복사해 주세요.";
    }
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 2400);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={share}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 py-2 text-sm hover:bg-soft"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 10.7l6.8-4M8.6 13.3l6.8 4" />
        </svg>
        공유
      </button>
      {message && (
        <p role="status" className="absolute right-0 top-full z-20 mt-2 whitespace-nowrap rounded-xl bg-brand px-3 py-2 text-xs text-brand-ink shadow-lg">
          {message}
        </p>
      )}
    </div>
  );
}
