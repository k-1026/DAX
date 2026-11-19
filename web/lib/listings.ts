// 화면(브라우저)과 서버가 같이 쓰는 이름표·자료형·작은 도구.
// 실제 매물과 점수 계산은 서버 전용 lib/engine.ts 에 있다 (매물 2MB를 브라우저로 보내지 않기 위해).

export const GU_LIST = ["중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군"] as const;
export type Gu = (typeof GU_LIST)[number];

// 업종 8종: 이전 데모(점수 엔진 v1)와 같은 분류
export const INDUSTRIES = [
  { id: "식음료", label: "음식점·카페", emoji: "🍽️" },
  { id: "소매", label: "옷·잡화 가게", emoji: "🛍️" },
  { id: "뷰티", label: "미용실·네일", emoji: "💇" },
  { id: "공연문화", label: "공연·문화 공간", emoji: "🎭" },
  { id: "사무업무", label: "사무실", emoji: "💼" },
  { id: "교육", label: "학원·교습소", emoji: "📚" },
  { id: "의료", label: "병원·약국", emoji: "🏥" },
  { id: "운동시설", label: "헬스·필라테스", emoji: "🏋️" },
] as const;
export type IndustryId = (typeof INDUSTRIES)[number]["id"];

// 점수 4그룹 (비용·공간·입지·업종적합)
export const GROUPS = [
  { key: "비용", label: "비용", desc: "월세·보증금 부담" },
  { key: "공간", label: "공간", desc: "층·넓이·건물 나이" },
  { key: "입지", label: "위치", desc: "교통·주변 상권·손님" },
  { key: "업종적합", label: "업종 맞춤", desc: "건물 용도가 맞는지" },
] as const;

export const PRIORITIES = ["골고루", "저렴한 비용", "좋은 공간", "좋은 위치", "업종에 맞는 건물"] as const;

export type Floor = "1층" | "지상 2층 이상" | "지하";

export const RENT_ANY = 800; // 월세 슬라이더 끝 = 상관없음
export const DEPOSIT_ANY = 10000; // 보증금 슬라이더 끝 = 상관없음

export type Filters = {
  industry: IndustryId;
  areaMin: number; // ㎡
  areaMax: number;
  depositMax: number; // 만원
  rentMax: number; // 월세+관리비 상한, 만원
  gus: Gu[];
  floors: Floor[];
  prio: number; // PRIORITIES 번호. 고른 그룹 가중치 +25
};

export const DEFAULT_FILTERS: Filters = {
  industry: "식음료",
  areaMin: 20,
  areaMax: 200,
  depositMax: 5000,
  rentMax: 300,
  gus: [...GU_LIST],
  floors: ["1층", "지상 2층 이상"],
  prio: 0,
};

export type Fact = { name: string; value: string; detail: string; score: number | null };

export type Item = {
  id: string;
  title: string; // 구 동 층
  bldg: string;
  gu: Gu;
  dong: string;
  fl: string;
  areaM2: number;
  deposit: number;
  rent: number;
  mgmt: number | null;
  noPremium: boolean; // 무권리
  lat: number | null;
  lng: number | null;
  link: string; // 원본 매물 (네이버부동산)
  days: number | null; // 며칠 전 확인
  subway: number | null; // 지하철역 거리 m
  bus: number | null;
  stores: number | null; // 반경 안 가게 수
  same: number | null; // 반경 안 같은 업종 수
  radius: number;
  useName: string; // 건축물대장상 용도
  rec: string; // 매물 소개의 추천 업종
  score: number;
  baseScore: number;
  prefBonus: number;
  groups: (number | null)[];
  facts: Fact[][]; // 그룹별 요소
  pros: string[];
  cons: string[];
};

export type LockedItem = { rank: number; score: number; gu: Gu };

export type Recommendation = {
  date: string;
  version: string;
  total: number; // 전체 매물
  matched: number; // 조건 통과
  okCount: number; // 점수 계산 가능
  lowCount: number; // 정보 부족으로 뺀 수
  weights: number[]; // 그룹 가중치 (%)
  items: Item[];
  locked: LockedItem[];
};

export type Preference = { likedGus: Partial<Record<Gu, number>> };

export const GUEST_LIMIT = 3; // 비회원이 볼 수 있는 추천 수
export const MEMBER_LIMIT = 15;

export const PY = 3.3058;
export const toPyeong = (m2: number) => Math.round(m2 / PY);

export function won(manwon: number) {
  if (manwon >= 10000) {
    const eok = Math.floor(manwon / 10000);
    const rest = manwon % 10000;
    return rest ? `${eok}억 ${rest.toLocaleString()}만` : `${eok}억`;
  }
  return `${manwon.toLocaleString()}만`;
}

export const walk = (m: number) => `걸어서 약 ${Math.max(1, Math.round(m / 67))}분`;

export function industryLabel(id: IndustryId) {
  return INDUSTRIES.find((i) => i.id === id)?.label ?? id;
}

export function scoreLabel(t: number): [string, "a" | "b" | "c" | "d"] {
  return t >= 80 ? ["아주 좋음", "a"] : t >= 70 ? ["좋음", "b"] : t >= 60 ? ["보통", "c"] : ["아쉬움", "d"];
}

export const monthly = (x: Pick<Item, "rent" | "mgmt">) => x.rent + (x.mgmt ?? 0);
