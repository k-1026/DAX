"use client";
// 상세 창: 담은 매물이면 바로 메모(구독 회원). 무료 회원은 안내 한 줄만.
import Link from "next/link";
import { SavedMemo } from "./saved-memo";
import { useSaved } from "./saved-provider";

export function DetailMemo({ listingId }: { listingId: string }) {
  const { state, listId, isSaved } = useSaved();
  if (!isSaved(listingId) || !listId) return null;
  const item = state.items.find((entry) => entry.listing_id === listingId && entry.list_id === listId);
  if (state.tier === "subscriber" || state.tier === "admin") {
    return (
      <div className="rounded-2xl bg-soft px-4 py-3">
        <p className="text-xs text-muted">내 메모 · 나만 볼 수 있어요</p>
        <SavedMemo key={`${listingId}-${item?.memo ?? ""}`} listId={listId} listingId={listingId} memo={item?.memo ?? null} canEdit />
      </div>
    );
  }
  return (
    <p className="text-xs text-muted">
      ✏️ 담은 매물에 메모를 남기는 기능은 구독 회원 혜택이에요. <Link href="/#saved-studio" className="underline">담은 매물 보기</Link>
    </p>
  );
}
