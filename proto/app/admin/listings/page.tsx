// 관리자 "매물 갱신": 갱신(수집→비교→검증)이 잘 돌았는지 읽어서 보여 준다. 승인·반려 같은 바꾸는 버튼은 없다.
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { adviseScreen } from "@/lib/admin/playbook-files";
import { diffOf, fetchListingsInputs, listingsSignals, numberOrNull as num, stepOf as step, type ListingRun as Run } from "@/lib/admin/screen-advice";
import { createClient } from "@/lib/supabase/server";
import { AdviceBox } from "../_components/advice-box";

export const metadata: Metadata = { title: "매물 갱신 | DːON 관리자", robots: { index: false, follow: false } };

const DAY = 86_400_000;

// 지금 시각을 쓰는 계산은 화면 함수 밖에 둔다.
const daysSince = (date: Date) => Math.floor((Date.now() - date.getTime()) / DAY);


const STEP_LABEL: Record<string, string> = { quality_check: "품질 검사", diff: "변경 비교", validate: "검증", score: "점수", mail: "메일" };
const STEP_STATUS: Record<string, [string, string]> = {
  succeeded: ["성공", "bg-ok-soft text-ok"],
  skipped: ["건너뜀", "bg-soft text-muted"],
  held: ["보류", "bg-warn-soft text-warn"],
  failed: ["실패", "bg-bad-soft text-bad"],
  running: ["실행 중", "bg-ok-soft text-ok"],
  pending: ["대기", "bg-soft text-muted"],
};
const RUN_STATUS: Record<string, [string, string]> = {
  succeeded: ["성공", "bg-ok-soft text-ok"],
  failed: ["실패", "bg-bad-soft text-bad"],
  held: ["보류", "bg-warn-soft text-warn"],
  rejected: ["반려", "bg-bad-soft text-bad"],
  running: ["실행 중", "bg-ok-soft text-ok"],
};

const fmtNum = (value: unknown) => (num(value) === null ? "—" : (value as number).toLocaleString("ko-KR"));
const fmtDate = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function Badge({ map, status }: { map: Record<string, [string, string]>; status: string }) {
  const [text, cls] = map[status] ?? [status, "bg-soft text-muted"];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs ${cls}`}>{text}</span>;
}

function Tile({ label, value, hint, hintClass = "text-muted" }: { label: string; value: string; hint?: string; hintClass?: string }) {
  return (
    <div className="rounded-xl bg-soft px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5">
        <span className="text-xl font-medium">{value}</span>
        {hint && <span className={`ml-1.5 text-xs ${hintClass}`}>{hint}</span>}
      </p>
    </div>
  );
}


// 보류·실패·반려한 이유를 한 줄로
function reason(run: Run): string {
  if (run.status === "succeeded" || run.status === "running") return "";
  const quality = step(run, "quality_check")?.result;
  const parts: string[] = [];
  const change = num(quality?.change_pct);
  const missing = num(quality?.missing_pct);
  if (quality?.status === "held") {
    if (change !== null) parts.push(`수집 건수가 전보다 ${change}% 바뀜`);
    if (missing !== null) parts.push(`필수 항목 ${missing}% 누락`);
  }
  const failed = run.agent_steps.find((s) => s.status === "failed" && s.error);
  if (failed) parts.push(`${STEP_LABEL[failed.step_key] ?? failed.step_key} 단계 실패`);
  if (run.error) parts.push("실행 오류");
  return parts.join(" · ") || "이유 기록 없음";
}

async function AdminListingsContent() {
  await connection();
  const supabase = await createClient();
  const inputs = await fetchListingsInputs(supabase);
  const { runs, active } = inputs;

  const last = runs[0];
  const lastAt = last ? new Date(last.finished_at ?? last.started_at) : null;
  const days = lastAt ? daysSince(lastAt) : null;
  const lastDiff = runs.map(diffOf).find((d) => d !== null) ?? null;
  const held = runs.filter((run) => run.status === "held");

  // 다음에 할 일 제안: 규칙 파일(content/admin-playbook/매물갱신.md)이 읽는 숫자는 lib/admin/screen-advice.ts에서 만든다.
  const { advice, errors: adviceErrors } = await adviseScreen("listings", listingsSignals(inputs));

  return (
    <>
      {held.length > 0 && (
        <div className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn" role="alert">
          품질 검사에서 보류된 갱신이 {held.length}건 있어요. 보류된 매물은 아직 공개되지 않았어요. 승인·반려는 이 화면에서 하지 않아요.
        </div>
      )}
      {days !== null && days > 3 && (
        <div className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad" role="alert">
          매물 갱신이 {days}일째 멈춰 있어요. 마지막 갱신 {fmtDate(lastAt!.toISOString())}
        </div>
      )}
      {runs.length === 0 && <div className="rounded-xl bg-soft px-3.5 py-2.5 text-sm text-muted">아직 갱신 기록이 없어요.</div>}

      <AdviceBox advice={advice} errors={adviceErrors} scope="갱신 기록을 풀어서, 관리자가 지금 할 일을 정리했어요." />

      <section className="card p-4">
        <h2 className="mb-2.5 text-[0.9375rem] font-medium">갱신 현황</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
          <Tile label="마지막 갱신" value={lastAt ? fmtDate(lastAt.toISOString()) : "기록 없음"} hint={days === null ? "" : days === 0 ? "오늘" : `${days}일 전`} hintClass={days !== null && days > 3 ? "text-bad" : "text-ok"} />
          <Tile label="지금 공개 중인 매물" value={`${(active.count ?? 0).toLocaleString("ko-KR")}곳`} />
          <Tile label="최근 갱신 신규" value={fmtNum(lastDiff?.new)} />
          <Tile label="최근 갱신 바뀜" value={fmtNum(lastDiff?.changed)} />
          <Tile label="최근 갱신 나감" value={fmtNum(lastDiff?.gone)} />
        </div>
        <p className="mt-2.5 text-xs text-faint">신규·바뀜·나감은 숫자가 기록된 가장 최근 갱신 기준이에요.</p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2.5 text-[0.9375rem] font-medium">갱신 기록 (최근 {runs.length}번)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.8125rem]">
            <thead>
              <tr className="text-faint">
                {["시작", "결과", "신규", "바뀜", "나감", "그대로", "이유"].map((head) => (
                  <th key={head} scope="col" className="border-b border-line px-1.5 py-1.5 font-normal">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const diff = diffOf(run);
                return (
                  <tr key={run.id}>
                    <td className="whitespace-nowrap border-b border-line px-1.5 py-2">{fmtDate(run.started_at)}</td>
                    <td className="border-b border-line px-1.5 py-2"><Badge map={RUN_STATUS} status={run.status} /></td>
                    <td className="border-b border-line px-1.5 py-2 tabular-nums">{fmtNum(diff?.new)}</td>
                    <td className="border-b border-line px-1.5 py-2 tabular-nums">{fmtNum(diff?.changed)}</td>
                    <td className="border-b border-line px-1.5 py-2 tabular-nums">{fmtNum(diff?.gone)}</td>
                    <td className="border-b border-line px-1.5 py-2 tabular-nums">{fmtNum(diff?.unchanged)}</td>
                    <td className="border-b border-line px-1.5 py-2 text-muted">{reason(run)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {last && (
        <section className="card p-4">
          <h2 className="mb-2.5 text-[0.9375rem] font-medium">가장 최근 갱신의 단계 ({fmtDate(last.started_at)})</h2>
          <ol className="flex flex-wrap gap-2">
            {last.agent_steps.map((s) => (
              <li key={s.step_key} className="flex items-center gap-2 rounded-xl bg-soft px-3 py-2 text-[0.8125rem]">
                <span>{STEP_LABEL[s.step_key] ?? s.step_key}</span>
                <Badge map={STEP_STATUS} status={s.status} />
                {s.step_key === "score" && <span className="text-xs text-faint">점수는 5단계에서 연결돼요</span>}
              </li>
            ))}
          </ol>
          <p className="mt-2.5 text-xs text-faint">단계별 자세한 로그는 &quot;에이전트 실행&quot; 화면에서 볼 수 있어요.</p>
        </section>
      )}
    </>
  );
}

export default function AdminListings() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
      <AdminListingsContent />
    </Suspense>
  );
}
