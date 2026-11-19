// 회원 탈퇴 사유. 코드는 DB의 account_withdrawals.reason_code 와 같아야 한다.
export const WITHDRAWAL_REASONS = [
  { code: "no_listing", label: "원하는 매물이 없어요" },
  { code: "poor_recommendation", label: "추천이 잘 맞지 않아요" },
  { code: "hard_to_use", label: "사용하기 불편해요" },
  { code: "price", label: "요금이 부담돼요" },
  { code: "plan_changed", label: "창업 계획이 바뀌었어요" },
  { code: "privacy", label: "개인정보가 걱정돼요" },
  { code: "other", label: "기타" },
] as const;
