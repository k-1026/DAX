"use client";
// 담은 매물 비교 결과를 띄우는 창. 바깥을 누르거나 Esc·닫기를 누르면 닫힌다.
import { useEffect, useRef } from "react";

export function CompareModal({ count, onClose, children }: { count: number; onClose: () => void; children: React.ReactNode }) {
  // 닫기 함수가 바뀌어도 스크롤 잠금은 창이 열려 있는 동안 한 번만 건다.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="담은 매물 비교"
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-5xl rounded-3xl bg-canvas p-4 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">담은 매물 {count}곳 비교</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="inline-flex size-9 items-center justify-center rounded-full border border-line bg-panel hover:bg-soft">
            ✕
          </button>
        </div>
        <div className="card p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
