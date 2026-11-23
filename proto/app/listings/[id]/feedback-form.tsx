"use client";
// 좋아요/싫어요 + 싫어요 이유 1개 + 리뷰 글 (U14)
import { useHydrated } from "@/app/_components/use-hydrated";
import { useActionState, useState } from "react";
import { saveFeedback, type FeedbackState } from "./actions";

const REASONS = [
  { key: "rent_terms", label: "임대료·조건" },
  { key: "space", label: "공간 상태" },
  { key: "location", label: "입지·상권" },
  { key: "entry", label: "입점 어려움" },
  { key: "info_error", label: "정보 오류" },
  { key: "other", label: "기타" },
];

type Props = {
  listingId: string;
  initial: { rating: "good" | "bad"; reason: string | null; review: string | null } | null;
};

export function FeedbackForm({ listingId, initial }: Props) {
  const [state, action, pending] = useActionState<FeedbackState, FormData>(saveFeedback, null);
  const hydrated = useHydrated();
  const [rating, setRating] = useState<"good" | "bad" | null>(initial?.rating ?? null);
  const [length, setLength] = useState(initial?.review?.length ?? 0);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="listing_id" value={listingId} />
      <div className="flex gap-2" role="radiogroup" aria-label="평가">
        {(["good", "bad"] as const).map((value) => (
          <label
            key={value}
            className={`flex-1 cursor-pointer rounded-lg border px-4 py-2 text-center text-sm ${
              rating === value
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <input
              type="radio"
              name="rating"
              value={value}
              className="sr-only"
              defaultChecked={initial?.rating === value}
              onChange={() => setRating(value)}
            />
            {value === "good" ? "👍 좋아요" : "👎 싫어요"}
          </label>
        ))}
      </div>

      {rating === "bad" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm">가장 큰 이유 1개를 골라 주세요</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {REASONS.map((reason) => (
              <label key={reason.key} className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
                <input type="radio" name="reason" value={reason.key} defaultChecked={initial?.reason === reason.key} required />
                {reason.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-zinc-500">다른 이유가 있으면 아래 리뷰에 적어 주세요.</p>
        </fieldset>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span>리뷰 (선택)</span>
        <textarea
          name="review"
          rows={3}
          maxLength={500}
          defaultValue={initial?.review ?? ""}
          onChange={(event) => setLength(event.target.value.length)}
          placeholder="이 매물에 대해 느낀 점을 적어 주세요."
          className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />
        <span className="flex justify-between text-xs text-zinc-500">
          <span>이름·연락처는 쓰지 마세요.</span>
          {length > 400 && <span>{length}/500</span>}
        </span>
      </label>

      <button
        type="submit"
        disabled={pending || rating === null || !hydrated}
        className="rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "저장 중…" : initial ? "평가 고치기" : "평가 남기기"}
      </button>
      {state && (
        <p role="status" className={`text-sm ${state.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
