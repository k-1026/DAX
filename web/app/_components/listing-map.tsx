"use client";
// 추천 매물 지도: 순위 번호 핀을 대구 지도 위에 찍는다 (Leaflet + 브이월드 배경지도, 이전 데모와 같은 방식)
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import { scoreLabel, toPyeong, won, type Item } from "@/lib/listings";

const DAEGU: [number, number] = [35.8562, 128.5995];
// 매물 이름은 외부에서 모은 글이라 지도 말풍선(HTML)에 넣기 전에 꼭 바꿔 준다
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function ListingMap({
  listings,
  revealed,
  focusId,
  scoring,
  onSelect,
}: {
  listings: Item[]; // 순위순
  revealed: number; // 지금까지 보여 준 개수 (하나씩 핀이 떨어지는 연출)
  focusId: string | null;
  scoring: boolean;
  onSelect: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const markers = useRef<Map<string, Leaflet.Marker>>(new Map());
  const selectRef = useRef(onSelect);

  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  // 지도 만들기 (leaflet은 브라우저에서만 불러올 수 있다)
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet);
      if (cancelled || !box.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(box.current, { zoomControl: false, scrollWheelZoom: false, attributionControl: true }).setView(DAEGU, 11);
      L.control.zoom({ position: "topright" }).addTo(map);
      const vworld = L.tileLayer("https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "배경지도 © 국토교통부 브이월드",
      }).addTo(map);
      let ok = 0;
      let err = 0;
      vworld.on("tileload", () => ok++);
      vworld.on("tileerror", () => {
        // 브이월드가 안 열리면 오픈스트리트맵으로 바꾼다
        if (++err >= 4 && ok === 0) {
          map.removeLayer(vworld);
          L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "© OpenStreetMap",
          }).addTo(map);
        }
      });
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 50);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // 핀: 새 추천이 오면 지우고 화면을 미리 맞춘 뒤, revealed가 늘 때마다 하나씩 추가한다.
  // (확대 애니메이션 도중에 핀을 넣으면 위치가 틀어져서 애니메이션 없이 맞춘다)
  const runKey = listings.map((l) => l.id + ":" + l.score).join(",");
  const added = useRef<string>("");
  const shownRef = useRef(0); // 지금까지 처리한 순위 수 (좌표 없는 매물 포함)
  useEffect(() => {
    const L = LRef.current;
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map) return;
    if (added.current !== runKey || revealed < shownRef.current) {
      layer.clearLayers();
      markers.current.clear();
      shownRef.current = 0;
      added.current = runKey;
      const pts = listings.filter((l) => l.lat != null && l.lng != null).map((l) => [l.lat, l.lng] as [number, number]);
      if (pts.length > 1) {
        map.fitBounds(L.latLngBounds(pts), {
          padding: [40, 40],
          maxZoom: 14,
          animate: false,
        });
      } else if (pts.length === 1) {
        map.setView(pts[0], 14, { animate: false });
      }
    }
    listings.slice(shownRef.current, revealed).forEach((l, k) => {
      const rank = shownRef.current + k + 1;
      if (l.lat == null || l.lng == null) return;
      const t = scoreLabel(l.score)[1];
      const tone = t === "a" ? "#188038" : t === "b" ? "#0b57d0" : t === "c" ? "#5f6368" : "#b06000";
      const icon = L.divIcon({
        className: "",
        iconSize: [30, 38],
        iconAnchor: [15, 36],
        html: `<div class="map-pin" style="--pin:${tone}"><span>${rank}</span></div>`,
      });
      const m = L.marker([l.lat, l.lng], { icon, zIndexOffset: 1000 - rank, title: `${rank}위 ${l.title}` }).addTo(layer);
      m.bindPopup(
        `<b>${rank}위 · ${esc(l.bldg || l.title)}</b><br/>${esc(l.title)}<br/>점수 ${l.score} · ${toPyeong(l.areaM2)}평 · 보증금 ${won(l.deposit)} / 월 ${won(l.rent)}`,
        { closeButton: false },
      );
      m.on("click", () => selectRef.current(l.id));
      markers.current.set(l.id, m);
    });
    shownRef.current = Math.max(shownRef.current, Math.min(revealed, listings.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listings 내용은 runKey로 비교한다
  }, [runKey, revealed]);

  // 스코어링을 다시 시작하면 대구 전체로
  useEffect(() => {
    if (scoring) mapRef.current?.setView(DAEGU, 11, { animate: false });
  }, [scoring]);

  // 카드에서 고른 매물로 이동
  useEffect(() => {
    if (!focusId) return;
    const m = markers.current.get(focusId);
    if (m && mapRef.current) {
      mapRef.current.flyTo(m.getLatLng(), 15, { duration: 0.5 });
      m.openPopup();
    }
  }, [focusId]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line">
      <div ref={box} className="h-[280px] w-full bg-soft" role="region" aria-label="추천 매물 지도" />
      {scoring && (
        <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center bg-panel/50 backdrop-blur-[1px]">
          <span className="flex items-center gap-2 rounded-full bg-panel px-4 py-2 text-sm shadow">
            <span className="size-2 animate-ping rounded-full bg-accent" /> 지도에 표시할 매물 고르는 중…
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 z-[500] flex gap-2 rounded-full bg-panel/90 px-3 py-1 text-[11px] text-muted shadow-sm">
        <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-[#188038]" />아주 좋음 80+</span>
        <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-[#0b57d0]" />좋음 70+</span>
        <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-[#5f6368]" />보통 60+</span>
      </div>
    </div>
  );
}
