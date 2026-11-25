// 관리자 "품질·개선 제안": 주간 품질 리포트와 개선 후보를 읽어서 보여 준다(읽기만). 후보 처리 버튼은 실서비스 전에 추가한다.
// 리뷰 원문은 가져오지 않고 근거 개수만 보여 준다.
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { adviseScreen } from "@/lib/admin/playbook-files";
import { fetchQualityInputs, qualityParts, qualitySignals, type Candidate, type QualityMetric } from "@/lib/admin/screen-advice";
import { createClient } from "@/lib/supabase/server";
import { AdviceBox } from "../_components/advice-box";

export const metadata: Metadata = { title: "품질·개선 제안 | DːON 관리자", robots: { index: false, follow: false } };

const AGENTS: [string, string][] = [
  ["collect", "수집"],
  ["verify", "검증"],
  ["scoring", "채점"],
  ["feedback", "피드백"],
  ["mail", "메일"],
  ["monitor", "모니터링"],
];
const STATUS: Record<string, [string, string]> = {
  ok: ["정상", "bg-ok-soft text-ok"],
  warn: ["주의", "bg-warn-soft text-warn"],
  pending: ["판단 보류", "bg-soft text-muted"],
  unmeasured: ["측정 전", "bg-soft text-muted"],
  info: ["참고", "bg-soft text-muted"],
};
const SOURCE: Record<string, string> = { quality: "품질 지표", review: "리뷰 묶음", urgent: "긴급" };
const CANDIDATE_STATUS: Record<string, [string, string]> = {
  candidate: ["후보", "bg-accent-soft text-accent"],
  held: ["보류", "bg-warn-soft text-warn"],
  adopted: ["채택", "bg-ok-soft text-ok"],
  rejected: ["반려", "bg-bad-soft text-bad"],
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
const fmtValue = (metric: QualityMetric) => (typeof metric.value === "number" ? `${Number.isInteger(metric.value) ? metric.value.toLocaleString("ko-KR") : Math.round(metric.value * 10) / 10}${metric.unit ?? ""}` : "—");
const fmtChange = (metric: QualityMetric) => {
  if (typeof metric.change !== "number") return "—";
  const rounded = Math.round(metric.change * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}${metric.unit ?? ""}`;
};

function Badge({ map, status }: { map: Record<string, [string, string]>; status: string }) {
  const [text, cls] = map[status] ?? [status, "bg-soft text-muted"];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs ${cls}`}>{text}</span>;
}

function Heading({ title, know }: { title: string; know: string }) {
  return (
    <div className="mb-2.5">
      <h2 className="text-[0.9375rem] font-medium">{title}</h2>
      <p className="text-xs text-muted">알 수 있는 것: {know}</p>
    </div>
  );
}

function Tile({ label, value, hint, tone = "" }: { label: string; value: string; hint?: string; tone?: "bad" | "warn" | "" }) {
  return (
    <div className="rounded-xl bg-soft px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5">
        <span className="text-xl font-medium">{value}</span>
        {hint && <span className={`ml-1.5 text-xs ${tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-muted"}`}>{hint}</span>}
      </p>
    </div>
  );
}

function CandidateRow({ item }: { item: Candidate }) {
  return (
    <li className={`rounded-xl border px-3.5 py-3 text-sm ${item.urgent ? "border-bad bg-bad-soft" : "border-line bg-soft"}`}>
      <p className="flex flex-wrap items-center gap-2 font-medium">
        {item.urgent && <span className="rounded-full bg-bad px-2 py-0.5 text-[11px] text-white">긴급</span>}
        <Badge map={CANDIDATE_STATUS} status={item.status} />
        <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted">{SOURCE[item.source] ?? item.source}</span>
        {item.title}
      </p>
      {item.detail && <p className="mt-1.5 text-xs text-muted">{item.detail}</p>}
      <p className="mt-1.5 text-xs text-muted">
        올라온 날 {fmtDate(item.created_at)}
        {item.users_count > 0 && ` · 사용자 ${item.users_count}명`}
        {item.evidence_count > 0 && ` · 근거 ${item.evidence_count}건`}
        {item.streak > 1 && ` · ${item.streak}주 연속`}
        {item.reason && ` · 이유: ${item.reason}`}
      </p>
    </li>
  );
}

async function AdminQualityContent() {
  await connection();
  const supabase = await createClient();
  const inputs = await fetchQualityInputs(supabase);
  const { reports, real, testCount } = qualityParts(inputs);
  const { advice, errors: adviceErrors } = await adviseScreen("quality", qualitySignals(inputs));
  const latest = reports[0];
  const open = real.filter((item) => item.status === "candidate" || item.status === "held").sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.created_at.localeCompare(a.created_at));
  const closed = real.filter((item) => item.status === "adopted" || item.status === "rejected");
  const metrics = latest?.metrics ?? [];
  const warns = metrics.filter((item) => item.status === "warn").length;
  const pending = metrics.filter((item) => item.status === "pending" || item.status === "unmeasured").length;

  return (
    <>
      <AdviceBox advice={advice} errors={adviceErrors} scope="품질 리포트와 개선 후보를 풀어서, 관리자가 지금 할 일을 정리했어요." />

      <section className="card p-4">
        <Heading title="한눈에" know="이번 주 문제가 있는 지표가 몇 개인지, 처리할 후보가 얼마나 쌓였는지" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
          <Tile label="최근 리포트" value={latest ? fmtDate(latest.created_at) : "없음"} />
          <Tile label="주의 지표" value={`${warns}건`} tone={warns > 0 ? "warn" : ""} hint={latest ? `전체 ${metrics.length}개` : ""} />
          <Tile label="판단 보류·측정 전" value={`${pending}건`} />
          <Tile label="열린 개선 후보" value={`${open.length}건`} hint={open.some((item) => item.urgent) ? `긴급 ${open.filter((item) => item.urgent).length}건` : ""} tone={open.some((item) => item.urgent) ? "bad" : ""} />
          <Tile label="처리된 후보" value={`${closed.length}건`} hint="채택·반려" />
        </div>
      </section>

      <section className="card p-4">
        <Heading title="이번 주 품질 리포트" know="수집·검증·채점·피드백·메일·모니터링이 기준 안에 있는지, 지난주보다 나아졌는지" />
        {!latest ? (
          <p className="text-sm text-muted">아직 품질 리포트가 없어요. 주간 분석이 돌면 매주 한 장씩 만들어져요.</p>
        ) : (
          <>
            <p className="mb-3 rounded-xl bg-soft px-3.5 py-2.5 text-sm">
              <span className="mr-2 text-xs text-muted">{fmtDate(latest.created_at)} 리포트</span>
              {latest.summary}
              {latest.before_collection && <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted">실제 수집 전</span>}
            </p>
            <div className="flex flex-col gap-4">
              {AGENTS.map(([key, name]) => {
                const list = metrics.filter((item) => item.agent === key);
                if (list.length === 0) return null;
                return (
                  <div key={key}>
                    <h3 className="mb-1 text-[0.8125rem] font-medium text-muted">{name}</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left text-[0.8125rem]">
                        <thead>
                          <tr className="text-faint">
                            {["지표", "값", "기준", "지난주", "변화", "상태"].map((head) => (
                              <th key={head} scope="col" className="border-b border-line px-1.5 py-1.5 font-normal">{head}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((metric) => (
                            <tr key={`${metric.agent}-${metric.key}`}>
                              <td className="border-b border-line px-1.5 py-2">
                                {metric.label}
                                {metric.detail && <span className="block text-xs text-muted">{metric.detail}</span>}
                              </td>
                              <td className="whitespace-nowrap border-b border-line px-1.5 py-2 tabular-nums">{fmtValue(metric)}</td>
                              <td className="border-b border-line px-1.5 py-2 text-muted">{metric.threshold ?? "—"}</td>
                              <td className="whitespace-nowrap border-b border-line px-1.5 py-2 tabular-nums text-muted">{typeof metric.previous === "number" ? `${metric.previous}${metric.unit ?? ""}` : "—"}</td>
                              <td className="whitespace-nowrap border-b border-line px-1.5 py-2 tabular-nums text-muted">{fmtChange(metric)}</td>
                              <td className="border-b border-line px-1.5 py-2">
                                <Badge map={STATUS} status={metric.status} />
                                {metric.status === "warn" && (metric.streak ?? 0) > 1 && <span className="ml-1.5 text-xs text-warn">{metric.streak}주 연속</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2.5 text-xs text-faint">비율 지표는 표본이 적으면 &quot;판단 보류&quot;로 보여요. 매물 수집 전에는 대부분 &quot;측정 전&quot;이에요.</p>
          </>
        )}
      </section>

      <section className="card p-4">
        <Heading title="지난 리포트" know="주의 항목이 늘고 있는지, 줄고 있는지 (최근 8번)" />
        {reports.length === 0 ? (
          <p className="text-sm text-muted">아직 기록이 없어요.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-[0.8125rem]">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="w-12 shrink-0 text-muted">{fmtDate(report.created_at)}</span>
                <span className="shrink-0 tabular-nums">{report.warnings.length > 0 ? `주의 ${report.warnings.length}건` : "주의 없음"}</span>
                <span className="min-w-0 flex-1 text-xs text-muted">{report.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <Heading title="개선 후보" know="무엇을 먼저 고치면 좋은지(긴급이 맨 위), 몇 명이 같은 요청을 했는지, 어떤 근거가 모였는지" />
        {open.length === 0 ? (
          <p className="text-sm text-muted">열려 있는 개선 후보가 없어요.</p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {open.map((item) => (
              <CandidateRow key={item.id} item={item} />
            ))}
          </ol>
        )}
        {closed.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted">처리된 후보 {closed.length}건 보기</summary>
            <ol className="mt-2 flex flex-col gap-2.5">
              {closed.slice(0, 5).map((item) => (
                <CandidateRow key={item.id} item={item} />
              ))}
            </ol>
          </details>
        )}
        <p className="mt-2.5 text-xs text-faint">
          후보를 채택·보류·반려하는 버튼은 아직 없어요(실서비스 전에 추가해요). 리뷰 원문은 보여 주지 않고 근거 개수만 보여 줘요.
          {testCount > 0 && ` 시험용(가짜 묶기) 후보 ${testCount}건은 목록에서 뺐어요.`}
        </p>
      </section>
    </>
  );
}

export default function AdminQuality() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
      <AdminQualityContent />
    </Suspense>
  );
}
