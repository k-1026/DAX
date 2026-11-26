"use client";
// 매물 상세 창: 바깥을 누르거나 Esc·닫기를 누르면 뒤로 가서 추천 화면이 그대로 남는다.
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export function ListingModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // 뒤로 가기로 다른 주소가 되면 창을 바로 숨긴다(병렬 경로가 이전 창을 남겨 두는 경우 대비).
  const open = usePathname().startsWith("/listings/");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && router.back();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [router, open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="매물 자세히 보기"
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={(event) => event.target === event.currentTarget && router.back()}
    >
      <div className="relative w-full max-w-3xl rounded-3xl bg-canvas p-4 shadow-2xl sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button type="button" onClick={() => window.location.reload()} className="text-xs text-muted underline">전체 화면으로 보기</button>
          <button type="button" onClick={() => router.back()} aria-label="닫기" className="inline-flex size-9 items-center justify-center rounded-full border border-line bg-panel hover:bg-soft">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
