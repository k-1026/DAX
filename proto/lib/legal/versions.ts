// 약관과 동의 문서의 현재 버전
// 문구가 바뀌면 값을 올린다. 필수 문서의 버전이 바뀌면 회원은 다시 동의해야 한다.
export const LEGAL_VERSIONS = {
  terms: "2026-11-19-draft",
  privacy: "2026-11-19-draft",
  behavior_tracking: "2026-11-19-draft",
  email: "2026-11-19-draft",
} as const;

// 외부 주소로 이동하지 않도록 우리 사이트 안의 경로만 허용한다.
export function toSafePath(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}
