// 검색 주소(쿼리) 만들기·합치기. 조건 상자·문장으로 찾기·공실이가 같은 규칙으로 주소를 만든다.
import { RANGES } from "./ranges";

const ALL_GU = 8;

// 조건 상자의 값으로 주소를 만든다. 끝까지 민 슬라이더·모든 지역 선택은 "제한 없음"이라 싣지 않는다.
export function queryFromForm(form: HTMLFormElement): string {
  const data = new FormData(form);
  const query = new URLSearchParams();
  const gu = data.getAll("gu").map(String);
  if (gu.length > 0 && gu.length < ALL_GU) gu.forEach((value) => query.append("gu", value));
  data.getAll("dong").forEach((value) => query.append("dong", String(value)));
  data.getAll("floors").forEach((value) => query.append("floors", String(value)));
  const num = (name: string) => {
    const value = data.get(name);
    return value === null || value === "" ? null : Number(value);
  };
  const areaMin = num("area_min");
  const areaMax = num("area_max");
  const deposit = num("deposit_max");
  const rent = num("rent_max");
  if (areaMin !== null && areaMin > RANGES.area.min) query.set("area_min", String(areaMin));
  if (areaMax !== null && areaMax < RANGES.area.max) query.set("area_max", String(areaMax));
  if (deposit !== null && deposit < RANGES.deposit.max) query.set("deposit_max", String(deposit));
  if (rent !== null && rent < RANGES.rent.max) query.set("rent_max", String(rent));
  const sort = data.get("sort");
  if (sort && sort !== "recommended") query.set("sort", String(sort));
  const text = query.toString();
  return text ? `/?${text}` : "/";
}

// 문장으로 찾기·공실이가 만든 조건을 지금 주소에 합친다. keep에 적힌 지금 조건(정렬 등)은 남긴다.
export function mergeQuery(current: string, href: string, keep: string[]): string {
  const now = new URLSearchParams(current.startsWith("?") ? current.slice(1) : current);
  const next = new URLSearchParams(href.split("?")[1] ?? "");
  for (const key of keep) {
    if (next.has(key)) continue;
    now.getAll(key).forEach((value) => next.append(key, value));
  }
  const text = next.toString();
  return text ? `/?${text}` : "/";
}
