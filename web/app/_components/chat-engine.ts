// 화면 데모용 답변 생성기 (실제 매물·점수 근거로 답한다).
// 실제 서비스에서는 이 자리에서 서버의 오케스트레이터(Claude API)를 부르고,
// 오케스트레이터가 추천·상권분석 서브에이전트에게 일을 나눠 맡긴다.
import { GROUPS, industryLabel, monthly, toPyeong, walk, won, type IndustryId, type Item, type Recommendation } from "@/lib/listings";

export type Answer = { text: string; cites: number[] };

function bestGroup(x: Item) {
  return x.groups
    .map((v, i) => ({ v, i }))
    .filter((g): g is { v: number; i: number } => g.v != null)
    .sort((a, b) => b.v - a.v)[0];
}
const name = (x: Item) => x.bldg || `${x.dong} ${x.fl} 상가`;

export function answer(q: string, list: Item[], industry: IndustryId): Answer {
  if (list.length === 0) {
    return { text: "지금 조건에 맞는 공실이 없어요. 월세 상한을 올리거나 지역을 넓혀 보세요.", cites: [] };
  }
  const top = list[0];
  const rankOf = (l: Item) => list.indexOf(l) + 1;

  if (/비교|차이/.test(q) && list.length > 1) {
    const b = list[1];
    const ga = bestGroup(top);
    const gb = bestGroup(b);
    return {
      text: `1위 ${name(top)}(${top.title})는 ${GROUPS[ga.i].label} 점수(${ga.v}점)가 강점이고, 2위 ${name(b)}(${b.title})는 ${GROUPS[gb.i].label} 점수(${gb.v}점)가 강점이에요. 한 달에 내는 돈은 각각 ${won(monthly(top))}원, ${won(monthly(b))}원입니다.`,
      cites: [1, 2],
    };
  }
  if (/싼|저렴|월세|임대료|부담/.test(q)) {
    const cheap = [...list].sort((a, b) => monthly(a) - monthly(b))[0];
    return {
      text: `한 달 부담이 가장 적은 곳은 ${cheap.title}예요. 월세 ${won(cheap.rent)}원${cheap.mgmt == null ? " (관리비는 안 적혀 있어요)" : ` + 관리비 ${won(cheap.mgmt)}원`}, 보증금 ${won(cheap.deposit)}원이고 종합 ${rankOf(cheap)}위예요.`,
      cites: [rankOf(cheap)],
    };
  }
  if (/유동|사람|손님|상권|교통|역/.test(q)) {
    const near = [...list].filter((x) => x.subway != null).sort((a, b) => (a.subway ?? 0) - (b.subway ?? 0))[0];
    const busy = [...list].filter((x) => x.stores != null).sort((a, b) => (b.stores ?? 0) - (a.stores ?? 0))[0];
    const parts = [];
    if (busy) parts.push(`주변 가게가 가장 많은 곳은 ${busy.title}(반경 ${busy.radius}m 안 ${busy.stores}곳)`);
    if (near) parts.push(`지하철역이 가장 가까운 곳은 ${near.title}(${walk(near.subway ?? 0)})`);
    return { text: `${parts.join("이고, ")}이에요.`, cites: [...new Set([busy, near].filter(Boolean).map((x) => rankOf(x as Item)))] };
  }
  if (/경쟁|주변|같은 업종/.test(q)) {
    const calm = [...list].filter((x) => x.same != null).sort((a, b) => (a.same ?? 0) - (b.same ?? 0))[0];
    if (!calm) return { text: "같은 업종 가게 수 정보가 없는 매물들이에요.", cites: [] };
    return {
      text: `반경 ${calm.radius}m 안에 ${industryLabel(industry)} 업소가 가장 적은 곳은 ${calm.title}(${calm.same}곳)이에요.`,
      cites: [rankOf(calm)],
    };
  }
  return {
    text: `${top.title}${top.bldg ? `(${top.bldg})` : ""}가 1위인 이유는 ${top.pros.slice(0, 2).join(", ")} 때문이에요. ${toPyeong(top.areaM2)}평, 보증금 ${won(top.deposit)}원에 월세 ${won(top.rent)}원이에요. 확인할 점: ${top.cons[0]}`,
    cites: [1],
  };
}

export function summary(r: Recommendation | null, industry: IndustryId): Answer {
  if (!r) return { text: "", cites: [] };
  if (r.okCount === 0) {
    return { text: "조건에 맞는 공실을 찾지 못했어요. 왼쪽에서 월세 상한이나 지역을 넓혀 보세요.", cites: [] };
  }
  const t = r.items.slice(0, 3);
  const gus = [...new Set(r.items.slice(0, 8).map((l) => l.gu))].slice(0, 3).join("·");
  const g0 = t[0] ? bestGroup(t[0]) : null;
  return {
    text: `대구 빈 상가 ${r.total.toLocaleString()}곳 가운데 ${industryLabel(industry)} 조건에 맞는 곳은 ${r.okCount.toLocaleString()}곳이에요${r.lowCount ? ` (정보가 부족한 ${r.lowCount}곳은 뺐어요)` : ""}. 상위권은 ${gus}에 많아요. 1위 ${t[0].title}는 ${g0 ? `${GROUPS[g0.i].label} 점수 ${g0.v}점이 강점이고, ` : ""}${t[0].pros[0]}${t[1] ? `. 2위 ${t[1].title}는 한 달 ${won(monthly(t[1]))}원` : ""}${t[2] ? `, 3위 ${t[2].title}는 ${t[2].pros[0]}` : ""}.`,
    cites: t.map((_, i) => i + 1),
  };
}

export const SUGGESTIONS = ["1위는 왜 추천됐어?", "1위와 2위 비교해줘", "한 달 부담이 제일 적은 곳은?", "주변 경쟁이 적은 곳은?"];
