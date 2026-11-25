// 비교표 아래 "공통점과 차이점". AI 없이 담은 매물의 실제 값만 비교해 만든다(횟수 차감 없음). 점수 말은 하지 않는다.
import { money, savedDate } from "./display";
import type { SavedItem } from "./types";

export type CompareSummary = {
  common: string[];
  differences: { label: string; text: string }[];
  cautions: string[];
};

type Entry = { n: number; name: string; item: SavedItem; data: NonNullable<SavedItem["data"]> };

const place = (d: NonNullable<SavedItem["data"]>) => [d.gu, d.dong, d.floor].filter(Boolean).join(" ");

function entries(items: SavedItem[]): Entry[] {
  return items.flatMap((item, index) =>
    item.available && item.data ? [{ n: index + 1, name: `${index + 1}번`, item, data: item.data }] : [],
  );
}

const same = <T,>(values: T[]) => values.every((value) => value === values[0]);
const join = (list: Entry[], text: (e: Entry) => string) => list.map((e) => `${e.name} ${text(e)}`).join(" · ");

function pick(list: Entry[], value: (e: Entry) => number | null, best: "min" | "max") {
  const known = list.filter((e) => value(e) !== null);
  if (known.length === 0) return null;
  const target = (best === "min" ? Math.min : Math.max)(...known.map((e) => value(e) as number));
  const winners = known.filter((e) => value(e) === target);
  return winners.length === known.length ? null : winners;
}

export function compareSummary(items: SavedItem[]): CompareSummary {
  const list = entries(items);
  const common: string[] = [];
  const differences: { label: string; text: string }[] = [];
  const cautions: string[] = [];
  if (list.length < 2) return { common, differences, cautions };

  // 위치(구·동)
  const locations = list.map((e) => [e.data.gu, e.data.dong].filter(Boolean).join(" "));
  if (same(locations) && locations[0]) common.push(`모두 ${locations[0]}에 있어요.`);
  else differences.push({ label: "위치", text: join(list, (e) => [e.data.gu, e.data.dong].filter(Boolean).join(" ") || "미기재") });

  // 층
  const floors = list.map((e) => e.data.floor ?? "미기재");
  if (same(floors)) common.push(`모두 ${floors[0]}이에요.`);
  else differences.push({ label: "층", text: join(list, (e) => e.data.floor ?? "미기재") });

  // 면적
  const areas = list.map((e) => e.data.area_m2);
  if (areas.every((v) => v !== null) && same(areas)) common.push(`전용면적이 모두 ${areas[0]}㎡예요.`);
  else {
    const widest = pick(list, (e) => e.data.area_m2, "max");
    differences.push({
      label: "전용면적",
      text: join(list, (e) => (e.data.area_m2 === null ? "미기재" : `${e.data.area_m2}㎡`)) + (widest ? ` (가장 넓은 곳 ${widest.map((e) => e.name).join("·")})` : ""),
    });
  }

  // 보증금·월세·관리비·월 부담
  const money_row = (label: string, subject: string, value: (e: Entry) => number | null, best: "min" | "max" = "min", bestText = "가장 낮은 곳") => {
    const values = list.map(value);
    if (values.every((v) => v !== null) && same(values)) {
      common.push(`${subject} 모두 ${money(values[0])}이에요.`);
      return;
    }
    if (values.every((v) => v === null)) {
      common.push(`${subject} 모두 적혀 있지 않아요.`);
      return;
    }
    const winner = pick(list, value, best);
    differences.push({ label, text: join(list, (e) => money(value(e))) + (winner ? ` (${bestText} ${winner.map((e) => e.name).join("·")})` : "") });
  };
  money_row("보증금", "보증금이", (e) => e.data.deposit);
  money_row("월세", "월세가", (e) => e.data.rent);
  money_row("관리비", "관리비가", (e) => e.data.maintenance_fee);
  money_row("월세+관리비", "월세+관리비가", (e) => (e.data.rent === null || e.data.maintenance_fee === null ? null : e.data.rent + e.data.maintenance_fee));

  // 중개사 확인일
  const confirmed = list.map((e) => savedDate(e.data.confirmed_at));
  if (same(confirmed)) common.push(`중개사 확인일이 모두 ${confirmed[0]}이에요.`);
  else {
    const latest = pick(list, (e) => (e.data.confirmed_at ? new Date(e.data.confirmed_at).getTime() : null), "max");
    differences.push({ label: "중개사 확인일", text: join(list, (e) => savedDate(e.data.confirmed_at)) + (latest ? ` (가장 최근 ${latest.map((e) => e.name).join("·")})` : "") });
  }

  // 주의
  for (const e of list) {
    const notes = [
      e.item.needs_check ? "확인 필요 표시가 있어요" : "",
      e.item.status && e.item.status !== "active" ? "게시가 끝났어요" : "",
      e.data.maintenance_fee === null ? "관리비가 적혀 있지 않아요" : "",
    ].filter(Boolean);
    if (notes.length) cautions.push(`${e.name}(${place(e.data)}): ${notes.join(", ")}.`);
  }
  return { common, differences, cautions };
}
