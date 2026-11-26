"use client";

import Link from "next/link";
import { useSaved } from "./saved-provider";
import { useHydrated } from "./use-hydrated";
import { PRIMARY_BUTTON, SAVED_BUTTON } from "./action-styles";

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 4h12v17l-6-4-6 4z" />
    </svg>
  );
}

export function SavedButton({ listingId, variant = "text" }: { listingId: string; variant?: "text" | "icon" | "primary" }) {
  const { state, isPending, isSaved, full, toggle } = useSaved();
  const hydrated = useHydrated();
  const busy = isPending(listingId);
  const saved = isSaved(listingId);
  const blocked = !saved && full && !state.items.some((item) => item.listing_id === listingId);

  if (variant === "primary") {
    if (state.tier === "guest") return <Link href="/login" className={PRIMARY_BUTTON}><BookmarkIcon filled={false} />로그인하고 담기</Link>;
    return (
      <button type="button" aria-pressed={saved} disabled={!hydrated || busy || !state.ok} onClick={() => toggle(listingId)}
        title={saved ? "눌러서 담기에서 빼기" : blocked ? `담기 한도(${state.saved_limit}곳)가 찼어요` : undefined}
        className={`${saved ? SAVED_BUTTON : PRIMARY_BUTTON} disabled:opacity-60`}>
        <BookmarkIcon filled={saved} />
        {saved ? "담음 ✓" : "담기"}
      </button>
    );
  }
  if (variant === "icon") {
    const base = "inline-flex h-9 items-center justify-center gap-1 rounded-lg px-2.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800";
    if (state.tier === "guest") {
      return <Link href="/login" className={`${base} text-zinc-600 dark:text-zinc-400`} aria-label="로그인하고 매물 담기" title="로그인하고 담기"><BookmarkIcon filled={false} />담기</Link>;
    }
    return (
      <button type="button" aria-pressed={saved} aria-label={saved ? "담기 해제" : "매물 담기"}
        title={saved ? "담음 · 눌러서 빼기" : blocked ? `담기 한도(${state.saved_limit}곳)가 찼어요` : "담기"}
        disabled={!hydrated || busy || !state.ok} onClick={() => toggle(listingId)}
        className={`${base} ${saved ? "font-medium text-blue-700 dark:text-blue-300" : blocked ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-600 dark:text-zinc-400"} disabled:opacity-60`}>
        <BookmarkIcon filled={saved} />
        {saved ? "담음" : "담기"}
      </button>
    );
  }
  const classes = "inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700";
  if (state.tier === "guest") return <Link href="/login" className={classes} aria-label="로그인하고 매물 담기">담기 · 로그인</Link>;
  return (
    <button type="button" aria-pressed={saved} disabled={!hydrated || busy || !state.ok}
      onClick={() => toggle(listingId)}
      title={!state.ok ? "담기 정보를 불러오지 못했어요." : blocked ? `담기 한도(${state.saved_limit}곳)가 찼어요` : undefined}
      className={`${classes} ${saved ? "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200" : ""} disabled:opacity-60`}>
      <BookmarkIcon filled={saved} />
      {saved ? "담음 · 빼기" : "담기"}
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
