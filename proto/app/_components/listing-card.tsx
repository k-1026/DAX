// 매물 카드: 번호·위치·점수 자리·가격 4칸·링크 줄·담기 아이콘
import { PlaceLinks } from "./place-links";
import Link from "next/link";
import type { ListingCard as Card } from "@/lib/search/listings";
import { MapFocusButton } from "./map-focus-button";
import { QuickRate } from "./quick-rate";
import { SavedButton } from "./saved-button";

const SOURCE_LABELS: Record<string, string> = { naver: "네이버 부동산" };

export function sourceLabel(source: string) {
  const key = Object.keys(SOURCE_LABELS).find((prefix) => source.startsWith(prefix));
  return key ? SOURCE_LABELS[key] : source;
}

// 네이버 원문에서 값을 고르지 않았을 때 들어오는 글자는 보여 주지 않는다.
const EMPTY_TEXT = /^\(?선택\)?\s*안함$|^-$|^없음$/;
export const meaningful = (value: string | null) => (value && !EMPTY_TEXT.test(value.trim()) ? value : null);

export const won = (value: number | null) => (value === null ? "-" : value.toLocaleString("ko-KR"));

export function date(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00+09:00` : value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });
}

function Badge({ tone, children }: { tone: "blue" | "amber" | "zinc"; children: React.ReactNode }) {
  const colors = {
    blue: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    amber: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${colors[tone]}`}>{children}</span>;
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

export function ListingCardView({ card, showScore, n, myRating = null, point = null }: { card: Card; showScore: boolean; n?: number; myRating?: "good" | "bad" | null; point?: { lat: number; lng: number } | null }) {
  const pyeong = card.area_m2 === null ? null : Math.round(card.area_m2 / 3.3058);
  const floor = [card.floor, card.total_floors && `/${card.total_floors}`].filter(Boolean).join("");
  const kind = card.subtype ?? card.property_type;
  const recommended = meaningful(card.recommended_use);
  const detailHref = `/listings/${card.id}${card.detail_token ? `?t=${card.detail_token}` : ""}`;
  const useText = [card.current_use && `현재 ${card.current_use}`, recommended && `추천 용도: ${recommended}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="flex flex-col gap-3 card p-4">
      <div className="flex items-start gap-3">
        {n !== undefined && (
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-medium dark:bg-zinc-800">
            {n}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-base font-medium">
            <Link href={detailHref} className="hover:underline">
              {card.gu} {card.dong}
              {floor && <span className="font-normal text-zinc-600 dark:text-zinc-400"> · {floor}</span>}
              {card.building_name && (
                <span className="font-normal text-zinc-600 dark:text-zinc-400"> · {card.building_name}</span>
              )}
            </Link>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {card.is_new && <Badge tone="blue">신규</Badge>}
            {card.price_changed && <Badge tone="blue">가격 변경</Badge>}
            {card.needs_check && <Badge tone="amber">확인 필요</Badge>}
            {kind && <Badge tone="zinc">{kind}</Badge>}
          </div>
          {useText && <p className="text-sm text-zinc-600 dark:text-zinc-400">{useText}</p>}
        </div>
        {showScore && (
          <div className="flex shrink-0 flex-col items-center gap-0.5">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-zinc-100 text-sm font-medium dark:bg-zinc-800">
              {card.score === null ? <span className="text-xs font-normal text-zinc-500">미확정</span> : card.score}
            </span>
            <span className="text-xs text-zinc-500">점수</span>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        <Cell label="넓이" value={card.area_m2 === null ? "-" : `${pyeong}평 (${card.area_m2}㎡)`} />
        <Cell label="보증금" value={card.deposit === null ? "-" : `${won(card.deposit)}만원`} />
        <Cell label="월세" value={card.rent === null ? "-" : `${won(card.rent)}만원`} />
        <Cell label="관리비" value={card.maintenance_fee === null ? "안 적힘" : `${won(card.maintenance_fee)}만원`} />
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
        <div className="flex items-center gap-4">
          <Link href={detailHref} className="text-sm text-blue-700 hover:underline dark:text-blue-300">
            상세 보기
          </Link>
          <MapFocusButton listingId={card.id} />
          <PlaceLinks lat={point?.lat} lng={point?.lng} gu={card.gu} dong={card.dong} building={card.building_name} />
        </div>
        <div className="flex items-center">
          <QuickRate listingId={card.id} initial={myRating} guest={!showScore} />
          <SavedButton listingId={card.id} variant="icon" />
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        출처: {sourceLabel(card.source)} · {date(card.checked_at)} 수집
        {card.confirmed_at && ` · 중개사 확인일 ${date(card.confirmed_at)}`}
      </p>
    </article>
  );
}
