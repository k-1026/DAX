"use client";
// 스튜디오 타일 6개 (발표 데모 모양). 점수·새 기능에 달린 타일은 "미확정" 자리만 둔다.
import Link from "next/link";

const icons: Record<string, string> = {
  report: "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6",
  table: "M3 5h18v14H3z M3 10h18 M9 5v14",
  calc: "M6 3h12v18H6z M9 7h6 M9 12h.01 M12 12h.01 M15 12h.01 M9 16h.01 M12 16h.01 M15 16h.01",
  list: "M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01",
  mail: "M3 6h18v12H3z M3 7l9 7 9-7",
  star: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
};

function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={icons[name]} />
    </svg>
  );
}

const base = "relative flex min-h-[88px] flex-col items-start gap-1 rounded-2xl p-4 text-left";

function Body({ icon, title, desc, badge }: { icon: keyof typeof icons; title: string; desc: string; badge?: React.ReactNode }) {
  return (
    <>
      <Icon name={icon} />
      <span className="mt-1 text-sm font-medium">{title}</span>
      <span className="text-xs text-muted">{desc}</span>
      {badge}
    </>
  );
}

const pill = "absolute right-3 top-3 rounded-full bg-panel/70 px-2 py-0.5 text-[10px] text-muted";

export function StudioTiles({
  guest,
  count,
  onCompare,
  rateOpen,
  onToggleRate,
  onOpen,
}: {
  guest: boolean;
  count: number;
  onCompare: () => void;
  rateOpen: boolean;
  onToggleRate: () => void;
  onOpen: (view: "simulator" | "checklist" | "mail") => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div aria-disabled="true" className={`${base} bg-tile-blue`}>
        <Body icon="report" title="상권 리포트" desc="1위 매물 주변 상권 요약" badge={<span className={pill}>미확정</span>} />
      </div>
      {guest ? (
        <Link href="/login" className={`${base} bg-tile-green`}>
          <Body icon="table" title="매물 비교표" desc="로그인하면 나란히 비교해요" />
        </Link>
      ) : (
        <button type="button" onClick={onCompare} className={`${base} bg-tile-green`}>
          <Body icon="table" title="매물 비교표" desc="담은 매물 나란히 보기" badge={count > 0 ? <span className={`${pill} font-medium text-ink`}>{count}</span> : undefined} />
        </button>
      )}
      <button type="button" onClick={() => onOpen("simulator")} className={`${base} bg-tile-yellow`}>
        <Body icon="calc" title="임대료 시뮬레이터" desc="예상 매출 대비 임대료 비율" />
      </button>
      <button type="button" onClick={() => onOpen("checklist")} className={`${base} bg-tile-teal`}>
        <Body icon="list" title="현장 체크리스트" desc="방문 전 확인할 것" />
      </button>
      {guest ? (
        <Link href="/login" className={`${base} bg-tile-pink`}>
          <Body icon="mail" title="추천 메일 받기" desc="로그인하면 새 매물을 알려드려요" />
        </Link>
      ) : (
        <button type="button" onClick={() => onOpen("mail")} className={`${base} bg-tile-pink`}>
          <Body icon="mail" title="추천 메일 받기" desc="내 선호 조건으로 새 매물 알림" />
        </button>
      )}
      {guest ? (
        <Link href="/login" className={`${base} bg-tile-purple`}>
          <Body icon="star" title="평가 남기기" desc="로그인하고 추천 정확도를 높여 주세요" />
        </Link>
      ) : (
        <button type="button" aria-pressed={rateOpen} onClick={onToggleRate} className={`${base} bg-tile-purple ${rateOpen ? "ring-2 ring-accent" : ""}`}>
          <Body icon="star" title="평가 남기기" desc="추천 정확도를 높여 주세요" />
        </button>
      )}
    </div>
  );
}
