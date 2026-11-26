"use client";
import { useActionState } from "react";
import { enterGate } from "./actions";

export function GateForm({ next }: { next: string }) {
  const [error, action, pending] = useActionState(enterGate, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm">
        입장 비밀번호
        <input name="password" type="password" required autoFocus autoComplete="off" className="rounded-lg border border-line bg-panel px-3 py-2" />
      </label>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <button type="submit" disabled={pending} className="rounded-full bg-zinc-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
        {pending ? "확인 중…" : "들어가기"}
      </button>
    </form>
  );
}
