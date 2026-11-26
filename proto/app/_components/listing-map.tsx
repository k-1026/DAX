"use client";
// 6-C 지도: 검색 결과 한 쪽을 목록 번호와 같은 번호 핀으로 보여 준다(카카오맵).
// 점수가 연결되기 전까지 핀은 한 가지 색, 색 설명은 숨긴다.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FOCUS_EVENT } from "./map-focus-button";
import { SavedButton } from "./saved-button";

export type MapPin = {
  n: number;
  id: string;
  /** 비로그인은 상세 열람 표시가 붙은 주소 */
  href: string;
  lat: number;
  lng: number;
  title: string;
  price: string;
  info: string;
  freshness: string;
  stale: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    kakao?: any;
  }
}

let loader: Promise<any> | null = null;

export function loadKakao(key: string) {
  if (window.kakao?.maps?.LatLng) return Promise.resolve(window.kakao);
  loader ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
    script.onerror = () => {
      loader = null;
      reject(new Error("kakao_load_failed"));
    };
    document.head.appendChild(script);
  });
  return loader;
}

const PIN_CLASS =
  "flex h-7 min-w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-blue-700 px-1 text-xs font-medium text-white shadow";

export function ListingMap({ pins, missing, fill = false }: { pins: MapPin[]; missing: number; fill?: boolean }) {
  const listWord = fill ? "오른쪽 목록" : "아래 목록";
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<MapPin | null>(null);
  const mapRef = useRef<any>(null);
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

  useEffect(() => {
    if (!key || !box.current || pins.length === 0) return;
    let overlays: any[] = [];
    let observer: ResizeObserver | null = null;
    let cancelled = false;

    loadKakao(key)
      .then((kakao) => {
        if (cancelled || !box.current) return;
        box.current.innerHTML = "";
        const map = new kakao.maps.Map(box.current, {
          center: new kakao.maps.LatLng(pins[0].lat, pins[0].lng),
          level: 6,
        });
        mapRef.current = map;
        map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        const bounds = new kakao.maps.LatLngBounds();

        overlays = pins.map((pin) => {
          const position = new kakao.maps.LatLng(pin.lat, pin.lng);
          bounds.extend(position);
          const el = document.createElement("button");
          el.type = "button";
          el.className = PIN_CLASS;
          el.textContent = String(pin.n);
          el.setAttribute("aria-label", `${pin.n}번 ${pin.title}`);
          el.addEventListener("click", () => setSelected(pin));
          const overlay = new kakao.maps.CustomOverlay({ position, content: el, yAnchor: 0.5, zIndex: 100 - pin.n });
          overlay.setMap(map);
          return overlay;
        });

        // 화면 폭이 바뀌면(휴대폰 회전, 창 크기 조절) 지도를 다시 그리고 핀이 모두 보이게 맞춘다.
        const fit = () => {
          map.relayout();
          if (pins.length > 1) map.setBounds(bounds, 40, 40, 40, 40);
          else map.setCenter(bounds.getSouthWest());
        };
        fit();
        let timer: ReturnType<typeof setTimeout> | undefined;
        observer = new ResizeObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(fit, 150);
        });
        observer.observe(box.current);
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      observer?.disconnect();
      overlays.forEach((overlay) => overlay.setMap(null));
    };
  }, [key, pins]);

  // 카드의 [지도] 버튼: 해당 핀을 선택하고 지도 중심을 옮긴다.
  useEffect(() => {
    const onFocus = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      const pin = pins.find((item) => item.id === id);
      if (!pin) return;
      setSelected(pin);
      const kakao = window.kakao;
      if (kakao && mapRef.current) mapRef.current.panTo(new kakao.maps.LatLng(pin.lat, pin.lng));
    };
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, [pins]);

  return (
    <section aria-label="지도" className={`flex flex-col gap-2 ${fill ? "h-full min-h-0" : ""}`}>
      <div className={`relative overflow-hidden card bg-zinc-50 dark:bg-zinc-900 ${fill ? "h-80 lg:h-auto lg:min-h-0 lg:flex-1" : "h-80 lg:h-96"}`}>
        {!key || failed ? (
          <p className="p-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            지도를 불러오지 못했습니다. {listWord}에서 매물을 볼 수 있어요.
          </p>
        ) : pins.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            이 쪽 매물은 위치 정보가 없어 지도에 표시할 수 없어요. {listWord}에서 볼 수 있어요.
          </p>
        ) : (
          <div ref={box} className="h-full w-full" />
        )}

        {selected && (
          <div className="absolute bottom-3 left-3 z-10 w-64 rounded-xl border border-zinc-300 bg-white p-3 text-sm shadow-md dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">
                <span className="mr-1 text-blue-700 dark:text-blue-300">{selected.n}</span>
                {selected.title}
              </p>
              <button type="button" aria-label="닫기" onClick={() => setSelected(null)} className="text-zinc-500">
                ✕
              </button>
            </div>
            <p className="mt-1">{selected.price}</p>
            <p className="text-zinc-600 dark:text-zinc-400">{selected.info}</p>
            <p className={`mt-1 text-xs ${selected.stale ? "text-amber-700 dark:text-amber-300" : "text-zinc-500"}`}>
              {selected.freshness}
            </p>
            <Link
              href={selected.href}
              className="mt-2 block rounded-lg bg-zinc-900 py-1.5 text-center text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              자세히 보기
            </Link>
            <div className="mt-2"><SavedButton listingId={selected.id} /></div>
          </div>
        )}
      </div>
      {missing > 0 && pins.length > 0 && (
        <p className="text-xs text-zinc-500">
          이 쪽 매물 중 {missing}곳은 위치 정보가 없어 지도에서 빠졌어요. {listWord}에서 볼 수 있어요.
        </p>
      )}
    </section>
  );
}
