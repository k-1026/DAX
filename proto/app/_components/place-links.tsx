"use client";
// 로드뷰(카카오맵)와 토지이음 바로가기. 신뢰 항목이라 무료·구독 모두 같다.
import { useState } from "react";

const EUM_URL = "https://www.eum.go.kr/";

export function PlaceLinks({
  lat,
  lng,
  gu,
  dong,
  building,
  size = "sm",
}: {
  lat?: number | null;
  lng?: number | null;
  gu: string;
  dong: string;
  building: string | null;
  size?: "sm" | "xs";
}) {
  const [copied, setCopied] = useState(false);
  const address = ["대구", gu, dong, building].filter(Boolean).join(" ");
  const text = size === "xs" ? "text-xs" : "text-sm";
  const hasPoint = typeof lat === "number" && typeof lng === "number";

  return (
    <div className="flex flex-wrap items-center gap-3">
      {hasPoint && (
        <a
          href={`https://map.kakao.com/link/roadview/${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${text} text-blue-700 hover:underline dark:text-blue-300`}
        >
          로드뷰
        </a>
      )}
      <button
        type="button"
        title="주소를 복사하고 토지이음을 열어요"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 6000);
          } catch {
            setCopied(false);
          }
          window.open(EUM_URL, "_blank", "noopener,noreferrer");
        }}
        className={`${text} text-blue-700 hover:underline dark:text-blue-300`}
      >
        토지이음
      </button>
      {copied && (
        <span role="status" className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          주소가 복사되었어요. 토지이음 검색창에 붙여 넣으세요.
        </span>
      )}
    </div>
  );
}

