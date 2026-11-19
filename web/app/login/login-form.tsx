"use client";
// 로그인 화면의 입력 양식 (이메일 로그인/가입 + 카카오 버튼)
import { useActionState, useState } from "react";
import {
  signInWithEmail,
  signInWithKakao,
  signUpWithEmail,
  type FormState,
} from "./actions";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signInAction, signingIn] = useActionState<FormState, FormData>(
    signInWithEmail,
    { error: initialError },
  );
  const [signUpState, signUpAction, signingUp] = useActionState<FormState, FormData>(
    signUpWithEmail,
    {},
  );

  const state = mode === "signin" ? signInState : signUpState;
  const pending = signingIn || signingUp;

  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <form action={signInWithKakao}>
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#FEE500] px-4 py-3 font-medium text-black/85 hover:brightness-95"
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.86 5.32 4.66 6.73l-.95 3.5c-.08.3.26.54.52.37l4.14-2.75c.53.06 1.07.1 1.63.1 5.52 0 10-3.58 10-8S17.52 3 12 3z"
            />
          </svg>
          카카오로 시작하기
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" />
        또는 이메일로
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        action={mode === "signin" ? signInAction : signUpAction}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1 text-left text-sm">
          이메일
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-xl border border-line bg-transparent px-3 py-2.5 outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-left text-sm">
          비밀번호
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="rounded-xl border border-line bg-transparent px-3 py-2.5 outline-none focus:border-accent"
          />
        </label>

        {state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        {state.message && <p className="text-sm text-green-700">{state.message}</p>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-brand px-4 py-3 font-medium text-brand-ink disabled:opacity-60"
        >
          {pending ? "처리 중…" : mode === "signin" ? "이메일로 로그인" : "이메일로 가입"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="text-sm text-accent"
      >
        {mode === "signin" ? "계정이 없나요? 이메일로 가입" : "이미 계정이 있나요? 로그인"}
      </button>
    </div>
  );
}
