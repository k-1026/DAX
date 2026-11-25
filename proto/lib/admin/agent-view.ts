// 관리자 "에이전트 실행": 카드(불빛)와 로그 줄을 읽어서 만든다. 읽기만 한다. 메일 주소·제목은 다루지 않는다.
import type { createClient } from "@/lib/supabase/server";
import { LABELS as CHECK_LABELS } from "@/lib/monitor/checks";
import type { Advice } from "./playbook";
import { adviseScreen } from "./playbook-files";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type Light = "run" | "ok" | "warn" | "fail" | "idle";
export type AgentKey = "refresh" | "weekly" | "monitor" | "mail" | "weights";
export type AgentCard = { key: AgentKey; name: string; light: Light; text: string };
export type LogLine = { time: string; level: "info" | "ok" | "warn" | "error"; text: string };
export type RunOption = { id: string; label: string };
export type AgentView = { cards: AgentCard[]; selected: AgentKey; runs: RunOption[]; runId: string | null; lines: LogLine[]; anyRunning: boolean; updatedAt: string; advice: Advice[]; adviceErrors: string[] };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const AGENT_KEYS: AgentKey[] = ["refresh", "weekly", "monitor", "mail", "weights"];

const NAMES: Record<AgentKey, string> = { refresh: "매물 갱신", weekly: "주간 분석", monitor: "시스템 점검", mail: "추천 메일", weights: "가중치 보정" };
const STEP_LABEL: Record<string, string> = {
  quality_check: "품질 검사", diff: "변경 비교", validate: "검증", score: "점수", mail: "메일",
  feedback_classify: "피드백 분류", feedback_second_check: "2차 확인", feedback_report: "피드백 리포트",
  quality_eval: "품질 평가", improvement_group: "개선 묶기", improvement_candidates: "개선 후보",
};
const STATUS_TEXT: Record<string, string> = { succeeded: "성공", failed: "실패", held: "보류", skipped: "건너뜀", running: "실행 중", pending: "대기", rejected: "반려", retry: "재시도" };
const MAIL_KIND: Record<string, string> = { first_recommendation: "첫 추천 메일", subscriber_batch: "구독 회원 메일", unsubscribe_result: "수신 거부 안내", consent_reminder: "동의 안내" };
const MAIL_STATUS: Record<string, string> = { queued: "대기", deferred: "아침으로 미룸", preview: "미리보기", sent: "발송", failed: "실패", suppressed: "보내지 않음" };

const clip = (text: string | null | undefined, max = 160) => (text ?? "").replace(/\s+/g, " ").slice(0, max);
const kstTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false });
const kstDay = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const ago = (ms: number) => (ms < HOUR ? `${Math.max(1, Math.round(ms / 60_000))}분 전` : ms < DAY ? `${Math.round(ms / HOUR)}시간 전` : `${Math.floor(ms / DAY)}일 전`);

type RunRow = { id: string; run_type: string; status: string; started_at: string; finished_at: string | null; error: string | null };

async function limits(supabase: Supabase) {
  const { data } = await supabase.from("app_settings").select("value, description");
  const find = (description: string, fallback: number) => {
    const value = data?.find((row) => row.description === description)?.value;
    return typeof value === "number" ? value : fallback;
  };
  return {
    refreshHours: find("마지막 갱신 성공 후 경보까지 시간", 78),
    weeklyDays: find("주간 실행이 성공하지 않은 채 경보까지 일수", 8),
    mailPct: find("최근 24시간 메일 성공률 하한 (%)", 95),
  };
}

function runCard(key: "refresh" | "weekly", runs: RunRow[], limit: number): AgentCard {
  const name = NAMES[key];
  const last = runs[0];
  if (!last) return { key, name, light: "idle", text: "아직 실행 기록이 없어요" };
  if (last.status === "running") return { key, name, light: "run", text: `실행 중 · ${kstDay(last.started_at)} 시작` };
  const success = runs.find((run) => run.status === "succeeded");
  const at = new Date(last.finished_at ?? last.started_at);
  if (last.status === "failed" || last.status === "rejected") return { key, name, light: "fail", text: `${STATUS_TEXT[last.status]} · ${kstDay(at.toISOString())}` };
  if (last.status === "held") return { key, name, light: "warn", text: `보류 · ${kstDay(at.toISOString())}` };
  const successAt = success ? new Date(success.finished_at ?? success.started_at).getTime() : null;
  const age = successAt === null ? null : Date.now() - successAt;
  if (age !== null && age > limit) return { key, name, light: "warn", text: `마지막 성공 ${ago(age)} · 기준 초과` };
  return { key, name, light: "ok", text: `성공 · ${age === null ? kstDay(at.toISOString()) : ago(age)}` };
}

export async function loadAgentView(supabase: Supabase, selected: AgentKey, runId: string | null): Promise<AgentView> {
  const since = new Date(Date.now() - DAY).toISOString();
  const [limit, refreshRuns, weeklyRuns, checks, mailRecent, mailLast] = await Promise.all([
    limits(supabase),
    supabase.from("agent_runs").select("id, run_type, status, started_at, finished_at, error").eq("run_type", "refresh").order("started_at", { ascending: false }).limit(10),
    supabase.from("agent_runs").select("id, run_type, status, started_at, finished_at, error").eq("run_type", "weekly").order("started_at", { ascending: false }).limit(10),
    supabase.from("health_checks").select("check_key, ok, response_ms, detail, error, checked_at").order("id", { ascending: false }).limit(60),
    supabase.from("email_sends").select("status").gte("created_at", since),
    supabase.from("email_sends").select("created_at").order("created_at", { ascending: false }).limit(1),
  ]);
  const refresh = (refreshRuns.data ?? []) as RunRow[];
  const weekly = (weeklyRuns.data ?? []) as RunRow[];

  // 시스템 점검 카드
  const latestChecks = new Map<string, { ok: boolean; checked_at: string }>();
  for (const row of checks.data ?? []) if (!latestChecks.has(row.check_key)) latestChecks.set(row.check_key, row);
  const failingChecks = [...latestChecks.values()].filter((row) => !row.ok).length;
  const newestCheck = checks.data?.[0]?.checked_at;
  const monitorCard: AgentCard = !newestCheck
    ? { key: "monitor", name: NAMES.monitor, light: "idle", text: "아직 점검 기록이 없어요" }
    : failingChecks > 0
      ? { key: "monitor", name: NAMES.monitor, light: "fail", text: `${failingChecks}곳 이상` }
      : Date.now() - new Date(newestCheck).getTime() > 15 * 60_000
        ? { key: "monitor", name: NAMES.monitor, light: "warn", text: `마지막 점검 ${ago(Date.now() - new Date(newestCheck).getTime())}` }
        : { key: "monitor", name: NAMES.monitor, light: "ok", text: `정상 · ${ago(Date.now() - new Date(newestCheck).getTime())} 점검` };

  // 추천 메일 카드
  const sent = (mailRecent.data ?? []).filter((row) => row.status === "sent").length;
  const failed = (mailRecent.data ?? []).filter((row) => row.status === "failed").length;
  const lastMailAt = mailLast.data?.[0]?.created_at;
  const rate = sent + failed > 0 ? Math.round((sent / (sent + failed)) * 100) : null;
  const mailCard: AgentCard = !lastMailAt
    ? { key: "mail", name: NAMES.mail, light: "idle", text: "아직 발송 기록이 없어요" }
    : rate !== null && rate < limit.mailPct
      ? { key: "mail", name: NAMES.mail, light: "fail", text: `성공률 ${rate}% · 기준 ${limit.mailPct}% 미만` }
      : failed > 0
        ? { key: "mail", name: NAMES.mail, light: "warn", text: `최근 24시간 실패 ${failed}건` }
        : { key: "mail", name: NAMES.mail, light: "ok", text: sent + failed > 0 ? `최근 24시간 ${sent}건 발송` : `최근 24시간 발송 없음 · 마지막 ${kstDay(lastMailAt)}` };

  const cards: AgentCard[] = [
    runCard("refresh", refresh, limit.refreshHours * HOUR),
    runCard("weekly", weekly, limit.weeklyDays * DAY),
    monitorCard,
    mailCard,
    { key: "weights", name: NAMES.weights, light: "idle", text: "꺼짐 · 5단계 후 시작" },
  ];
  const anyRunning = cards.some((card) => card.light === "run");

  // 다음에 할 일 제안: 규칙 파일(content/admin-playbook/에이전트.md)이 읽는 숫자
  const real = cards.filter((card) => card.key !== "weights");
  const lastSuccess = (runs: RunRow[]) => runs.find((run) => run.status === "succeeded");
  const elapsed = (iso: string | null | undefined) => (iso ? Date.now() - new Date(iso).getTime() : 0);
  const refreshOk = lastSuccess(refresh);
  const weeklyOk = lastSuccess(weekly);
  const runningMinutes = [...refresh, ...weekly].filter((run) => run.status === "running").map((run) => Math.floor(elapsed(run.started_at) / 60_000));
  const { advice, errors: adviceErrors } = await adviseScreen("agents", {
    실패_에이전트_수: real.filter((card) => card.light === "fail").length,
    경고_에이전트_수: real.filter((card) => card.light === "warn").length,
    // "기준 초과"로 노란 불이 된 매물 갱신·주간 분석은 각각 따로 제안하므로 여기서는 뺀다.
    기타_경고_에이전트_수: real.filter((card) => card.light === "warn" && !card.text.includes("기준 초과")).length,
    실행중_에이전트_수: real.filter((card) => card.light === "run").length,
    실행중_최장_분: runningMinutes.length ? Math.max(...runningMinutes) : 0,
    점검_이상_수: failingChecks,
    점검_기록_없음: newestCheck ? 0 : 1,
    점검_마지막_경과_분: newestCheck ? Math.floor(elapsed(newestCheck) / 60_000) : 0,
    주간_기록_없음: weekly.length === 0 ? 1 : 0,
    주간_경과_일: weeklyOk ? Math.floor(elapsed(weeklyOk.finished_at ?? weeklyOk.started_at) / DAY) : 0,
    주간_경보_기준_일: limit.weeklyDays,
    갱신_기록_없음: refresh.length === 0 ? 1 : 0,
    갱신_경과_시간: refreshOk ? Math.floor(elapsed(refreshOk.finished_at ?? refreshOk.started_at) / HOUR) : 0,
    갱신_경보_기준_시간: limit.refreshHours,
    메일_기록_없음: lastMailAt ? 0 : 1,
    기록_없는_에이전트_수: real.filter((card) => card.light === "idle").length,
  });

  // 로그
  let runs: RunOption[] = [];
  let lines: LogLine[] = [];
  let chosenRun: string | null = null;

  if (selected === "refresh" || selected === "weekly") {
    const list = selected === "refresh" ? refresh : weekly;
    runs = list.slice(0, 5).map((run) => ({ id: run.id, label: `${kstDay(run.started_at)} · ${STATUS_TEXT[run.status] ?? run.status}` }));
    const run = list.find((item) => item.id === runId) ?? list[0];
    if (run) {
      chosenRun = run.id;
      const { data: steps } = await supabase.from("agent_steps").select("id, step_key, step_order, status, error, started_at, finished_at").eq("run_id", run.id).order("step_order");
      const ids = (steps ?? []).map((step) => step.id);
      const { data: events } = ids.length
        ? await supabase.from("agent_events").select("step_id, level, message, created_at").in("step_id", ids).order("created_at")
        : { data: [] as { step_id: string; level: string; message: string; created_at: string }[] };
      const all: (LogLine & { at: string })[] = [{ at: run.started_at, time: kstTime(run.started_at), level: "info", text: `${NAMES[selected]} 실행 시작` }];
      for (const step of steps ?? []) {
        const label = STEP_LABEL[step.step_key] ?? step.step_key;
        if (step.started_at) all.push({ at: step.started_at, time: kstTime(step.started_at), level: "info", text: `${label} 시작` });
        if (!step.started_at && step.status === "pending") continue;
      }
      for (const event of events ?? []) {
        const step = (steps ?? []).find((item) => item.id === event.step_id);
        const label = STEP_LABEL[step?.step_key ?? ""] ?? step?.step_key ?? "단계";
        const status = step ? (event.level === "error" && step.status === "pending" ? "retry" : step.status) : "";
        const detail = step?.error ? ` · ${clip(step.error)}` : "";
        all.push({ at: event.created_at, time: kstTime(event.created_at), level: event.level === "error" ? "error" : event.level === "warn" ? "warn" : "ok", text: `${label} ${STATUS_TEXT[status] ?? status}${detail}` });
      }
      if (run.finished_at) all.push({ at: run.finished_at, time: kstTime(run.finished_at), level: run.status === "succeeded" ? "ok" : run.status === "held" ? "warn" : "error", text: `실행 ${STATUS_TEXT[run.status] ?? run.status}${run.error ? ` · ${clip(run.error)}` : ""}` });
      lines = all.sort((a, b) => a.at.localeCompare(b.at)).map(({ time, level, text }) => ({ time, level, text }));
    }
  } else if (selected === "monitor") {
    lines = (checks.data ?? []).slice(0, 40).reverse().map((row) => ({
      time: kstDay(row.checked_at),
      level: row.ok ? "ok" : "error",
      text: `${CHECK_LABELS[row.check_key] ?? row.check_key} ${row.ok ? "정상" : "이상"} · ${clip(row.detail)}${row.response_ms ? ` (${row.response_ms}ms)` : ""}${!row.ok && row.error ? ` · ${clip(row.error, 100)}` : ""}`,
    }));
  } else if (selected === "mail") {
    const { data } = await supabase.from("email_sends").select("kind, status, created_at").order("created_at", { ascending: false }).limit(30);
    lines = (data ?? []).reverse().map((row) => ({
      time: kstDay(row.created_at),
      level: row.status === "failed" ? "error" : row.status === "sent" ? "ok" : "info",
      text: `${MAIL_KIND[row.kind] ?? row.kind} ${MAIL_STATUS[row.status] ?? row.status}`,
    }));
  } else {
    lines = [{ time: "", level: "warn", text: "아직 시작 전이에요. 점수와 가중치가 정해지는 5단계 뒤에 만들어요." }];
  }

  return { cards, selected, runs, runId: chosenRun, lines, anyRunning, updatedAt: new Date().toISOString(), advice, adviceErrors };
}
