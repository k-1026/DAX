"use client";
// 로드뷰(카카오맵)와 토지이음 바로가기. 신뢰 항목이라 무료·구독 모두 같다.
// variant="buttons": 상세 창의 행동 버튼 줄(아이콘 + 글자, 테두리 버튼)
import { useState } from "react";
import { ACTION_BUTTON } from "./action-styles";
import { loadKakao } from "./listing-map";
import { findParcel } from "@/lib/map/pnu";

const EUM_URL = "https://www.eum.go.kr/";

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const CAMERA = "M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";
const MAP = "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z M9 4v14 M15 6v14";

export function PlaceLinks({
  lat,
  lng,
  gu,
  dong,
  building,
  variant = "links",
}: {
  lat?: number | null;
  lng?: number | null;
  gu: string;
  dong: string;
  building: string | null;
  variant?: "links" | "buttons";
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const address = ["대구", gu, dong, building].filter(Boolean).join(" ");
  const hasPoint = typeof lat === "number" && typeof lng === "number";
  const buttons = variant === "buttons";
  const cls = buttons ? ACTION_BUTTON : "text-sm text-blue-700 hover:underline dark:text-blue-300";

  function show(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(null), 7000);
  }

  // 좌표로 지번을 찾아 토지이음 "토지이용계획 열람" 화면을 바로 연다. 못 찾으면 주소를 복사하고 첫 화면을 연다.
  async function openEum() {
    // 팝업 차단을 피하려고 누르는 순간 빈 창을 먼저 연다.
    const win = window.open("about:blank", "_blank");
    const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
    let parcel = null;
    if (hasPoint && key) {
      try {
        parcel = await findParcel(await loadKakao(key), lat as number, lng as number);
      } catch {
        parcel = null;
      }
    }
    if (parcel) {
      if (win) { win.opener = null; win.location.href = parcel.url; } else window.open(parcel.url, "_blank", "noopener,noreferrer");
      show(`${parcel.jibun} 토지이용계획을 열었어요. 매물 위치(좌표) 기준이라 실제 지번과 다를 수 있어요.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      /* 복사를 못 해도 첫 화면은 연다 */
    }
    if (win) { win.opener = null; win.location.href = EUM_URL; } else window.open(EUM_URL, "_blank", "noopener,noreferrer");
    show("지번을 찾지 못해 토지이음 첫 화면을 열었어요. 주소가 복사됐으니 검색창에 붙여 넣으세요.");
  }

  return (
    <>
      {hasPoint && (
        <a href={`https://map.kakao.com/link/roadview/${lat},${lng}`} target="_blank" rel="noopener noreferrer" className={cls} title="카카오맵 로드뷰가 새 창으로 열려요">
          {buttons && <Icon d={CAMERA} />}
          로드뷰
        </a>
      )}
      <button type="button" title="이 매물 땅의 토지이용계획(토지이음)을 새 창으로 열어요" onClick={openEum} className={cls}>
        {buttons && <Icon d={MAP} />}
        토지이음
      </button>
      {notice && (
        <span role="status" className="basis-full rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {notice}
        </span>
      )}
    </>
  );
}
