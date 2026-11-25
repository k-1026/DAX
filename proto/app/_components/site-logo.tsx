// 위쪽 바의 로고 (검은 원 핀 + DːON). 첫 화면과 다른 화면이 같은 모양을 쓴다.
import Link from "next/link";

export function SiteLogo() {
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="DːON 첫 화면">
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand text-brand-ink" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      </span>
      <span className="text-base font-medium">DːON</span>
    </Link>
  );
}
