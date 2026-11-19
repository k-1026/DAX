// 추천 API: 화면이 조건을 보내면 서버가 실제 매물 2,717건을 점수 매겨 순위를 돌려준다.
// 비회원에게는 상위 3곳만 내용을 보내고, 나머지는 순위·점수만 보낸다 (화면에서 흐리게만 가리던 문제 해결).
import { NextResponse, type NextRequest } from "next/server";
import { recommend } from "@/lib/engine";
import { DEFAULT_FILTERS, GU_LIST, INDUSTRIES, type Filters, type Floor, type Gu, type Preference } from "@/lib/listings";
import { getViewer } from "@/lib/viewer";

const FLOORS: Floor[] = ["1층", "지상 2층 이상", "지하"];

function clean(input: Partial<Filters> | undefined): Filters {
  const f = { ...DEFAULT_FILTERS, ...(input ?? {}) };
  const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
  return {
    industry: INDUSTRIES.some((i) => i.id === f.industry) ? f.industry : DEFAULT_FILTERS.industry,
    areaMin: num(f.areaMin, DEFAULT_FILTERS.areaMin),
    areaMax: num(f.areaMax, DEFAULT_FILTERS.areaMax),
    depositMax: num(f.depositMax, DEFAULT_FILTERS.depositMax),
    rentMax: num(f.rentMax, DEFAULT_FILTERS.rentMax),
    gus: Array.isArray(f.gus) ? f.gus.filter((g): g is Gu => (GU_LIST as readonly string[]).includes(g)) : [...GU_LIST],
    floors: Array.isArray(f.floors) ? f.floors.filter((x): x is Floor => FLOORS.includes(x)) : DEFAULT_FILTERS.floors,
    prio: Math.max(0, Math.min(4, Math.round(num(f.prio, 0)))),
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { filters?: Partial<Filters>; pref?: Preference; as?: string };
  const viewer = await getViewer(body.as);
  const likedGus: Preference["likedGus"] = {};
  for (const [g, v] of Object.entries(body.pref?.likedGus ?? {})) {
    if ((GU_LIST as readonly string[]).includes(g) && typeof v === "number") likedGus[g as Gu] = Math.max(-4, Math.min(4, v));
  }
  const result = recommend(clean(body.filters), { member: viewer.loggedIn, pref: { likedGus } });
  return NextResponse.json(result);
}
