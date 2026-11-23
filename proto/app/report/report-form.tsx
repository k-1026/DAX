"use client";
import { useHydrated } from "@/app/_components/use-hydrated";
import { useActionState, useState } from "react";
import { submitReport, type ReportState } from "./actions";

const KINDS = [
  { key: "payment", label: "결제 오류" },
  { key: "privacy", label: "개인정보 문제" },
  { key: "outage", label: "사이트 오류·접속 장애" },
  { key: "listing_error", label: "매물 정보가 실제와 다름" },
  { key: "other", label: "기타" },
];

type Props = { kind?: string; listingId?: string; maxLength: number };

export function ReportForm({ kind, listingId, maxLength }: Props) {
  const [state, action, pending] = useActionState<ReportState, FormData>(submitReport, null);
  const hydrated = useHydrated();
  const [length, setLength] = useState(0);

  if (state?.ok) {
    return (
      <p role="status" className="rounded-lg bg-green-50 p-4 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {listingId && <input type="hidden" name="listing_id" value={listingId} />}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm">어떤 문제인가요?</legend>
        {KINDS.map((option) => (
          <label key={option.key} className="flex items-center gap-2 text-sm">
            <input type="radio" name="kind" value={option.key} defaultChecked={kind === option.key} required />
            {option.label}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span>무슨 일이 있었는지 알려 주세요</span>
        <textarea
          name="body"
          rows={4}
          maxLength={maxLength}
          required
          onChange={(event) => setLength(event.target.value.length)}
          className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />
        <span className="flex justify-between gap-3 text-xs text-zinc-500">
          <span>이름·연락처·카드번호는 쓰지 마세요. 답장이 필요한 문의는 받지 않습니다.</span>
          {length > 0 && (
            <span className="shrink-0" aria-live="polite">
              ({length}/{maxLength}자)
            </span>
          )}
        </span>
      </label>

      <button
        type="submit"
        disabled={pending || !hydrated}
        className="rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "보내는 중…" : "신고 보내기"}
      </button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
