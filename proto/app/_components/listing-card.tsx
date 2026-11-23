// 매물 카드: 위치·가격·면적·상태 표시·출처
import Link from "next/link";
import type { ListingCard as Card } from "@/lib/search/listings";

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

export function ListingCardView({ card, showScore }: { card: Card; showScore: boolean }) {
  const pyeong = card.area_m2 === null ? null : Math.round((card.area_m2 / 3.3058) * 10) / 10;
  const floor = [card.floor, card.total_floors && `/${card.total_floors}`].filter(Boolean).join("");
  const kind = card.subtype ?? card.property_type;
  const recommended = meaningful(card.recommended_use);

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap gap-1.5">
        {card.is_new && <Badge tone="blue">신규</Badge>}
        {card.price_changed && <Badge tone="blue">가격 변경</Badge>}
        {card.needs_check && <Badge tone="amber">확인 필요</Badge>}
        {kind && <Badge tone="zinc">{kind}</Badge>}
      </div>

      <h3 className="text-base font-semibold">
        <Link
          href={`/listings/${card.id}${card.detail_token ? `?t=${card.detail_token}` : ""}`}
          className="hover:underline"
        >
        {card.gu} {card.dong}
        {floor && <span className="font-normal text-zinc-600 dark:text-zinc-400"> · {floor}</span>}
        {card.building_name && (
          <span className="font-normal text-zinc-600 dark:text-zinc-400"> · {card.building_name}</span>
        )}
        </Link>
      </h3>

      <p className="text-lg font-bold">
        보증금 {won(card.deposit)} / 월세 {won(card.rent)}
        <span className="text-sm font-normal text-zinc-600 dark:text-zinc-400">
          {" "}
          · 관리비 {card.maintenance_fee === null ? "미기재" : won(card.maintenance_fee)}
          <span> (만원)</span>
        </span>
      </p>

      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        전용 {card.area_m2 ?? "-"}㎡{pyeong !== null && ` (약 ${pyeong}평)`}
        {card.current_use && ` · 현재 ${card.current_use}`}
        {recommended && ` · 추천 용도: ${recommended}`}
      </p>

      {showScore && (
        <p className="text-sm">
          점수: {card.score === null ? <span className="text-zinc-500">준비 중</span> : <b>{card.score}</b>}
        </p>
      )}

      <p className="text-xs text-zinc-500">
        출처: {sourceLabel(card.source)} · {date(card.checked_at)} 수집
        {card.confirmed_at && ` · 중개사 확인일 ${date(card.confirmed_at)}`}
      </p>
    </article>
  );
}
