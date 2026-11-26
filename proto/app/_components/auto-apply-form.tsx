"use client";
// 조건 상자 폼: 값을 바꾸면(슬라이더는 손을 뗄 때) 잠시 뒤 추천에 바로 반영한다. [추천 받기]를 눌러도 같다.
// 페이지를 새로 불러오지 않고 주소만 바꿔서 지도·순위·요약이 함께 바뀐다.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { queryFromForm } from "@/lib/search/query";

export const APPLY_EVENT = "dax:conditions-applying";

export function AutoApplyForm({ id, className, auto, children }: { id?: string; className?: string; auto: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();

  // 반영 중인지 조건 상자 머리에 알려 준다.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(APPLY_EVENT, { detail: pending }));
  }, [pending]);

  function apply() {
    if (!ref.current) return;
    const href = queryFromForm(ref.current);
    if (href === `${window.location.pathname}${window.location.search}` || (href === "/" && window.location.search === "")) return;
    startTransition(() => router.replace(href, { scroll: false }));
  }

  useEffect(() => {
    const form = ref.current;
    if (!form || !auto) return;
    // 'change'는 슬라이더를 놓을 때·체크를 바꿀 때·정렬을 고를 때 한 번 생긴다.
    const onChange = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(apply, 250);
    };
    form.addEventListener("change", onChange);
    return () => {
      form.removeEventListener("change", onChange);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply는 매번 최신 폼 값을 읽는다
  }, [auto]);

  return (
    <form
      ref={ref}
      id={id}
      action="/"
      method="get"
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      {children}
    </form>
  );
}
