"use client";

// 관리자 왼쪽 메뉴. 아직 만들지 않은 화면은 흐리게 두고 누를 수 없다.
import Link from "next/link";
import { usePathname } from "next/navigation";

export const ADMIN_MENU: { href: string; label: string; ready: boolean; note?: string }[] = [
  { href: "/admin", label: "개요", ready: true },
  { href: "/admin/listings", label: "매물 갱신", ready: true },
  { href: "/admin/agents", label: "에이전트 실행", ready: true },
  { href: "/admin/mail", label: "메일 발송", ready: true },
  { href: "/admin/ai", label: "AI 사용량", ready: true },
  { href: "/admin/quality", label: "품질·개선 제안", ready: true },
  { href: "/admin/weights", label: "가중치 보정안", ready: true },
  { href: "/admin/settings", label: "설정값", ready: true },
  { href: "/admin/users", label: "사용자 현황", ready: true },
  { href: "/admin/billing", label: "구독·결제", ready: false, note: "준비 중" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="관리자 메뉴" className="card flex gap-0.5 self-start overflow-x-auto p-2 lg:flex-col">
      {ADMIN_MENU.map((item) => {
        const on = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        const base = "whitespace-nowrap rounded-[10px] px-3 py-2 text-[0.8125rem]";
        if (!item.ready) {
          return (
            <span key={item.href} className={`${base} text-faint opacity-60`} aria-disabled="true">
              {item.label}
              {item.note ? ` (${item.note})` : ""}
            </span>
          );
        }
        return (
          <Link key={item.href} href={item.href} aria-current={on ? "page" : undefined} className={`${base} ${on ? "bg-soft font-medium text-ink" : "text-muted hover:bg-soft"}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
