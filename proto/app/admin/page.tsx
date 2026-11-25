// 관리자 개요: 읽기만 한다(숫자·상태 요약). 개인정보는 보여 주지 않는다.
import { connection } from "next/server";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { collectAttention } from "@/lib/admin/screen-advice";
import { AttentionBox } from "./_components/attention-box";

const DAY = 86_400_000;

// 지금 시각을 쓰는 계산은 화면 함수 밖에 둔다.
const daysSince = (date: Date) => Math.floor((Date.now() - date.getTime()) / DAY);

type Tone = "ok" | "warn" | "bad" | "";
const toneText: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", "": "text-muted" };

function Tile({ label, value, hint, tone = "" }: { label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <div className="rounded-xl bg-soft px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5">
        <span className="text-xl font-medium">{value}</span>
        {hint && <span className={`ml-1.5 text-xs ${toneText[tone]}`}>{hint}</span>}
      </p>
    </div>
  );
}

function kstMonthStart() {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 3_600_000).toISOString();
}

async function AdminOverviewContent() {
  await connection();
  const supabase = await createClient();
  const monthStart = kstMonthStart();

  const [attention, health, refresh, running, mailAll, mailSent, mailFailed, candidates, urgent] = await Promise.all([
    collectAttention(supabase),
    supabase.from("health_checks").select("check_key, ok, detail, checked_at").order("id", { ascending: false }).limit(60),
    supabase.from("agent_runs").select("status, started_at, finished_at").eq("run_type", "refresh").order("started_at", { ascending: false }).limit(1),
    supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("status", "running"),
    supabase.from("email_sends").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
    supabase.from("email_sends").select("id", { count: "exact", head: true }).gte("created_at", monthStart).eq("status", "sent"),
    supabase.from("email_sends").select("id", { count: "exact", head: true }).gte("created_at", monthStart).eq("status", "failed"),
    supabase.from("improvement_candidates").select("id", { count: "exact", head: true }).eq("status", "candidate").eq("is_test", false),
    supabase.from("improvement_candidates").select("id", { count: "exact", head: true }).eq("status", "candidate").eq("is_test", false).eq("urgent", true),
  ]);

  // 점검 항목별 가장 최근 결과
  const latest = new Map<string, { ok: boolean; detail: string }>();
  for (const row of health.data ?? []) if (!latest.has(row.check_key)) latest.set(row.check_key, { ok: row.ok, detail: row.detail });
  const failing = [...latest.entries()].filter(([, v]) => !v.ok);

  // 마지막 매물 갱신(성공한 것 기준이 아니라 가장 최근 실행)
  const last = refresh.data?.[0];
  const lastAt = last ? new Date(last.finished_at ?? last.started_at) : null;
  const days = lastAt ? daysSince(lastAt) : null;
  const lastText = lastAt ? `${lastAt.getMonth() + 1}/${lastAt.getDate()}` : "기록 없음";
  const refreshTone: Tone = last?.status === "failed" ? "bad" : days !== null && days > 3 ? "bad" : days !== null ? "ok" : "warn";

  const sent = mailSent.count ?? 0;
  const total = mailAll.count ?? 0;
  const failed = mailFailed.count ?? 0;
  const rate = total > 0 ? `성공 ${Math.round((sent / total) * 100)}%` : "";

  return (
    <>
      <AttentionBox groups={attention} />

      <section className="card p-4">
        <h2 className="mb-2.5 text-[0.9375rem] font-medium">오늘 한눈에</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
          <Tile label="시스템 상태" value={latest.size === 0 ? "기록 없음" : failing.length === 0 ? "정상" : `${failing.length}곳 이상`} tone={failing.length ? "bad" : latest.size ? "ok" : "warn"} hint={latest.size ? `${latest.size}개 점검` : ""} />
          <Tile label="마지막 매물 갱신" value={lastText} hint={days === null ? "" : days === 0 ? "오늘" : `${days}일 전`} tone={refreshTone} />
          <Tile label="실행 중 에이전트" value={`${running.count ?? 0}개`} tone={(running.count ?? 0) > 0 ? "ok" : ""} hint={(running.count ?? 0) > 0 ? "가동 중" : "모두 대기"} />
          <Tile label="이번 달 메일" value={`${total}건`} hint={failed > 0 ? `실패 ${failed}건` : rate} tone={failed > 0 ? "warn" : "ok"} />
          <Tile label="새 개선 제안" value={`${candidates.count ?? 0}건`} hint={(urgent.count ?? 0) > 0 ? `긴급 ${urgent.count}건` : ""} tone={(urgent.count ?? 0) > 0 ? "bad" : ""} />
        </div>
        <p className="mt-2.5 text-xs text-faint">AI 사용량은 &quot;AI 사용량&quot; 화면을 만들 때 함께 연결해요.</p>
      </section>
    </>
  );
}

export default function AdminOverview() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
      <AdminOverviewContent />
    </Suspense>
  );
}
