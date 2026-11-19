// 관리자 모니터링 화면용 샘플 데이터.
// 실제로는 Supabase의 agent_runs / agent_logs / score_versions / reviews / mail_campaigns 테이블에서 읽는다.

export type AgentStatus = "running" | "ok" | "waiting" | "error";

export type Agent = {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  lastRun: string;
  nextRun: string;
  duration: string;
  detail: string;
};

export const ORCHESTRATOR: Agent = {
  id: "orchestrator",
  name: "오케스트레이터",
  role: "서브에이전트 일정·순서 관리, 결과 검수, 실행 로그 기록",
  status: "running",
  lastRun: "11/19 09:00",
  nextRun: "상시",
  duration: "—",
  detail: "오늘 작업 14건 배정 · 실패 0 · 재시도 1",
};

export const AGENTS: Agent[] = [
  { id: "collect", name: "매물 수집", role: "공공데이터·중개 매물 수집 (3일 주기)", status: "ok", lastRun: "11/18 03:00", nextRun: "11/21 03:00", duration: "18분 42초", detail: "신규 37 · 계약완료 22 · 변경 15" },
  { id: "clean", name: "데이터 정제", role: "중복 제거, 주소→좌표, 면적·가격 단위 통일", status: "ok", lastRun: "11/18 03:19", nextRun: "11/21 03:19", duration: "4분 05초", detail: "중복 9건 병합 · 좌표 실패 2건" },
  { id: "score", name: "스코어링", role: "업종별 적합 점수 계산, 가중치 버전 적용", status: "ok", lastRun: "요청마다", nextRun: "상시", duration: "1초 미만", detail: "점수 엔진 v1 · 2,717건 × 8업종 (실제 적용)" },
  { id: "review", name: "리뷰 분석", role: "리뷰·좋아요/아쉬워요 집계 → 가중치 조정안 작성", status: "waiting", lastRun: "11/17 22:00", nextRun: "11/20 22:00", duration: "6분 30초", detail: "새 리뷰 63건 대기 · v2 조정안 초안" },
  { id: "mail", name: "추천 메일", role: "회원별 맞춤 추천 메일 작성·발송", status: "ok", lastRun: "11/18 08:00", nextRun: "11/21 08:00", duration: "9분 52초", detail: "3,412통 발송 · 반송 0.6%" },
  { id: "monitor", name: "모니터링", role: "5분마다 페이지·API 상태 점검, 이상 시 알림", status: "ok", lastRun: "11/19 10:25", nextRun: "11/19 10:30", duration: "3초", detail: "최근 24시간 경고 1건" },
];

export type LogLevel = "INFO" | "WARN" | "ERROR";
export const LOGS: { at: string; level: LogLevel; agent: string; msg: string }[] = [
  { at: "11/19 10:25:03", level: "INFO", agent: "모니터링", msg: "전체 점검 통과 (6/6) · p95 312ms" },
  { at: "11/19 09:41:17", level: "WARN", agent: "모니터링", msg: "/api/recommend 응답 1.8s (기준 1.5s 초과) · 1회" },
  { at: "11/19 09:00:00", level: "INFO", agent: "오케스트레이터", msg: "일일 계획 수립: 모니터링 288회, 리뷰 수집 1회" },
  { at: "11/18 22:00:12", level: "INFO", agent: "리뷰 분석", msg: "리뷰 41건 분류 · 불만 상위: '이미 계약된 매물'(12)" },
  { at: "11/18 08:09:52", level: "INFO", agent: "추천 메일", msg: "캠페인 #27 발송 완료 3,412통" },
  { at: "11/18 03:24:51", level: "INFO", agent: "스코어링", msg: "점수 엔진 v1 적용 · 매물 2,717건 (11/10 기준)" },
  { at: "11/18 03:21:40", level: "WARN", agent: "데이터 정제", msg: "주소 좌표 변환 실패 2건 (DG-1134, DG-1281) → 수동 확인 대기" },
  { at: "11/18 03:19:02", level: "INFO", agent: "매물 수집", msg: "이전 데모 데이터 2,717건 가져옴 (scripts/import-demo.mjs)" },
  { at: "11/18 03:07:44", level: "ERROR", agent: "매물 수집", msg: "외부 매물 API 타임아웃 → 30초 후 재시도 성공" },
  { at: "11/18 03:00:00", level: "INFO", agent: "오케스트레이터", msg: "3일 주기 갱신 시작: 수집 → 정제 → 스코어링 → 메일" },
];

export const NEXT_PROPOSAL = {
  v: "v2",
  basedOn: "리뷰 63건 · 평가 418건",
  changes: ["'이미 계약된 매물' 불만 12건 → 갱신 주기 사이 계약 여부 재확인 단계 추가 제안", "학원·교습소: 2층 이상 가산점 +2 제안 (좋아요 비율 71%)", "경쟁 강도 가중치 12% → 13%"],
};

export const REVIEWS = [
  { who: "카페 창업 준비 · 김**", stars: 5, text: "삼덕동 1위 매물 실제로 가 봤는데 분위기 딱이에요.", tag: "업종이 잘 맞아요", at: "2시간 전" },
  { who: "학원 원장 · 이**", stars: 4, text: "범어동 2층 추천 좋았어요. 주차 정보가 있으면 좋겠어요.", tag: "기능 요청", at: "5시간 전" },
  { who: "음식점 · 박**", stars: 2, text: "추천 3곳 중 1곳이 이미 계약됐대요.", tag: "이미 계약된 매물", at: "어제" },
  { who: "네일샵 · 최**", stars: 4, text: "월세 시뮬레이터 덕분에 예산 잡기 편했어요.", tag: "지역이 좋아요", at: "어제" },
];

export const MAIL = {
  subscribers: 3412,
  nextSend: "11/21 08:00",
  lastCampaign: "#27 · 11/18",
  openRate: 46.2,
  clickRate: 12.8,
  unsub: 0.4,
};

// 최근 30일 가동 상태 (true = 정상, false = 장애 기록 있음)
export const UPTIME_30D: ("ok" | "warn" | "down")[] = Array.from({ length: 30 }, (_, i) =>
  i === 11 ? "down" : i === 22 || i === 28 ? "warn" : "ok",
);
