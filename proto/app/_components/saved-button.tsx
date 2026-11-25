"use client";

import Link from "next/link";
import { useSaved } from "./saved-provider";
import { useHydrated } from "./use-hydrated";

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 4h12v17l-6-4-6 4z" />
    </svg>
  );
}

export function SavedButton({ listingId, variant = "text" }: { listingId: string; variant?: "text" | "icon" }) {
  const { state, listId, pending, toggle } = useSaved();
  const hydrated = useHydrated();
  const classes = "inline-flex items-center justify-center rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700";
  const iconClasses = "inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800";
  if (variant === "icon") {
    if (state.tier === "guest") {
      return <Link href="/login" className={iconClasses} aria-label="로그인하고 매물 담기" title="로그인하고 담기"><BookmarkIcon filled={false} /></Link>;
    }
    const isSaved = state.items.some((item) => item.listing_id === listingId && item.list_id === listId);
    return (
      <button type="button" aria-pressed={isSaved} aria-label={isSaved ? "담기 해제" : "매물 담기"} title={isSaved ? "담음 · 눌러서 해제" : "담기"}
        disabled={!hydrated || pending || !state.ok} onClick={() => toggle(listingId)}
        className={`${iconClasses} ${isSaved ? "text-blue-700 dark:text-blue-300" : ""} disabled:opacity-50`}>
        <BookmarkIcon filled={isSaved} />
      </button>
    );
  }
  if (state.tier === "guest") return <Link href="/login" className={classes} aria-label="로그인하고 매물 담기">담기 · 로그인</Link>;
  const saved = state.items.some((item) => item.listing_id === listingId && item.list_id === listId);
  return (
    <button type="button" aria-pressed={saved} disabled={!hydrated || pending || !state.ok}
      onClick={() => toggle(listingId)} title={!state.ok ? "담기 정보를 불러오지 못했어요." : undefined}
      className={`${classes} ${saved ? "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200" : ""} disabled:opacity-50`}>
      {saved ? "✓ 담음 · 해제" : "담기"}
    </button>
  );
}

export function SavedListSelector() {
  const { state, listId, selectList, pending } = useSaved();
  const hydrated = useHydrated();
  if (state.lists.length < 2) return null;
  return <label className="flex items-center gap-2 text-sm">담기 목록
    <select value={listId ?? ""} onChange={(event) => selectList(event.target.value)} disabled={!hydrated || pending}
      className="max-w-56 rounded-lg border border-zinc-300 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-950">
      {state.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
    </select>
  </label>;
}
