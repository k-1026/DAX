"use client";
// 동의 화면의 입력 양식. 어떤 항목도 미리 체크하지 않는다.
import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { saveConsents, type ConsentState } from "./actions";

function ConsentItem({
  name,
  badge,
  checked,
  onChange,
  children,
}: {
  name: string;
  badge: "필수" | "선택";
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-left text-sm">
      <input
        id={name}
        name={name}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4"
      />
      <label htmlFor={name}>
        <span
          className={
            badge === "필수"
              ? "mr-1 font-medium text-red-700 dark:text-red-400"
              : "mr-1 font-medium text-zinc-600 dark:text-zinc-400"
          }
        >
          [{badge}]
        </span>
        {children}
      </label>
    </div>
  );
}

function DocumentLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} target="_blank" rel="noopener" className="ml-1 underline">
      {label} 보기
    </Link>
  );
}

export function ConsentForm({
  next,
  defaultEmail,
}: {
  next: string;
  defaultEmail: string;
}) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(
    saveConsents,
    {},
  );
  const [age14, setAge14] = useState(false);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [behavior, setBehavior] = useState(false);
  const [email, setEmail] = useState(false);
  const requiredDone = age14 && terms && privacy;

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <ConsentItem name="age14" badge="필수" checked={age14} onChange={setAge14}>
          만 14세 이상입니다.
        </ConsentItem>
        <ConsentItem name="terms" badge="필수" checked={terms} onChange={setTerms}>
          이용약관에 동의합니다.
          <DocumentLink href="/terms" label="이용약관" />
        </ConsentItem>
        <ConsentItem name="privacy" badge="필수" checked={privacy} onChange={setPrivacy}>
          개인정보 수집·이용과 국외 이전에 동의합니다.
          <DocumentLink href="/privacy" label="처리방침" />
        </ConsentItem>

        <hr className="border-zinc-200 dark:border-zinc-800" />

        <ConsentItem
          name="behavior_tracking"
          badge="선택"
          checked={behavior}
          onChange={setBehavior}
        >
          서비스 개선을 위해 검색 조건과 정렬 방식을 기록하는 데 동의합니다.
        </ConsentItem>
        <ConsentItem name="email" badge="선택" checked={email} onChange={setEmail}>
          조건에 맞는 매물 추천 메일을 받는 데 동의합니다.
        </ConsentItem>

        {email && (
          <label className="flex flex-col gap-1 text-left text-sm">
            메일을 받을 주소
            <input
              name="contactEmail"
              type="email"
              required
              defaultValue={defaultEmail}
              autoComplete="email"
              className="rounded-xl border border-line bg-transparent px-3 py-2"
            />
          </label>
        )}

        <p className="text-left text-xs text-zinc-600 dark:text-zinc-400">
          선택 항목은 동의하지 않아도 서비스를 이용할 수 있으며, 나중에 철회할 수 있습니다.
        </p>

        {state.error && (
          <p role="alert" className="text-left text-sm text-red-600">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={!requiredDone || pending}
          className="rounded-full bg-brand px-4 py-3 font-medium text-brand-ink disabled:opacity-50"
        >
          {pending ? "저장 중…" : "동의하고 시작하기"}
        </button>
      </form>

      <form action={signOut}>
        <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          동의하지 않고 로그아웃
        </button>
      </form>
    </div>
  );
}
