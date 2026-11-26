"use client";
// 첫 화면 3단(조건 · 추천 · 스튜디오) 배치. 가운데(추천·지도)는 고정이고, 왼쪽·오른쪽 상자는
// 가장자리를 끌어서 늘이고 줄일 수 있고, 오른쪽 위 버튼으로 아예 접었다 펼 수 있다. (PC 폭에서만)
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Side = "left" | "right";
type Layout = { left: number; right: number; leftOff: boolean; rightOff: boolean };

const DEFAULT: Layout = { left: 320, right: 360, leftOff: false, rightOff: false };
const LIMITS: Record<Side, [number, number]> = { left: [240, 520], right: [280, 560] };
const CENTER_MIN = 440;
const GAP = 16;
const COLLAPSED = 48;
const KEY = "dax.panel-layout.v1";

type Ctx = { layout: Layout; setSide: (side: Side, width: number) => void; toggle: (side: Side) => void; reset: (side: Side) => void; grid: React.RefObject<HTMLDivElement | null> };
const LayoutContext = createContext<Ctx | null>(null);

export function PanelLayout({ children, withLeft = true }: { children: React.ReactNode; withLeft?: boolean }) {
  const [layout, setLayout] = useState<Layout>(DEFAULT);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
      if (saved && typeof saved === "object") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 배치를 처음 한 번만 불러온다
        setLayout({
          left: clamp("left", Number(saved.left) || DEFAULT.left),
          right: clamp("right", Number(saved.right) || DEFAULT.right),
          leftOff: Boolean(saved.leftOff),
          rightOff: Boolean(saved.rightOff),
        });
      }
    } catch {
      /* 저장소를 못 쓰면 이번 화면에서만 바뀌어요 */
    }
  }, []);

  const save = useCallback((next: Layout) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 무시 */
    }
  }, []);

  const setSide = useCallback(
    (side: Side, width: number) => {
      setLayout((current) => {
        const total = grid.current?.clientWidth ?? 1400;
        const other = side === "left" ? (current.rightOff ? COLLAPSED : current.right) : withLeft ? (current.leftOff ? COLLAPSED : current.left) : 0;
        const room = total - other - CENTER_MIN - GAP * 2;
        const next = { ...current, [side]: Math.round(Math.max(LIMITS[side][0], Math.min(LIMITS[side][1], room, width))) };
        save(next);
        return next;
      });
    },
    [save, withLeft],
  );
  const toggle = useCallback(
    (side: Side) => {
      setLayout((current) => {
        const key = side === "left" ? "leftOff" : "rightOff";
        const next = { ...current, [key]: !current[key] };
        save(next);
        return next;
      });
    },
    [save],
  );
  const reset = useCallback(
    (side: Side) => {
      setLayout((current) => {
        const next = { ...current, [side]: DEFAULT[side] };
        save(next);
        return next;
      });
    },
    [save],
  );

  const left = layout.leftOff ? COLLAPSED : layout.left;
  const right = layout.rightOff ? COLLAPSED : layout.right;
  return (
    <LayoutContext value={{ layout, setSide, toggle, reset, grid }}>
      <div
        ref={grid}
        className="grid min-h-0 min-w-0 gap-4 lg:h-full lg:[grid-template-columns:var(--cols)]"
        style={{ ["--cols" as string]: withLeft ? `${left}px minmax(0,1fr) ${right}px` : `minmax(0,1fr) ${right}px` }}
      >
        {children}
      </div>
    </LayoutContext>
  );
}

function clamp(side: Side, width: number) {
  return Math.max(LIMITS[side][0], Math.min(LIMITS[side][1], width));
}

// 한 칸: 왼쪽·오른쪽은 끌기 손잡이와 접기 버튼이 붙고, 가운데는 그대로 둔다.
export function Slot({ side, label, children, mobileHidden = false }: { side: Side | "center"; label?: string; children: React.ReactNode; mobileHidden?: boolean }) {
  const context = useContext(LayoutContext);
  const dragging = useRef(false);
  const [active, setActive] = useState(false);

  const start = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!context || side === "center") return;
      event.preventDefault();
      dragging.current = true;
      setActive(true);
      const startX = event.clientX;
      const startWidth = side === "left" ? context.layout.left : context.layout.right;
      const move = (e: PointerEvent) => {
        if (!dragging.current) return;
        // 왼쪽 상자는 오른쪽으로 끌면 넓어지고, 오른쪽 상자는 왼쪽으로 끌면 넓어진다.
        context.setSide(side, startWidth + (side === "left" ? e.clientX - startX : startX - e.clientX));
      };
      const stop = () => {
        dragging.current = false;
        setActive(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    },
    [context, side],
  );

  if (side === "center" || !context) {
    return <div className={`min-h-0 min-w-0 grid ${mobileHidden ? "hidden lg:grid" : ""}`}>{children}</div>;
  }
  const off = side === "left" ? context.layout.leftOff : context.layout.rightOff;
  const width = side === "left" ? context.layout.left : context.layout.right;
  const name = label ?? (side === "left" ? "조건" : "스튜디오");

  return (
    <div className={`relative min-h-0 min-w-0 ${mobileHidden ? "hidden lg:grid" : "grid"}`}>
      {/* 접힌 상태: 좁은 띠 (PC 폭에서만) */}
      {off && (
        <div className="hidden min-h-0 flex-col items-center gap-3 rounded-3xl border border-line bg-panel py-4 lg:flex">
          <button type="button" onClick={() => context.toggle(side)} aria-expanded={false} aria-label={`${name} 상자 펼치기`} className="inline-flex size-8 items-center justify-center rounded-full border border-line hover:bg-soft">
            <Chevron dir={side === "left" ? "right" : "left"} />
          </button>
          <span className="text-xs text-muted [writing-mode:vertical-rl]">{name}</span>
        </div>
      )}
      {/* 펼친 상태 (접혀도 안 지워서 입력한 내용이 남는다) */}
      <div className={`${off ? "lg:hidden" : ""} grid min-h-0 min-w-0`}>{children}</div>
      {!off && (
        <>
          <button
            type="button"
            onClick={() => context.toggle(side)}
            aria-expanded={true}
            aria-label={`${name} 상자 접기`}
            title={`${name} 접기`}
            className="absolute right-3 top-3 z-10 hidden size-8 items-center justify-center rounded-full text-muted hover:bg-soft lg:inline-flex"
          >
            <Chevron dir={side === "left" ? "left" : "right"} />
          </button>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`${name} 상자 너비 조절`}
            aria-valuenow={width}
            aria-valuemin={LIMITS[side][0]}
            aria-valuemax={LIMITS[side][1]}
            tabIndex={0}
            onPointerDown={start}
            onDoubleClick={() => context.reset(side)}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 40 : 16;
              const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
              const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
              if (event.key === grow) context.setSide(side, width + step);
              else if (event.key === shrink) context.setSide(side, width - step);
              else if (event.key === "Enter") context.reset(side);
              else return;
              event.preventDefault();
            }}
            title="끌어서 너비 조절 · 두 번 누르면 처음 크기"
            className={`absolute inset-y-0 z-20 hidden w-4 cursor-col-resize items-center justify-center lg:flex ${side === "left" ? "-right-4" : "-left-4"} group touch-none outline-none`}
          >
            <span className={`h-14 w-1 rounded-full transition-colors ${active ? "bg-accent" : "bg-line group-hover:bg-faint group-focus-visible:bg-accent"}`} />
          </div>
        </>
      )}
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}
