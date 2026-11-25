"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { setSaved } from "@/app/saved/actions";
import type { SavedState } from "@/lib/saved/types";

type SavedContextValue = {
  state: SavedState;
  listId: string | null;
  selectList: (id: string) => void;
  pending: boolean;
  toggle: (id: string, remove?: boolean) => void;
};
const SavedContext = createContext<SavedContextValue | null>(null);

export function SavedProvider({ state, children }: { state: SavedState; children: React.ReactNode }) {
  const [chosenList, selectList] = useState<string | null>(null);
  const listId = state.lists.some((list) => list.id === chosenList) ? chosenList : state.lists[0]?.id ?? null;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function toggle(id: string, remove?: boolean) {
    const saved = state.items.some((item) => item.listing_id === id && item.list_id === listId);
    startTransition(async () => {
      setMessage("");
      try {
        const result = await setSaved(id, remove ? false : !saved, listId);
        setMessage(result.ok ? (remove || saved ? "담기에서 뺐어요." : "매물을 담았어요.") : result.message ?? "저장하지 못했어요.");
      } catch {
        setMessage("저장하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
      }
    });
  }

  return (
    <SavedContext value={{ state, listId, selectList, pending, toggle }}>
      {children}
      {message && <p role="status" className="fixed inset-x-4 bottom-5 z-50 mx-auto max-w-md rounded-xl bg-zinc-900 px-4 py-3 text-center text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">{message}</p>}
    </SavedContext>
  );
}

export function useSaved() {
  const value = useContext(SavedContext);
  if (!value) throw new Error("SavedProvider가 필요합니다.");
  return value;
}
