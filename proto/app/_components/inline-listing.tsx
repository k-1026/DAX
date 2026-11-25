"use client";
// 질문 칩 답변 아래에 펼쳐지는 매물 카드. 집계에 있는 값(동네·층·가격·면적)만 보여 준다.
import Link from "next/link";
import { useEffect, useState } from "react";
import { SQM_PER_PYEONG } from "@/lib/search/ranges";
import { QuickRate } from "./quick-rate";
import { myRatingsFor } from "./quick-rate-actions";
import { SavedButton } from "./saved-button";

export type InlineListingData = {
  id: string;
  gu: string | null;
  dong: string | null;
  floor: string | null;
  rent: number | null;
  monthly: number | null;
  deposit: number | null;
  area: number | null;
};

const won = (value: number | null) => (value === null ? "-" : `${Math.round(value).toLocaleString("ko-KR")}만원`);

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

export function InlineListing({ listing, guest }: { listing: InlineListingData; guest: boolean }) {
  const [rating, setRating] = useState<"good" | "bad" | null | undefined>(guest ? null : undefined);

  // 내가 이미 남긴 평가가 있으면 아이콘에 표시한다.
  useEffect(() => {
    if (guest) return;
    let alive = true;
    myRatingsFor([listing.id]).then((map) => alive && setRating(map[listing.id] ?? null)).catch(() => alive && setRating(null));
    return () => {
      alive = false;
    };
  }, [guest, listing.id]);

  const title = [listing.gu, listing.dong, listing.floor].filter(Boolean).join(" ");
  return (
    <article className="mt-2 flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
      <h4 className="text-sm font-medium">{title}</h4>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        <Cell label="넓이" value={listing.area === null ? "-" : `${Math.round(listing.area / SQM_PER_PYEONG)}평 (${listing.area}㎡)`} />
        <Cell label="보증금" value={won(listing.deposit)} />
        <Cell label="월세" value={won(listing.rent)} />
        <Cell label="월세+관리비" value={won(listing.monthly)} />
      </dl>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
        <Link href={`/listings/${listing.id}`} className="text-xs text-accent underline">
          매물 상세 페이지 열기
        </Link>
        <div className="flex items-center">
          {rating !== undefined && <QuickRate key={`${listing.id}-${rating ?? "none"}`} listingId={listing.id} initial={rating} guest={guest} />}
          <SavedButton listingId={listing.id} variant="icon" />
        </div>
      </div>
    </article>
  );
}
