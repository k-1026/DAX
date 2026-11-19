// 여러 화면에서 같이 쓰는 작은 부품: 아이콘, 패널 틀, 상단 바
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import type { Viewer } from "@/lib/viewer";

const PATHS: Record<string, string> = {
  spark: "M12 2l2.2 6.3L20 10.5l-5.8 2.2L12 19l-2.2-6.3L4 10.5l5.8-2.2z",
  tune: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
  panel: "M3 4h18v16H3zM9 4v16",
  send: "M3 20.5V3.5L22 12 3 20.5zM5 17.4L16.9 12 5 6.6v4.1l6 1.3-6 1.3v4.1z",
  lock: "M6 10V8a6 6 0 1112 0v2h1v12H5V10h1zm2 0h8V8a4 4 0 10-8 0v2z",
  up: "M2 20h2.5V9H2v11zm20-10c0-1.1-.9-2-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1 6.6 7.6c-.4.4-.6.9-.6 1.4V18c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7v-1z",
  down: "M22 4h-2.5v11H22V4zM2 14c0 1.1.9 2 2 2h6.3l-1 4.6v.3c0 .4.2.8.4 1.1l1.1 1L17.4 16.4c.4-.4.6-.9.6-1.4V6c0-1.1-.9-2-2-2H7c-.8 0-1.5.5-1.8 1.2l-3 7.1c-.1.2-.2.5-.2.7v1z",
  bookmark: "M6 3h12v18l-6-4-6 4V3zm2 2v12.3l4-2.7 4 2.7V5H8z",
  bookmarkFill: "M6 3h12v18l-6-4-6 4V3z",
  back: "M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2z",
  close: "M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z",
  report: "M5 3h10l4 4v14H5V3zm2 2v14h10V8h-3V5H7zm2 6h6v2H9v-2zm0 4h6v2H9v-2z",
  table: "M3 4h18v16H3V4zm2 2v3h14V6H5zm0 5v3h6v-3H5zm8 0v3h6v-3h-6zm-8 5v2h6v-2H5zm8 0v2h6v-2h-6z",
  calc: "M6 2h12a2 2 0 012 2v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm0 2v4h12V4H6zm1 7v2h2v-2H7zm4 0v2h2v-2h-2zm4 0v6h2v-6h-2zm-8 4v2h2v-2H7zm4 0v2h2v-2h-2z",
  check: "M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z",
  list: "M4 6h2v2H4V6zm4 0h12v2H8V6zm-4 5h2v2H4v-2zm4 0h12v2H8v-2zm-4 5h2v2H4v-2zm4 0h12v2H8v-2z",
  mail: "M3 5h18v14H3V5zm2 2v.5l7 4.5 7-4.5V7H5zm14 2.8l-7 4.5-7-4.5V17h14V9.8z",
  star: "M12 17.3l6.2 3.7-1.6-7 5.4-4.7-7.1-.6L12 2 9.1 8.7 2 9.3l5.4 4.7-1.6 7z",
  pin: "M12 2a7 7 0 00-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z",
  monitor: "M3 4h18v12H3V4zm2 2v8h14V6H5zm3 12h8v2H8v-2zm1-6l2-3 2 2 2-3 1 1-3 4-2-2-1 1.5L9 12z",
  share: "M18 16a3 3 0 00-2.4 1.2l-6.7-3.4a3 3 0 000-1.6l6.7-3.4A3 3 0 1015 7c0 .3 0 .5.1.8L8.4 11.2a3 3 0 100 3.6l6.7 3.4A3 3 0 1018 16z",
  refresh: "M17.6 6.4A8 8 0 104 12h2a6 6 0 111.8 4.2L10 14H4v6l2.4-2.4A8 8 0 1017.6 6.4z",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3 0-8 1.5-8 4.5V20h16v-1.5c0-3-5-4.5-8-4.5z",
  chevron: "M8.6 16.6L13.2 12 8.6 7.4 10 6l6 6-6 6z",
  agent: "M12 2a2 2 0 012 2c0 .7-.4 1.4-1 1.7V7h5a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3v-8a3 3 0 013-3h5V5.7A2 2 0 0112 2zM9 12a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z",
  database: "M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3zm6 9.7c-1.5.8-3.6 1.3-6 1.3s-4.5-.5-6-1.3V15c.4.6 2.6 1.6 6 1.6s5.6-1 6-1.6v-2.3zm0-4.7c-1.5.8-3.6 1.3-6 1.3S7.5 8.8 6 8v2.3c.4.6 2.6 1.6 6 1.6s5.6-1 6-1.6V8z",
};

export function Icon({ name, size = 20, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" className={`shrink-0 ${className}`}>
      <path fill="currentColor" d={PATHS[name] ?? PATHS.spark} />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-full bg-brand text-brand-ink">
        <Icon name="pin" size={18} />
      </span>
      <span className="hidden text-[15px] font-medium sm:block">대구 공실 매칭</span>
    </Link>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel ${className}`}>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function TopBar({ viewer, title, children }: { viewer: Viewer; title?: string; children?: ReactNode }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 px-4 sm:px-6">
      <Logo />
      {title && <span className="hidden truncate text-[18px] text-ink md:block md:pl-3">{title}</span>}
      <div className="ml-auto flex items-center gap-2">
        {children}
        {viewer.previewNote && (
          <span className="hidden rounded-full bg-warn-soft px-3 py-1 text-xs text-warn lg:block">
            {viewer.previewNote}
          </span>
        )}
        {viewer.isAdmin && (
          <Link
            href="/admin"
            className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 py-2 text-sm hover:bg-soft"
          >
            <Icon name="monitor" size={18} />
            <span className="hidden sm:inline">시스템 모니터링</span>
          </Link>
        )}
        {viewer.loggedIn ? (
          <div className="flex items-center gap-2">
            <span
              title={viewer.email ?? viewer.name}
              className="grid size-9 place-items-center rounded-full bg-tile-purple text-sm font-medium"
            >
              {viewer.name.slice(0, 1)}
            </span>
            {!viewer.previewNote && (
              <form action={signOut}>
                <button type="submit" className="text-sm text-muted hover:text-ink">
                  로그아웃
                </button>
              </form>
            )}
          </div>
        ) : (
          <Link href="/login" className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
            로그인
          </Link>
        )}
      </div>
    </header>
  );
}
