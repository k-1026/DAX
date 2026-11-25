"use client";
// 카드의 [지도] 버튼: 위쪽 지도에서 이 매물 핀을 강조하고 지도를 화면에 보여 준다.
export const FOCUS_EVENT = "focus-listing-pin";

export function MapFocusButton({ listingId }: { listingId: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { id: listingId } }));
        document.querySelector('section[aria-label="지도"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
      }}
      className="inline-flex items-center gap-1 text-sm text-zinc-700 hover:underline dark:text-zinc-300"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
      지도
    </button>
  );
}
