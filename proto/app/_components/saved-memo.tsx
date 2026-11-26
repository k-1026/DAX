"use client";
// 담은 매물 메모. 쓰기는 구독 회원만, 이미 쓴 메모는 구독이 끝나도 보인다. 나만 볼 수 있다.
import { useState, useTransition } from "react";
import { setSavedMemo } from "@/app/saved/actions";

export function SavedMemo({ listId, listingId, memo: initial, canEdit }: { listId: string; listingId: string; memo: string | null; canEdit: boolean }) {
  // 저장한 글을 바로 보여 준다(상세 창은 서버가 다시 그리지 않으므로).
  const [memo, setMemo] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memo ?? "");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  if (!canEdit) return memo ? <p className="mt-2 whitespace-pre-wrap break-words rounded bg-soft px-2 py-1 text-xs">✏️ {memo}</p> : null;

  if (!editing) {
    return (
      <div className="mt-2 flex items-start gap-2 text-xs">
        {memo ? <p className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded bg-soft px-2 py-1">✏️ {memo}</p> : null}
        <button type="button" onClick={() => { setText(memo ?? ""); setMessage(""); setEditing(true); }} className="shrink-0 underline">
          {memo ? "메모 고치기" : "✏️ 메모 쓰기"}
        </button>
        {message && <span role="status" className="text-muted">{message}</span>}
      </div>
    );
  }

  function save() {
    startTransition(async () => {
      try {
        const result = await setSavedMemo(listId, listingId, text);
        if (result.ok) { setMemo(text.trim() || null); setEditing(false); setMessage("저장했어요."); }
        else setMessage(result.message ?? "저장하지 못했어요.");
      } catch { setMessage("저장하지 못했어요. 다시 시도해 주세요."); }
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-1 text-xs">
      <textarea aria-label="메모" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} rows={2} autoFocus
        placeholder="예: 주인과 통화함, 권리금 협의 가능" className="rounded border border-zinc-300 bg-transparent p-2 dark:border-zinc-700" />
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className="rounded bg-zinc-900 px-2 py-1 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{pending ? "저장 중…" : "저장"}</button>
        <button type="button" onClick={() => setEditing(false)} disabled={pending} className="underline">취소</button>
        <span className="text-faint">{text.trim().length}/300 · 나만 볼 수 있어요</span>
        {message && <span role="status" className="text-amber-800 dark:text-amber-200">{message}</span>}
      </div>
    </div>
  );
}
