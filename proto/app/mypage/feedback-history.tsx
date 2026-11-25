"use client";
// 마이페이지 "내 평가": 내가 남긴 좋아요·싫어요와 리뷰. 5개씩 보고, 하나씩 지울 수 있다.
import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteMyFeedback, loadMyFeedback, type FeedbackItem, type FeedbackPage } from "./actions";

const REASON_LABELS: Record<string, string> = {
  rent_terms: "임대료·조건",
  space: "공간 상태",
  location: "입지·상권",
  entry: "입점 어려움",
  info_error: "정보 오류",
  other: "기타",
};

const dateText = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(value));

export function FeedbackHistory({ initial }: { initial: FeedbackPage }) {
  const [items, setItems] = useState<FeedbackItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (total === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        아직 남긴 평가가 없어요. 매물 상세에서 좋아요·싫어요를 남겨 보세요.
      </p>
    );
  }

  const more = () =>
    startTransition(async () => {
      const page = await loadMyFeedback(items.length);
      if (!page) return setError("목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      setError(null);
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((c) => c.id === item.id))]);
      setTotal(page.total);
    });

  const remove = (id: string) =>
    startTransition(async () => {
      const ok = await deleteMyFeedback(id);
      if (!ok) return setError("삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setError(null);
      setItems((current) => current.filter((item) => item.id !== id));
      setTotal((count) => count - 1);
    });

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 py-3 first:pt-0">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/listings/${item.listing_id}`} className="text-sm font-medium hover:underline">
                {[item.gu, item.dong, item.floor].filter(Boolean).join(" ")}
              </Link>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(item.id)}
                className="shrink-0 text-xs text-zinc-600 underline disabled:opacity-50 dark:text-zinc-400"
              >
                삭제
              </button>
            </div>
            <p className="text-sm">
              <span className={item.rating === "good" ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}>
                {item.rating === "good" ? "좋아요" : "싫어요"}
              </span>
              {item.bad_reasons[0] && <span className="text-zinc-600 dark:text-zinc-400"> · {REASON_LABELS[item.bad_reasons[0]] ?? item.bad_reasons[0]}</span>}
              <span className="text-xs text-zinc-500"> · {dateText(item.created_at)}</span>
            </p>
            {item.review && <p className="whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">{item.review}</p>}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {items.length < total && (
        <button
          type="button"
          disabled={pending}
          onClick={more}
          className="self-start rounded-lg border border-zinc-300 px-4 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
        >
          {pending ? "불러오는 중…" : `더 보기 (${total - items.length}개 남음)`}
        </button>
      )}
    </div>
  );
}
