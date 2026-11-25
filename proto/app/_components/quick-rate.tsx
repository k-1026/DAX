"use client";
// 목록 카드의 좋아요·싫어요 아이콘. 좋아요는 바로 저장, 싫어요는 저장 뒤 이유·리뷰를 덧붙일 수 있다.
import Link from "next/link";
import { useState, useTransition } from "react";
import { rateListing } from "./quick-rate-actions";
import { useHydrated } from "./use-hydrated";

type Rating = "good" | "bad" | null;

const REASONS: [string, string][] = [
  ["rent_terms", "임대료·조건"],
  ["space", "공간 상태"],
  ["location", "입지·상권"],
  ["entry", "입점 어려움"],
  ["info_error", "정보 오류"],
  ["other", "기타"],
];

function Thumb({ up, filled }: { up: boolean; filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" style={up ? undefined : { transform: "scaleY(-1)" }}>
      <path d="M7 11v9H4v-9h3zm0 0 4-8c1.5 0 2.5 1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1 6.5A2 2 0 0 1 18 20H7" />
    </svg>
  );
}

const iconClass =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800";

export function QuickRate({ listingId, initial, guest }: { listingId: string; initial: Rating; guest: boolean }) {
  const [rating, setRating] = useState<Rating>(initial);
  const [panel, setPanel] = useState(false);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  if (guest) {
    return (
      <>
        <Link href="/login" className={iconClass} aria-label="로그인하고 좋아요" title="로그인하고 평가">
          <Thumb up filled={false} />
        </Link>
        <Link href="/login" className={iconClass} aria-label="로그인하고 싫어요" title="로그인하고 평가">
          <Thumb up={false} filled={false} />
        </Link>
      </>
    );
  }

  const press = (next: "good" | "bad") => {
    const target: Rating = rating === next ? null : next;
    const before = rating;
    setRating(target);
    setMessage("");
    setPanel(target === "bad");
    startTransition(async () => {
      const result = await rateListing({ listingId, rating: target });
      if (!result.ok) {
        setRating(before);
        setPanel(false);
        setMessage(result.message ?? "저장하지 못했어요.");
      }
    });
  };

  const saveDetail = () =>
    startTransition(async () => {
      const result = await rateListing({ listingId, rating: "bad", reason: reason || undefined, review });
      if (result.ok) {
        setPanel(false);
        setMessage("저장했어요. 개인정보는 가려서 저장돼요.");
      } else setMessage(result.message ?? "저장하지 못했어요.");
    });

  return (
    <>
      <button type="button" aria-pressed={rating === "good"} aria-label="좋아요" title="좋아요" disabled={!hydrated || pending}
        onClick={() => press("good")}
        className={`${iconClass} ${rating === "good" ? "text-green-700 dark:text-green-300" : ""} disabled:opacity-50`}>
        <Thumb up filled={rating === "good"} />
      </button>
      <button type="button" aria-pressed={rating === "bad"} aria-label="싫어요" title="싫어요" disabled={!hydrated || pending}
        onClick={() => press("bad")}
        className={`${iconClass} ${rating === "bad" ? "text-red-700 dark:text-red-300" : ""} disabled:opacity-50`}>
        <Thumb up={false} filled={rating === "bad"} />
      </button>
      {(panel || message) && (
        <div className="basis-full">
          {panel && (
            <div className="mt-2 flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
              <p className="font-medium">싫어요를 저장했어요. 이유를 남기면 추천이 좋아져요 (건너뛰어도 돼요)</p>
              <select value={reason} onChange={(event) => setReason(event.target.value)}
                className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700">
                <option value="">이유 선택 (선택)</option>
                {REASONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <textarea value={review} onChange={(event) => setReview(event.target.value)} maxLength={500} rows={2}
                placeholder="리뷰 (선택, 500자 이내)"
                className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700" />
              <div className="flex gap-2">
                <button type="button" onClick={saveDetail} disabled={pending}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
                  저장
                </button>
                <button type="button" onClick={() => setPanel(false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
                  닫기
                </button>
              </div>
            </div>
          )}
          {message && <p role="status" className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{message}</p>}
        </div>
      )}
    </>
  );
}
