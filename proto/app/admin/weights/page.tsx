// 관리자 "가중치 보정안": 점수 가중치를 바꾸자는 제안(보정안)과, 그 근거가 되는 사용자 평가가 얼마나 모였는지 읽어서 보여 준다(읽기만).
// 승인·반려는 점수·업종이 정해지는 5단계 뒤에 추가한다. 리뷰 원문과 회원 정보는 가져오지 않는다.
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { adviseScreen } from "@/lib/admin/playbook-files";
import { REASON_KEYS, REASON_LABEL, fetchWeightsInputs, weightsParts, weightsSignals, type FeedbackCheck } from "@/lib/admin/screen-advice";
import { createClient } from "@/lib/supabase/server";
import { AdviceBox } from "../_components/advice-box";

export const metadata: Metadata = { title: "가중치 보정안 | DːON 관리자", robots: { index: false, follow: false } };

const GROUP: Record<string, string> = { cost: "비용", space: "공간", location: "위치", fit: "업종 맞춤" };
const STATUS: Record<string, [string, string]> = {
  pending: ["승인 대기", "bg-warn-soft text-warn"],
  approved: ["승인", "bg-ok-soft text-ok"],
  rejected: ["반려", "bg-bad-soft text-bad"],
};
const CHECK: Record<string, [string, string]> = {
  pass: ["통과", "bg-ok-soft text-ok"],
  fail: ["미달", "bg-bad-soft text-bad"],
  pending: ["판단 보류", "bg-soft text-muted"],
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

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

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-soft px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5">
        <span className="text-xl font-medium">{value}</span>
        {hint && <span className="ml-1.5 text-xs text-muted">{hint}</span>}
      </p>
    </div>
  );
}

function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-soft">
        <div className={`h-full rounded-full ${value >= max ? "bg-ok" : "bg-accent"}`} style={{ width: `${ratio}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right tabular-nums">{value} / {max}</span>
    </div>
  );
}

function CheckLine({ ok, title, hint }: { ok: boolean; title: string; hint: string }) {
  return (
    <li className={`flex items-baseline gap-2 ${ok ? "text-ok" : "text-muted"}`}>
      <span aria-hidden="true">{ok ? "✓" : "·"}</span>
      <span>
        {title}
        <span className="ml-1.5 text-xs text-faint">{hint}</span>
      </span>
    </li>
  );
}

function CheckBox({ name, check }: { name: string; check: FeedbackCheck | undefined }) {
  return (
    <div className="rounded-xl bg-soft px-3.5 py-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        {name}
        {check ? <Badge map={CHECK} status={check.status} /> : <span className="text-xs font-normal text-faint">기록 없음</span>}
      </p>
      {check && (
        <p className="mt-1 text-xs text-muted">
          최근 7일 {check.total}건 중 {check.matched}건 일치{check.rate !== null ? `(${check.rate}%)` : ""} · 통과 기준 {check.pass_pct}% · 판단하려면 최소 {check.min_samples}건
        </p>
      )}
    </div>
  );
}

async function AdminWeightsContent() {
  await connection();
  const supabase = await createClient();
  const inputs = await fetchWeightsInputs(supabase);
  const parts = weightsParts(inputs);
  const { advice, errors: adviceErrors } = await adviseScreen("weights", weightsSignals(inputs));
  const pending = parts.proposals.filter((item) => item.status === "pending");
  const thresholdSet = parts.threshold !== null && parts.threshold !== undefined;
  const maxReason = Math.max(1, ...Object.values(parts.reasonCounts));

  return (
    <>
      <AdviceBox advice={advice} errors={adviceErrors} scope="보정안과 평가가 모이는 모습을 풀어서, 관리자가 지금 할 일을 정리했어요." />

      <section className="card p-4">
        <Heading title="보정안이 나오려면" know="왜 아직 보정안이 없는지, 무엇이 갖춰져야 하는지" />
        <ul className="flex flex-col gap-1.5 text-sm">
          <CheckLine ok={parts.categoryCount > 0} title={`업종 목록 ${parts.categoryCount}개`} hint={parts.categoryCount > 0 ? "" : "미확정 · 5단계에서 정해져요"} />
          <CheckLine ok={parts.activeVersions > 0} title={`켜진 점수 버전 ${parts.activeVersions}개`} hint={parts.activeVersions > 0 ? "" : "미확정 · 점수 엔진 연결 후"} />
          <CheckLine ok={thresholdSet} title={`보정안 기준 비율 ${thresholdSet ? `${String(parts.threshold)}%` : "미확정"}`} hint={thresholdSet ? "" : "스코어링 확정 때 정해요(설정값 화면)"} />
          <CheckLine ok={parts.withReason >= parts.minSamples} title={`평가 표본 ${parts.withReason}건`} hint={`보정안은 사유를 고른 싫어요 ${parts.minSamples}건·${parts.minUsers}명부터`} />
        </ul>
        <p className="mt-2.5 text-xs text-faint">위 네 가지가 모두 갖춰지면 주간 분석이 보정안을 만들어요.</p>
      </section>

      <section className="card p-4">
        <Heading title={`보정안 목록 (승인 대기 ${pending.length}건)`} know="어떤 업종에서 어떤 요소(비용·공간·위치·업종 맞춤)의 비중을 바꾸자는 제안이 있는지, 근거가 충분한지" />
        {parts.proposals.length === 0 ? (
          <p className="text-sm text-muted">아직 보정안이 없어요. 위 &quot;보정안이 나오려면&quot; 조건이 갖춰지면 여기에 나타나요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[0.8125rem]">
              <thead>
                <tr className="text-faint">
                  {["업종", "바꿀 요소", "근거", "조정 크기", "상태", "만든 날"].map((head) => (
                    <th key={head} scope="col" className="border-b border-line px-1.5 py-1.5 font-normal">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parts.proposals.map((item) => {
                  const category = Array.isArray(item.business_categories) ? item.business_categories[0]?.name : item.business_categories?.name;
                  const evidence = item.evidence ?? {};
                  return (
                    <tr key={item.id}>
                      <td className="border-b border-line px-1.5 py-2">{category ?? "—"}</td>
                      <td className="border-b border-line px-1.5 py-2">{GROUP[item.target_group] ?? item.target_group}</td>
                      <td className="border-b border-line px-1.5 py-2 text-xs text-muted">
                        표본 {evidence.samples ?? "—"}건 · 사용자 {evidence.users ?? "—"}명
                        {typeof evidence.top_pct === "number" && ` · 최다 사유 ${evidence.top_pct}%`}
                        {typeof evidence.good_ratio === "number" && ` · 좋아요 ${evidence.good_ratio}%`}
                        {item.small_sample && <span className="ml-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-warn">표본 적음</span>}
                      </td>
                      <td className="border-b border-line px-1.5 py-2 text-muted">미확정</td>
                      <td className="border-b border-line px-1.5 py-2">
                        <Badge map={STATUS} status={item.status} />
                        {item.review_reason && <span className="mt-0.5 block text-xs text-muted">이유: {item.review_reason}</span>}
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-1.5 py-2 text-muted">{fmtDate(item.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2.5 text-xs text-faint">승인·반려 버튼은 점수와 업종이 정해지는 5단계 뒤에 추가해요. 조정 크기도 그때 정해져요.</p>
      </section>

      <section className="card p-4">
        <Heading title="평가가 모이는 현황 (전체)" know="사용자 평가가 몇 건 쌓였는지, 싫어요 이유가 어디에 몰리는지, 보정안에 필요한 표본까지 얼마나 남았는지" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
          <Tile label="전체 평가" value={`${parts.total.toLocaleString("ko-KR")}건`} />
          <Tile label="좋아요" value={`${parts.good.toLocaleString("ko-KR")}건`} hint={parts.total > 0 ? `${pct(parts.good, parts.total)}%` : ""} />
          <Tile label="싫어요" value={`${parts.bad.toLocaleString("ko-KR")}건`} />
          <Tile label="사유를 고른 싫어요" value={`${parts.withReason.toLocaleString("ko-KR")}건`} />
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <Progress value={parts.withReason} max={parts.minSamples} label="보정안 표본" />
        </div>
        <h3 className="mb-1.5 mt-4 text-[0.8125rem] font-medium text-muted">싫어요 이유 분포</h3>
        {parts.withReason === 0 ? (
          <p className="text-xs text-faint">사유를 고른 싫어요가 아직 없어요.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {REASON_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0">{REASON_LABEL[key]}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-soft">
                  <div className={`h-full rounded-full ${key === "info_error" ? "bg-warn" : "bg-accent"}`} style={{ width: `${(parts.reasonCounts[key] / maxReason) * 100}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted">{parts.reasonCounts[key]}건 ({pct(parts.reasonCounts[key], parts.withReason)}%)</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2.5 text-xs text-faint">업종이 아직 정해지지 않아 전체 평가를 한 묶음으로 보여 줘요. 한 사람이 여러 이유를 고르면 이유마다 세요. 사용자 수와 회원 정보는 보여 주지 않아요.</p>
      </section>

      <section className="card p-4">
        <Heading title="주간 분석 결과" know="업종별로 평가가 얼마나 모였고 보정안 조건에 가까운지, AI가 분류한 사유가 믿을 만한지" />
        {!parts.report ? (
          <p className="text-sm text-muted">주간 분석이 아직 돌지 않아서 결과가 없어요. 주간 분석이 돌면 여기에 나타나요.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">{parts.reportAt ? `${fmtDate(parts.reportAt)} 분석 기준` : ""}</p>
            {parts.report.categories?.length > 0 ? (
              <div className="mb-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-[0.8125rem]">
                  <thead>
                    <tr className="text-faint">
                      {["업종", "평가", "좋아요", "표본 진행", "사용자 진행", "보정안 조건"].map((head) => (
                        <th key={head} scope="col" className="border-b border-line px-1.5 py-1.5 font-normal">{head}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parts.report.categories.map((category) => (
                      <tr key={category.category}>
                        <td className="border-b border-line px-1.5 py-2">{category.category}</td>
                        <td className="border-b border-line px-1.5 py-2 tabular-nums">{category.total}건</td>
                        <td className="border-b border-line px-1.5 py-2 tabular-nums">{category.good_ratio ?? "—"}{category.good_ratio !== null ? "%" : ""}</td>
                        <td className="border-b border-line px-1.5 py-2 tabular-nums">{category.progress.samples} / {category.progress.min_samples}</td>
                        <td className="border-b border-line px-1.5 py-2 tabular-nums">{category.progress.users} / {category.progress.min_users}</td>
                        <td className="border-b border-line px-1.5 py-2">{category.ready ? <span className="text-ok">갖춰짐</span> : <span className="text-muted">모으는 중</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mb-4 text-sm text-muted">업종이 아직 없어서 업종별 결과가 없어요.</p>
            )}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <CheckBox name="AI 분류 vs 회원이 고른 사유" check={parts.report.checks?.first} />
              <CheckBox name="AI끼리 분류 비교" check={parts.report.checks?.second} />
            </div>
          </>
        )}
      </section>
    </>
  );
}

export default function AdminWeights() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
      <AdminWeightsContent />
    </Suspense>
  );
}
