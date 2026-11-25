// 조건 패널 슬라이더의 범위. 매물 값 분포(2,717건)를 보고 정했다:
// 전용면적 중앙값 95㎡·95% 398㎡, 보증금 중앙값 2,000만·95% 1억, 월세+관리비 중앙값 120만·95% 700만.
// 슬라이더를 끝까지 밀면 "제한 없음"이다(주소에는 값을 싣지 않는다).
export const RANGES = {
  area: { min: 0, max: 400, step: 5 },
  deposit: { min: 0, max: 10000, step: 500 },
  rent: { min: 0, max: 700, step: 10 },
} as const;

export const SQM_PER_PYEONG = 3.3058;
