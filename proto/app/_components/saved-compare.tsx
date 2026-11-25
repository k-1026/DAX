"use client";

import Link from "next/link";
import { money, monthlyCost, savedAddress, savedDate, savedSource, savedTitle } from "@/lib/saved/display";
import { compareSummary } from "@/lib/saved/compare-summary";
import type { SavedData, SavedItem } from "@/lib/saved/types";

const rows: { label: string; value: (data: SavedData, item: SavedItem) => React.ReactNode }[] = [
  { label: "주소", value: savedAddress },
  { label: "층", value: (d) => d.floor || "미기재" },
  { label: "전용면적", value: (d) => d.area_m2 === null ? "미기재" : `${d.area_m2}㎡` },
  { label: "보증금", value: (d) => money(d.deposit) },
  { label: "월세", value: (d) => money(d.rent) },
  { label: "관리비", value: (d) => money(d.maintenance_fee) },
  { label: "월세 + 관리비", value: monthlyCost },
  ...["종합 점수", "비용 점수", "공간 점수", "입지 점수", "업종 적합 점수"].map((label) => ({ label, value: () => "미확정" })),
  { label: "중개사 확인일", value: (d) => savedDate(d.confirmed_at) },
  { label: "수집일", value: (_, i) => savedDate(i.checked_at) },
  { label: "출처", value: (_, i) => savedSource(i.source) },
  { label: "확인 정보", value: (_, i) => [i.needs_check ? "확인 필요" : "", i.status !== "active" ? "게시 종료" : ""].filter(Boolean).join(" · ") || "—" },
];

export function SavedCompare({ items }: { items: SavedItem[] }) {
  const summary = compareSummary(items);
  return (
    <section aria-label="매물 비교표" className="reveal-seq min-w-0">
      <h3 className="mb-2 font-medium">나란히 비교</h3>
      <div tabIndex={0} role="region" aria-label="비교표, 좌우로 스크롤할 수 있어요" className="max-w-full overflow-x-auto rounded-lg border border-zinc-200 focus:outline-2 dark:border-zinc-700">
        <table className="w-max min-w-full border-collapse text-left text-xs">
          <caption className="sr-only">선택한 {items.length}곳의 매물 비교</caption>
          <thead><tr><th scope="col" className="sticky left-0 z-10 w-24 min-w-24 bg-zinc-100 p-2 dark:bg-zinc-800">항목</th>
            {items.map((item) => <th scope="col" key={item.listing_id} className="w-44 min-w-44 max-w-52 border-l border-zinc-200 bg-zinc-50 p-2 break-words dark:border-zinc-700 dark:bg-zinc-900">{item.data ? savedTitle(item.data) : "이용할 수 없는 매물"}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.label} className="border-t border-zinc-200 dark:border-zinc-700">
              <th scope="row" className="sticky left-0 z-10 bg-white p-2 font-medium dark:bg-zinc-950">{row.label}</th>
              {items.map((item) => <td key={item.listing_id} className="max-w-52 border-l border-zinc-200 p-2 break-words align-top dark:border-zinc-700">{item.available && item.data ? row.value(item.data, item) : "이용 불가"}</td>)}
            </tr>)}
            <tr className="border-t border-zinc-200 dark:border-zinc-700"><th scope="row" className="sticky left-0 z-10 bg-white p-2 font-medium dark:bg-zinc-950">상세</th>
              {items.map((item) => <td key={item.listing_id} className="border-l border-zinc-200 p-2 dark:border-zinc-700"><Link href={`/listings/${item.listing_id}`} className="underline">매물 상세 보기</Link></td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-zinc-500">좌우로 밀어서 비교할 수 있어요. 점수는 미확정입니다.</p>

      {(summary.common.length > 0 || summary.differences.length > 0) && (
        <div aria-label="공통점과 차이점" className="reveal-seq mt-4 flex flex-col gap-3 text-sm">
          <h3 className="font-medium">공통점과 차이점</h3>
          <div className="rounded-2xl bg-soft px-4 py-3">
            <p className="mb-1 text-xs font-medium text-muted">공통점</p>
            {summary.common.length > 0 ? (
              <ul className="flex flex-col gap-1 leading-6">
                {summary.common.map((line) => (
                  <li key={line}>· {line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">서로 같은 항목이 없어요.</p>
            )}
          </div>
          <div className="rounded-2xl bg-soft px-4 py-3">
            <p className="mb-1 text-xs font-medium text-muted">차이점</p>
            {summary.differences.length > 0 ? (
              <ul className="flex flex-col gap-1.5 leading-6">
                {summary.differences.map((row) => (
                  <li key={row.label}>
                    <span className="font-medium">{row.label}</span> · {row.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">모든 항목이 같아요.</p>
            )}
          </div>
          {summary.cautions.length > 0 && (
            <div className="rounded-2xl bg-warn-soft px-4 py-3 text-warn">
              <p className="mb-1 text-xs font-medium">확인해 주세요</p>
              <ul className="flex flex-col gap-1 leading-6">
                {summary.cautions.map((line) => (
                  <li key={line}>· {line}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-faint">담은 매물의 실제 값만 비교한 거예요(AI를 쓰지 않아요).</p>
        </div>
      )}
    </section>
  );
}
