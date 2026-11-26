// 시험 사이트 입장 비밀번호. 환경변수 SITE_GATE_PASSWORD가 있을 때만 켜진다(내 PC 개발 서버·실서비스는 비워 둠).
// 쿠키에는 비밀번호 대신 해시만 저장한다.
export const GATE_COOKIE = "dax_gate";

// 입장 확인 없이 열어야 하는 경로: 예약 실행·수집 API(자체 비밀값으로 보호), 로그인 콜백, 입장 화면 자신
const GATE_EXEMPT = ["/gate", "/api/", "/auth/"];

export function gatePassword() {
  return process.env.SITE_GATE_PASSWORD?.trim() || null;
}

export function gateExempt(pathname: string) {
  return GATE_EXEMPT.some((path) => pathname === path || pathname.startsWith(path));
}

export async function gateToken(password: string) {
  const data = new TextEncoder().encode(`dax-gate:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
