// 추천 상자 오른쪽의 순위 목록: 한 줄에 번호·위치·가격·점수와 담기만 둔다.
// 줄을 누르면 상세 창이 뜨고(나머지 정보는 창에서), 지도에서도 같은 핀을 강조한다.
import type { ListingCard } from "@/lib/search/listings";
import { meaningful, won } from "./listing-card";
import { RankLink } from "./rank-link";
import { SavedButton } from "./saved-button";

export function RankList({ items, offset, showScore }: { items: ListingCard[]; offset: number; showScore: boolean }) {
  return (
    <ol className="flex flex-col gap-2" aria-label="추천 순위">
      {items.map((card, index) => {
        const n = offset + index + 1;
        const floor = [card.floor, card.total_floors && `/${card.total_floors}`].filter(Boolean).join("");
        const pyeong = card.area_m2 === null ? null : Math.round(card.area_m2 / 3.3058);
        const href = `/listings/${card.id}${card.detail_token ? `?t=${card.detail_token}` : ""}`;
        const fee = card.maintenance_fee === null ? "관리비 안 적힘" : `관리비 ${won(card.maintenance_fee)}만`;
        const use = meaningful(card.recommended_use);
        return (
          <li key={card.id} className="card-in flex items-stretch gap-1 rounded-2xl border border-line bg-panel hover:border-accent" style={{ animationDelay: `${Math.min(index, 12) * 60 + 200}ms` }}>
            <RankLink href={href} listingId={card.id} className="flex min-w-0 flex-1 items-start gap-3 rounded-2xl p-3 text-left">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-medium">{n}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">
                  {card.gu} {card.dong}
                  {floor && <span className="font-normal text-muted"> · {floor}</span>}
                </span>
                {card.building_name && <span className="truncate text-xs text-muted">{card.building_name}</span>}
                <span className="whitespace-nowrap text-sm">
                  보증금 {card.deposit === null ? "-" : `${won(card.deposit)}만`} · 월세 {card.rent === null ? "-" : `${won(card.rent)}만`}
                </span>
                <span className="truncate text-xs text-faint">
                  {[pyeong !== null ? `${pyeong}평` : null, fee, use && `추천 ${use}`].filter(Boolean).join(" · ")}
                </span>
                {(card.is_new || card.price_changed || card.needs_check) && (
                  <span className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
                    {card.is_new && <span className="rounded bg-blue-50 px-1.5 text-blue-800 dark:bg-blue-950 dark:text-blue-200">신규</span>}
                    {card.price_changed && <span className="rounded bg-blue-50 px-1.5 text-blue-800 dark:bg-blue-950 dark:text-blue-200">가격 변경</span>}
                    {card.needs_check && <span className="rounded bg-amber-50 px-1.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">확인 필요</span>}
                  </span>
                )}
              </span>
              {showScore && (
                <span className="flex shrink-0 flex-col items-center">
                  <span className="text-sm font-medium">{card.score ?? <span className="text-[11px] font-normal text-muted">미확정</span>}</span>
                  <span className="text-[10px] text-faint">점수</span>
                </span>
              )}
            </RankLink>
            <div className="flex shrink-0 items-center pr-1.5">
              <SavedButton listingId={card.id} variant="icon" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
