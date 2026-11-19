"use client";
// 로그인 화면의 입력 양식 (이메일 로그인/가입 + 카카오·네이버·구글 버튼)
import { useActionState, useState } from "react";
import {
  signInWithEmail,
  signInWithSocial,
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
      <form action={signInWithSocial} className="flex flex-col gap-2">
        <button
          type="submit"
          name="provider"
          value="kakao"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#FEE500] px-4 py-3 font-medium text-black/85 hover:brightness-95"
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.86 5.32 4.66 6.73l-.95 3.5c-.08.3.26.54.52.37l4.14-2.75c.53.06 1.07.1 1.63.1 5.52 0 10-3.58 10-8S17.52 3 12 3z"
            />
          </svg>
          카카오로 시작하기
        </button>
        <button
          type="submit"
          name="provider"
          value="naver"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#03C75A] px-4 py-3 font-medium text-white hover:brightness-95"
        >
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24">
            <path fill="currentColor" d="M16.27 12.84 7.46 0H0v24h7.73V11.16L16.54 24H24V0h-7.73z" />
          </svg>
          네이버로 시작하기
        </button>
        <button
          type="submit"
          name="provider"
          value="google"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-3 font-medium text-zinc-800 hover:bg-zinc-50"
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          구글로 시작하기
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-zinc-500">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        또는 이메일로
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
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
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
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
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
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
          className="rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "처리 중…" : mode === "signin" ? "이메일로 로그인" : "이메일로 가입"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="text-sm text-zinc-600 underline dark:text-zinc-400"
      >
        {mode === "signin" ? "계정이 없나요? 이메일로 가입" : "이미 계정이 있나요? 로그인"}
      </button>
    </div>
  );
}
