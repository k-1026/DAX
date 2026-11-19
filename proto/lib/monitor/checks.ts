// 모니터링: 5분마다 상태를 점검하고, 경보·복구 메일을 보낸다.
// 규칙: 앱 개발/01_에이전트_AI서비스_제안.md A-2-3
import type { DeliveryResult, MailMessage } from "../mail/batch";

export type MonitorCall = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export type CheckResult = {
  key: string;
  ok: boolean;
  response_ms?: number | null;
  detail: string;
  error?: string | null;
};

type Notice = {
  type: "opened" | "resolved";
  id: number;
  key: string;
  detail: string;
  error?: string | null;
  failures?: number;
  opened_at?: string;
};

export type MonitorDeps = {
  siteUrl: string;
  alertTo: string[];
  deliver: (message: MailMessage) => Promise<DeliveryResult>;
  fetchSite?: (url: string) => Promise<{ status: number }>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

export const LABELS: Record<string, string> = {
  site: "사이트 접속",
  site_slow: "사이트 응답 속도",
  db: "DB 연결",
  refresh_overdue: "3일 갱신 누락",
  refresh_stuck: "갱신 실패·보류",
  mail_failures: "메일 발송 실패",
  weekly_stuck: "주간 실행",
};

// DB에 연결하지 못했을 때 쓰는 기준값 (평소에는 DB 기준값을 쓴다)
const DEFAULT_SLOW_MS = 3000;
const SITE_TIMEOUT_MS = 10_000;
const DB_RETRY_MS = 5000;

// 경보 메일에 개인정보가 섞이지 않도록 메일 주소와 전화번호를 가리고 길이를 줄인다.
export function maskSensitive(text: string | null | undefined): string | null {
  if (!text) return null;
  return text
    .replace(/[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+/g, "(메일 주소)")
    .replace(/\d{2,3}-?\d{3,4}-?\d{4}/g, "(전화번호)")
    .slice(0, 300);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kstText(value: string | number | Date) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}

const ALERT_FOOTER = "이 메일은 5분 점검에서 자동으로 보냈습니다. 같은 문제는 복구될 때까지 다시 보내지 않습니다.";

function message(
  to: string,
  subject: string,
  lines: string[],
  idempotencyKey?: string,
  footer = ALERT_FOOTER,
): MailMessage {
  return {
    to,
    subject,
    text: [...lines, "", footer].join("\n"),
    html:
      `<ol>${lines.map((line) => `<li>${escapeHtml(line.replace(/^\d\. /, ""))}</li>`).join("")}</ol>` +
      `<p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>`,
    idempotencyKey,
  };
}

// AI 없이 정해진 문장으로 3줄 요약을 만든다. AI 키 연결 후 이 함수를 AI 요약으로 바꾼다.
export function buildAlertMail(to: string, notice: Notice): MailMessage {
  const label = LABELS[notice.key] ?? notice.key;
  if (notice.type === "opened") {
    return message(to, `[대구 공실 매칭 경보] ${label}`, [
      `1. 문제: ${label} (${notice.failures ?? 2}번 연속 실패)`,
      `2. 상태: ${notice.detail}`,
      `3. 마지막 오류: ${maskSensitive(notice.error) ?? "없음"}`,
    ]);
  }
  return message(to, `[대구 공실 매칭 복구] ${label}`, [
    `1. 복구: ${label}`,
    `2. 현재 상태: ${notice.detail}`,
    `3. 경보 시작: ${notice.opened_at ? kstText(notice.opened_at) : "알 수 없음"}`,
  ]);
}

// DB에 연결하지 못하면 기록을 남길 수 없으므로, 하루 1통만 바로 보낸다.
export function buildDbDownMail(to: string, error: string, now: number): MailMessage {
  const day = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
  return message(
    to,
    "[대구 공실 매칭 경보] DB 연결",
    [
      "1. 문제: DB 연결 (2번 연속 실패)",
      "2. 상태: 점검 기록을 남길 수 없어 복구 메일은 오지 않습니다. Supabase 상태를 확인하세요.",
      `3. 마지막 오류: ${maskSensitive(error) ?? "없음"}`,
    ],
    `monitor-db-down-${day}`,
  );
}

const URGENT_LABELS: Record<string, string> = {
  payment: "결제 오류",
  privacy: "개인정보 문제",
  outage: "서비스 장애",
};

// 긴급 리뷰 알림: 종류와 건수만 적는다. 리뷰 글은 넣지 않는다.
export function buildUrgentMail(to: string, kinds: string[]): MailMessage {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const summary = [...counts].map(([kind, count]) => `${URGENT_LABELS[kind] ?? kind} ${count}건`).join(", ");
  return message(to, `[대구 공실 매칭 긴급] 긴급 리뷰 ${kinds.length}건`, [
    `1. 종류: ${summary}`,
    "2. 관리자 화면에서 개선 후보(긴급)를 확인해 주세요.",
    "3. 리뷰 글은 개인정보 보호를 위해 메일에 넣지 않았습니다.",
  ], undefined, "이 메일은 5분 점검에서 자동으로 보냈습니다. 새 긴급 리뷰가 들어오면 그때마다 다시 알려 드립니다.");
}

// 알리지 않은 긴급 리뷰를 5분 점검 때 1통으로 묶어 알린다. 보낸 뒤에 "알림 보냄"으로 표시한다.
async function notifyUrgent(call: MonitorCall, deps: MonitorDeps) {
  const items = ((await call("improvement_urgent_unnotified", {})) ?? []) as { id: string; kind: string }[];
  if (items.length === 0 || deps.alertTo.length === 0) return 0;
  try {
    for (const to of deps.alertTo) {
      await deps.deliver(buildUrgentMail(to, items.map((item) => item.kind)));
    }
  } catch (cause) {
    console.error("긴급 리뷰 알림 발송 실패:", cause instanceof Error ? cause.message : cause);
    return 0;
  }
  await call("improvement_mark_urgent_notified", { p_ids: items.map((item) => item.id) });
  return items.length;
}

async function checkSite(deps: MonitorDeps, slowMs: number): Promise<CheckResult[]> {
  const now = deps.now ?? Date.now;
  const fetchSite =
    deps.fetchSite ??
    ((url: string) =>
      fetch(url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(SITE_TIMEOUT_MS) }));
  const started = now();
  try {
    const { status } = await fetchSite(`${deps.siteUrl}/`);
    const ms = Math.round(now() - started);
    const ok = status < 500;
    const results: CheckResult[] = [
      { key: "site", ok, response_ms: ms, detail: `응답 코드 ${status}`, error: ok ? null : `HTTP ${status}` },
    ];
    if (ok) {
      results.push({
        key: "site_slow",
        ok: ms <= slowMs,
        response_ms: ms,
        detail: `응답 ${ms}ms (기준 ${slowMs}ms)`,
      });
    }
    return results;
  } catch (cause) {
    return [
      {
        key: "site",
        ok: false,
        response_ms: Math.round(now() - started),
        detail: "사이트에 접속하지 못했습니다.",
        error: cause instanceof Error ? cause.message : String(cause),
      },
    ];
  }
}

async function readDbChecks(call: MonitorCall, wait: (ms: number) => Promise<void>) {
  try {
    return { data: (await call("monitor_db_checks", {})) as { checks: CheckResult[]; slow_ms: number } };
  } catch {
    await wait(DB_RETRY_MS);
    try {
      return { data: (await call("monitor_db_checks", {})) as { checks: CheckResult[]; slow_ms: number } };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
}

export async function runMonitor(call: MonitorCall, deps: MonitorDeps) {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const db = await readDbChecks(call, wait);
  if (!db.data) {
    let sent = 0;
    for (const to of deps.alertTo) {
      try {
        await deps.deliver(buildDbDownMail(to, db.error ?? "", now()));
        sent += 1;
      } catch (cause) {
        console.error("DB 경보 메일 발송 실패:", cause instanceof Error ? cause.message : cause);
      }
    }
    return { status: "db_down" as const, alerts_sent: sent };
  }

  const site = await checkSite(deps, Number(db.data.slow_ms) || DEFAULT_SLOW_MS);
  const results: CheckResult[] = [
    ...site,
    { key: "db", ok: true, detail: "DB 연결 정상" },
    ...db.data.checks,
  ].map((result) => ({ ...result, error: maskSensitive(result.error) }));

  const notices = ((await call("monitor_record", { p_results: results })) ?? []) as Notice[];

  let sent = 0;
  let failed = 0;
  for (const notice of notices) {
    try {
      for (const to of deps.alertTo) await deps.deliver(buildAlertMail(to, notice));
      if (deps.alertTo.length > 0) sent += 1;
    } catch (cause) {
      failed += 1;
      console.error("경보 메일 발송 실패:", cause instanceof Error ? cause.message : cause);
      // 다음 점검에서 다시 보내도록 표시를 지운다.
      await call("monitor_undo_alert", { p_id: notice.id });
    }
  }

  if (notices.length > 0 && deps.alertTo.length === 0) {
    console.error("경보 받을 관리자 주소(MONITOR_ALERT_TO)가 없습니다.");
  }

  const urgentNotified = await notifyUrgent(call, deps);

  return {
    status: "checked" as const,
    urgent_notified: urgentNotified,
    failing: results.filter((result) => !result.ok).map((result) => result.key),
    opened: notices.filter((notice) => notice.type === "opened").map((notice) => notice.key),
    resolved: notices.filter((notice) => notice.type === "resolved").map((notice) => notice.key),
    alerts_sent: sent,
    alerts_failed: failed,
  };
}
