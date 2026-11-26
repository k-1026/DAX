"use client";
// 순위 줄 링크: 누르면 상세 창(가로챈 경로)이 뜨고, 뒤의 지도에서 같은 핀을 강조한다.
import Link from "next/link";
import { FOCUS_EVENT } from "./map-focus-button";

export function RankLink({ href, listingId, className, children }: { href: string; listingId: string; className?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      onClick={() => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { id: listingId } }))}
      className={className}
    >
      {children}
    </Link>
  );
}
