// 문의 전 확인 질문 (U12): 정해진 규칙으로만 만든다(AI 없음).
export type QuestionInput = {
  floor: string | null;
  maintenanceFee: number | null;
  confirmedDaysAgo: number | null;
  staleDays: number;
  signals: string[];
};

export function buildQuestions(input: QuestionInput): string[] {
  const questions = [
    "지금도 공실인가요? 확인일 이후에 계약된 적은 없나요?",
    "권리금이 있나요? 있다면 얼마인가요?",
    "원하는 업종으로 입점할 수 있나요? 건물 용도나 업종 제한이 있나요?",
    "계약 기간과 월세 인상 조건은 어떻게 되나요?",
  ];

  if (input.maintenanceFee === null) {
    questions.push("관리비가 적혀 있지 않은데, 관리비는 얼마이고 무엇이 포함되나요?");
  }
  if (input.confirmedDaysAgo !== null && input.confirmedDaysAgo > input.staleDays) {
    questions.push(`중개사 확인이 ${input.confirmedDaysAgo}일 전인데, 지금도 계약할 수 있나요?`);
  }
  if (input.signals.includes("duplicate")) {
    questions.push("같은 매물이 다른 가격으로도 올라와 있는데, 실제 조건은 무엇인가요?");
  }
  if (input.signals.includes("price_outlier")) {
    questions.push("주변 매물보다 저렴한 이유가 있나요? 추가 비용이나 조건은 없나요?");
  }
  if (input.signals.includes("long_posting")) {
    questions.push("오래 비어 있었던 이유가 있나요?");
  }
  if (input.signals.includes("use_mismatch")) {
    questions.push("건축물대장상 용도로 영업 신고가 가능한가요?");
  }
  if (input.floor?.includes("지하")) {
    questions.push("지하라서 환기·습기·누수 문제는 없나요?");
  }
  return questions;
}
