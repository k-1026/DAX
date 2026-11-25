"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { compareSaved, createSavedList } from "@/app/saved/actions";
import { money, savedTitle } from "@/lib/saved/display";
import type { SavedItem } from "@/lib/saved/types";
import { QuickRate } from "./quick-rate";
import { myRatingsFor } from "./quick-rate-actions";
import { useSaved } from "./saved-provider";
import { StudioTiles } from "./studio-tiles";
import { SavedCompare } from "./saved-compare";
import { AiWorking } from "./ai-working";
import { StudioDetail, type Candidate, type StudioView } from "./studio-views";
import { useHydrated } from "./use-hydrated";

const buttonClass = "rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700";

export function SavedStudio({ candidates = [] }: { candidates?: Candidate[] }) {
  const [view, setView] = useState<StudioView | null>(null);
  const [comparing, setComparing] = useState(false);
  const { state, listId, selectList, pending: saving, toggle } = useSaved();
  const hydrated = useHydrated();
  const [chosenIds, setChosenIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<{ key: string; items: SavedItem[] } | null>(null);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [rateOpen, setRateOpen] = useState(false);
  const [ratings, setRatings] = useState<Record<string, "good" | "bad"> | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = saving || pending || !hydrated;
  const items = state.items.filter((item) => item.list_id === listId);
  const selected = chosenIds.filter((id) => items.some((item) => item.listing_id === id && item.available));
  const comparisonKey = JSON.stringify([listId, selected, state.items, state.compare_limit]);
  const currentComparison = comparison?.key === comparisonKey ? comparison.items : null;

  const savedIds = items.map((item) => item.listing_id).join(",");
  useEffect(() => {
    if (!rateOpen || !savedIds) return;
    let alive = true;
    myRatingsFor(savedIds.split(",")).then((map) => alive && setRatings(map)).catch(() => alive && setRatings({}));
    return () => { alive = false; };
  }, [rateOpen, savedIds]);

  function openComparison() {
    document.getElementById("saved-note")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (selected.length >= 2 && selected.length <= state.compare_limit) compare();
    else setMessage(`비교할 매물을 아래 노트에서 2곳 이상 골라 주세요. (한 번에 ${state.compare_limit}곳까지)`);
  }

  function choose(id: string, checked: boolean) {
    setMessage("");
    setChosenIds(checked ? [...selected, id] : selected.filter((item) => item !== id));
  }

  function compare() {
    setComparing(true);
    startTransition(async () => {
      setMessage("");
      const started = Date.now();
      try {
        const result = await compareSaved(selected);
        // AI가 분석하는 단계가 보이도록 최소 시간은 기다린다.
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1900 - (Date.now() - started))));
        if (result.ok && result.items) setComparison({ key: comparisonKey, items: result.items });
        else { setComparison(null); setMessage(result.message ?? "비교 정보를 불러오지 못했어요."); }
      } catch { setMessage("비교 정보를 불러오지 못했어요. 다시 시도해 주세요."); }
      setComparing(false);
    });
  }

  function addList(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      setMessage("");
      try {
        const result = await createSavedList(name);
        if (result.ok && result.id) { selectList(result.id); setChosenIds([]); setName(""); }
        else setMessage(result.message ?? "목록을 만들지 못했어요.");
      } catch { setMessage("목록을 만들지 못했어요. 다시 시도해 주세요."); }
    });
  }

  return (
    <aside id="saved-studio" aria-label="담기·비교 스튜디오" className="flex min-w-0 flex-col gap-4">
      {view ? <StudioDetail view={view} onBack={() => setView(null)} candidates={candidates} guest={state.tier === "guest"} /> : <>
      <StudioTiles guest={state.tier === "guest"} count={state.total} onCompare={openComparison} rateOpen={rateOpen} onToggleRate={() => setRateOpen((open) => !open)} onOpen={setView} />
      {state.tier === "guest" ? <p className="text-sm">로그인하면 매물을 담고 비교할 수 있어요. <Link href="/login" className="underline">무료로 로그인하기</Link></p>
      : !state.ok ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">담은 매물을 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>
      : <>
        <div id="saved-note" className="flex items-baseline justify-between gap-2 border-t border-line pt-4">
          <h3 className="text-sm font-medium">노트 · 담은 매물</h3>
          <p className="text-xs text-muted"><b>{state.total}곳</b>{state.saved_limit !== null && ` / ${state.saved_limit}곳`} · 한 번에 비교 {state.compare_limit}곳</p>
        </div>
        {items.length > 0 && <a href={`/saved/export?list=${listId ?? ""}`} download className="self-start rounded-full border border-line bg-panel px-3.5 py-1.5 text-xs hover:bg-soft">엑셀로 저장 (.xlsx)</a>}
        {rateOpen && <p className="rounded-xl bg-tile-purple px-3 py-2 text-xs">담은 매물에 👍 👎로 평가해 주세요. 추천 정확도를 높이는 데 쓰여요. <Link href="/mypage" className="underline">내 평가 보기</Link></p>}
        {state.lists.length > 0 && <label className="flex flex-col gap-1 text-sm">담기 목록
          <select value={listId ?? ""} disabled={busy} onChange={(e) => { selectList(e.target.value); setChosenIds([]); setMessage(""); }} className="rounded-lg border border-zinc-300 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-950">
            {state.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
        </label>}
        {(state.tier !== "member" || state.lists.length === 0) && <form onSubmit={addList} className="flex gap-2">
          <input aria-label="새 담기 목록 이름" placeholder="새 목록 이름" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700" />
          <button type="submit" disabled={busy || !name.trim()} className={buttonClass}>목록 추가</button>
        </form>}
        {items.length === 0 ? <p className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-500 dark:bg-zinc-900">아직 담은 매물이 없어요. 매물의 ‘담기’를 눌러 후보를 모아 보세요.</p> : <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const checked = selected.includes(item.listing_id);
            const title = item.available && item.data ? savedTitle(item.data) : "이용할 수 없는 매물";
            return <li key={item.listing_id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-2">
                <label className="flex min-w-0 items-start gap-2 text-sm">
                  <input type="checkbox" checked={checked} disabled={busy || !item.available || (!checked && selected.length >= state.compare_limit)} onChange={(e) => choose(item.listing_id, e.target.checked)} className="mt-1" />
                  <span className="break-words">{title}<span className="sr-only"> 비교 선택</span></span>
                </label>
                <button type="button" onClick={() => toggle(item.listing_id, true)} disabled={busy} aria-label={`${title} 담기 해제`} className="shrink-0 text-xs text-zinc-500 underline disabled:opacity-50">빼기</button>
              </div>
              {item.available && item.data && <div className="mt-1 pl-5 text-xs text-zinc-500">
                <p>보증금 {money(item.data.deposit)} · 월세 {money(item.data.rent)}</p>
                {item.status !== "active" && <p>게시 종료</p>}
                {item.needs_check && <p className="text-amber-700 dark:text-amber-300">확인 필요</p>}
                <Link href={`/listings/${item.listing_id}`} className="underline">상세 보기</Link>
              </div>}
              {rateOpen && item.available && <div className="mt-2 flex flex-wrap items-center pl-3">
                {ratings === null ? <span className="text-xs text-zinc-500">불러오는 중…</span>
                  : <QuickRate key={`${item.listing_id}-${ratings[item.listing_id] ?? "none"}`} listingId={item.listing_id} initial={ratings[item.listing_id] ?? null} guest={false} />}
              </div>}
            </li>;
          })}
        </ul>}
        <button type="button" onClick={compare} disabled={busy || selected.length < 2 || selected.length > state.compare_limit} className="rounded-lg bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
          {pending ? "처리 중…" : `선택한 ${selected.length}곳 비교`}
        </button>
        {message && <p role="status" className="text-sm text-amber-800 dark:text-amber-200">{message}</p>}
        {comparing && <AiWorking title="AI가 비교 분석 중입니다…" steps={["AI가 고른 매물을 불러오는 중", "항목별로 나란히 놓는 중", "공통점과 차이점을 찾는 중"]} stepMs={550} />}
        {!comparing && currentComparison && <SavedCompare items={currentComparison} />}
      </>}
      </>}
      <p className="border-t border-line pt-3 text-xs text-faint">서비스 의견이나 오류는 <Link href="/report" className="underline">문제 신고</Link>로 알려 주세요.</p>
    </aside>
  );
}
