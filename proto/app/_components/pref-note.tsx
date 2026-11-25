"use client";
// 조건 패널의 "내 선호 기록" 안내 (데모의 "내 선호가 반영되고 있어요"). 점수가 없어서 반영 점수는 말하지 않는다.
import { useEffect, useState } from "react";
import { myRatingCount } from "./quick-rate-actions";
import { useSaved } from "./saved-provider";

export function PrefNote() {
  const { state } = useSaved();
  const [ratings, setRatings] = useState<number | null>(null);
  const guest = state.tier === "guest";

  useEffect(() => {
    if (guest) return;
    let alive = true;
    myRatingCount().then((count) => alive && setRatings(count)).catch(() => alive && setRatings(null));
    return () => {
      alive = false;
    };
  }, [guest]);

  if (guest) return null;
  return (
    <div className="rounded-2xl bg-soft px-4 py-3">
      <p className="text-sm font-medium">내 선호 기록</p>
      <p className="mt-0.5 text-xs text-muted">
        평가 {ratings === null ? "—" : ratings}건 · 담기 {state.total}건. 점수에 반영하는 방식은 5단계에서 정해져요.
      </p>
    </div>
  );
}
