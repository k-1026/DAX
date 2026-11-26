"use client";
// 담기 상태. 누르자마자 화면을 먼저 바꾸고(실패하면 되돌림), 저장은 뒤에서 한다.
// 저장하는 동안 그 매물 버튼만 잠그고, 다른 매물은 계속 담을 수 있다.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { setSaved } from "@/app/saved/actions";
import type { SavedItem, SavedState } from "@/lib/saved/types";

type Notice = { text: string; tone: "ok" | "warn"; showLink: boolean };
type SavedContextValue = {
  state: SavedState;
  listId: string | null;
  selectList: (id: string) => void;
  /** 저장 중인 매물이 하나라도 있으면 true (목록 바꾸기 등 잠글 때만 사용) */
  pending: boolean;
  isPending: (id: string) => boolean;
  isSaved: (id: string) => boolean;
  /** 무료 회원 한도가 찼는지 */
  full: boolean;
  toggle: (id: string, remove?: boolean) => void;
};
const SavedContext = createContext<SavedContextValue | null>(null);
// 상세 창과 뒤의 추천 화면은 담기 상태를 따로 들고 있어서, 한쪽에서 저장하면 다른 쪽에도 알려 맞춘다.
const SYNC_EVENT = "dax:saved-state";

const distinctCount = (items: SavedItem[]) => new Set(items.map((item) => item.listing_id)).size;

export function SavedProvider({ state: initial, children }: { state: SavedState; children: React.ReactNode }) {
  const [state, setState] = useState(initial);
  const [chosenList, selectList] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(0);

  // 서버가 새 정보를 주면(목록 추가·새로고침 등) 그것으로 맞춘다.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setState(initial);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const onSync = (event: Event) => {
      const next = (event as CustomEvent<SavedState>).detail;
      if (next && inFlight.current === 0) setState(next);
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);

  const listId = state.lists.some((list) => list.id === chosenList) ? chosenList : state.lists[0]?.id ?? null;
  const isSaved = (id: string) => state.items.some((item) => item.listing_id === id && item.list_id === listId);
  const full = state.saved_limit !== null && state.total >= state.saved_limit;
  const countText = (total: number) => (state.saved_limit !== null ? ` (${total}/${state.saved_limit}곳)` : ` (${total}곳)`);

  function show(next: Notice) {
    setNotice(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 4000);
  }

  // 빠르게 여러 번 눌러도 앞의 표시가 사라지지 않게, 화면 갱신 전에도 가장 최근 상태를 기준으로 계산한다.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  function toggle(id: string, remove?: boolean) {
    if (pendingIds.includes(id)) return;
    const now = latest.current;
    const wasSaved = now.items.some((item) => item.listing_id === id && item.list_id === listId);
    const adding = remove ? false : !wasSaved;
    const alreadyElsewhere = now.items.some((item) => item.listing_id === id);
    const nowFull = now.saved_limit !== null && now.total >= now.saved_limit;
    if (adding && nowFull && !alreadyElsewhere) {
      show({ text: `무료 회원은 ${state.saved_limit}곳까지 담을 수 있어요. 담은 매물을 하나 빼거나, 구독하면 무제한으로 담을 수 있어요.`, tone: "warn", showLink: true });
      return;
    }

    // 1) 화면 먼저 바꾸기
    const removed = now.items.filter((item) => item.listing_id === id && item.list_id === listId);
    const items = adding
      ? [{ listing_id: id, list_id: listId ?? undefined, available: true, saved_at: new Date().toISOString() } as SavedItem, ...now.items]
      : now.items.filter((item) => !(item.listing_id === id && item.list_id === listId));
    const total = distinctCount(items);
    latest.current = { ...now, items, total };
    setState(latest.current);
    setPendingIds((ids) => [...ids, id]);
    inFlight.current += 1;
    show({ text: adding ? `담았어요${countText(total)}` : `담기에서 뺐어요${countText(total)}`, tone: "ok", showLink: adding });

    // 실패하면 이 매물만 되돌린다(동시에 누른 다른 매물은 그대로).
    const undo = (message: string) => {
      setState((current) => {
        const rest = current.items.filter((item) => !(item.listing_id === id && item.list_id === listId));
        const restored = adding ? rest : [...removed, ...rest];
        return { ...current, items: restored, total: distinctCount(restored) };
      });
      show({ text: message, tone: "warn", showLink: false });
    };

    // 2) 뒤에서 저장. 서버 정보는 마지막 저장이 끝났을 때만 반영해 앞의 응답이 뒤의 표시를 덮지 않게 한다.
    setSaved(id, adding, listId)
      .then((result) => {
        inFlight.current -= 1;
        if (!result.ok) undo(result.message ?? "저장하지 못했어요.");
        else if (result.state && inFlight.current === 0) {
          setState(result.state);
          window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: result.state }));
        }
      })
      .catch(() => {
        inFlight.current -= 1;
        undo("저장하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
      })
      .finally(() => setPendingIds((ids) => ids.filter((item) => item !== id)));
  }

  return (
    <SavedContext
      value={{ state, listId, selectList, pending: pendingIds.length > 0, isPending: (id) => pendingIds.includes(id), isSaved, full, toggle }}
    >
      {children}
      {notice && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-5 z-50 mx-auto flex max-w-md items-center justify-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
            notice.tone === "warn" ? "bg-amber-50 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950 dark:text-amber-100" : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          }`}
        >
          <span>{notice.text}</span>
          {notice.showLink && (
            <Link
              href="/#saved-studio"
              onClick={(event) => {
                const target = document.getElementById("saved-studio");
                if (target) { event.preventDefault(); target.scrollIntoView({ behavior: "smooth", block: "start" }); }
                setNotice(null);
              }}
              className="shrink-0 font-medium underline"
            >
              담은 매물 보기
            </Link>
          )}
        </div>
      )}
    </SavedContext>
  );
}

export function useSaved() {
  const value = useContext(SavedContext);
  if (!value) throw new Error("SavedProvider가 필요합니다.");
  return value;
}
