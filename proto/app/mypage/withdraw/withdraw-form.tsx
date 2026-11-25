"use client";
// 회원 탈퇴 양식: 이유를 묻고, 최종 확인을 체크해야 진행한다.
import Link from "next/link";
import { useActionState, useState } from "react";
import { WITHDRAWAL_REASONS } from "@/lib/legal/withdrawal-reasons";
import { withdrawAccount, type WithdrawState } from "./actions";

export function WithdrawForm() {
  const [state, action, pending] = useActionState<WithdrawState, FormData>(
    withdrawAccount,
    {},
  );
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-2 font-medium">탈퇴 이유를 알려주세요 (선택)</legend>
        {WITHDRAWAL_REASONS.map((reason) => (
          <label key={reason.code} className="flex items-center gap-2">
            <input type="radio" name="reason" value={reason.code} className="size-4" />
            {reason.label}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2 rounded-xl border border-red-300 p-4 dark:border-red-900">
        <p className="font-medium">정말 탈퇴하시겠습니까?</p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="confirm"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 size-4"
          />
          위 내용을 확인했으며, 탈퇴하면 계정을 복구할 수 없다는 것에 동의합니다.
        </label>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={!confirmed || pending}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "처리 중…" : "탈퇴하기"}
        </button>
        <Link href="/mypage" className="text-sm underline">
          취소
        </Link>
      </div>
    </form>
  );
}
