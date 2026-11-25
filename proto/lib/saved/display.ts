import type { SavedData } from "./types";

export const money = (value: number | null | undefined) =>
  value == null ? "미기재" : `${value.toLocaleString("ko-KR")}만원`;

export function monthlyCost(data: Pick<SavedData, "rent" | "maintenance_fee">) {
  if (data.rent === null) return "미기재";
  if (data.maintenance_fee === null) return `${money(data.rent)} + 관리비 미기재`;
  return money(data.rent + data.maintenance_fee);
}

export function savedTitle(data: Pick<SavedData, "building_name" | "gu" | "dong">) {
  return data.building_name || [data.gu, data.dong].filter(Boolean).join(" ") || "매물";
}

export function savedAddress(data: Pick<SavedData, "address" | "gu" | "dong">) {
  return data.address || `${[data.gu, data.dong].filter(Boolean).join(" ")} (상세 주소 미기재)`.trim();
}

export function savedDate(value?: string | null) {
  if (!value) return "미기재";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00+09:00` : value);
  return Number.isNaN(parsed.getTime()) ? "미기재" : parsed.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

export function savedSource(value?: string) {
  return value?.startsWith("naver") ? "네이버 부동산" : value || "미기재";
}
