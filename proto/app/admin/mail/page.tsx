// 관리자 "메일 발송": 발송 성공률·실패·미룸·수신 거부 수를 숫자로 보여 준다(읽기만). 메일 주소·제목·본문은 다루지 않는다.
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { adviseScreen } from "@/lib/admin/playbook-files";
import { fetchMailInputs, mailSignals, type MailRow } from "@/lib/admin/screen-advice";
import { maskSensitive } from "@/lib/monitor/checks";
import { createClient } from "@/lib/supabase/server";
import { AdviceBox } from "../_components/advice-box";

export const metadata: Metadata = { title: "메일 발송 | DːON 관리자", robots: { index: false, follow: false } };

const KIND: Record<string, string> = { first_recommendation: "첫 추천 메일", subscriber_batch: "구독 회원 메일", unsubscribe_result: "수신 거부 안내", consent_reminder: "동의 안내" };
const STATUS: Record<string, [string, string]> = {
  sent: ["발송", "bg-ok-soft text-ok"],
  failed: ["실패", "bg-bad-soft text-bad"],
  deferred: ["아침으로 미룸", "bg-warn-soft text-warn"],
  queued: ["대기", "bg-soft text-muted"],
  preview: ["미리보기", "bg-soft text-muted"],
  suppressed: ["보내지 않음", "bg-soft text-muted"],
};

type Row = MailRow;
type Tone = "ok" | "warn" | "bad" | "";
const toneText: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", "": "text-muted" };

const rate = (sent: number, failed: number) => (sent + failed === 0 ? null : Math.round((sent / (sent + failed)) * 100));
const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

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

function Badge({ status }: { status: string }) {
  const [text, cls] = STATUS[status] ?? [status, "bg-soft text-muted"];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs ${cls}`}>{text}</span>;
}

async function AdminMailContent() {
  await connection();
  const supabase = await createClient();
  const inputs = await fetchMailInputs(supabase);
  const { t, rowsRes, recent, waiting, overdue, unsubWeek, unsubPrev, consenting, minPct } = inputs;
  const rows = (rowsRes.data ?? []) as Row[];
  const month = rows.filter((row) => row.created_at >= t.monthStart);
  const last24 = rows.filter((row) => row.created_at >= t.since24h);
  const count = (list: Row[], status: string) => list.filter((row) => row.status === status).length;
  const limit = typeof minPct.data?.value === "number" ? minPct.data.value : 95;

  const monthSent = count(month, "sent");
  const monthFailed = count(month, "failed");
  const dayRate = rate(count(last24, "sent"), count(last24, "failed"));
  const monthRate = rate(monthSent, monthFailed);
  const unsubNow = unsubWeek.count ?? 0;
  const unsubBefore = unsubPrev.count ?? 0;

  // 다음에 할 일 제안: 규칙 파일(content/admin-playbook/메일발송.md)이 읽는 숫자는 lib/admin/screen-advice.ts에서 만든다.
  const { advice, errors: adviceErrors } = await adviseScreen("mail", mailSignals(inputs));

  const bars = t.days.map((day, i) => {
    const end = i === t.days.length - 1 ? Infinity : t.days[i + 1].start;
    const inDay = rows.filter((row) => {
      const at = new Date(row.created_at).getTime();
      return at >= day.start && at < end;
    });
    return { label: day.label, sent: count(inDay, "sent"), failed: count(inDay, "failed") };
  });
  const maxBar = Math.max(1, ...bars.map((bar) => bar.sent + bar.failed));

  const kinds = Object.keys(KIND).map((kind) => {
    const list = month.filter((row) => row.kind === kind);
    return { kind, sent: count(list, "sent"), failed: count(list, "failed"), skipped: count(list, "suppressed") };
  });

  return (
    <>
      {dayRate !== null && dayRate < limit && (
        <div className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad" role="alert">
          최근 24시간 메일 성공률이 {dayRate}%예요. 기준 {limit}%보다 낮아요.
        </div>
      )}
      {(overdue.count ?? 0) > 0 && (
        <div className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad" role="alert">
          아침으로 미룬 메일 {overdue.count}통이 예정 시각을 1시간 넘게 지나도 나가지 않았어요. 발송이 멈췄는지 확인이 필요해요.
        </div>
      )}
      {monthFailed > 0 && (
        <div className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn">이번 달 실패한 메일이 {monthFailed}통 있어요.</div>
      )}
      {(waiting.count ?? 0) > 0 && (overdue.count ?? 0) === 0 && (
        <div className="rounded-xl bg-soft px-3.5 py-2.5 text-sm text-muted">보내기를 기다리는 메일이 {waiting.count}통 있어요. 밤 9시~아침 8시에 모인 메일은 아침에 나가요.</div>
      )}

      <AdviceBox advice={advice} errors={adviceErrors} scope="발송 숫자를 풀어서, 관리자가 지금 할 일을 정리했어요." />

      <section className="card p-4">
        <h2 className="mb-2.5 text-[0.9375rem] font-medium">이번 달 한눈에</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2.5">
          <Tile label="발송 성공" value={`${monthSent.toLocaleString("ko-KR")}통`} />
          <Tile label="성공률 (이번 달)" value={monthRate === null ? "—" : `${monthRate}%`} tone={monthRate !== null && monthRate < limit ? "bad" : "ok"} hint={monthRate === null ? "발송 없음" : ""} />
          <Tile label="성공률 (최근 24시간)" value={dayRate === null ? "—" : `${dayRate}%`} tone={dayRate !== null && dayRate < limit ? "bad" : "ok"} hint={dayRate === null ? "발송 없음" : `기준 ${limit}%`} />
          <Tile label="실패" value={`${monthFailed}통`} tone={monthFailed > 0 ? "warn" : ""} />
          <Tile label="대기·미룸" value={`${waiting.count ?? 0}통`} tone={(overdue.count ?? 0) > 0 ? "bad" : ""} hint={(overdue.count ?? 0) > 0 ? "지연" : ""} />
          <Tile label="수신 거부 (최근 7일)" value={`${unsubNow}명`} tone={unsubBefore > 0 && unsubNow >= unsubBefore * 2 ? "warn" : ""} hint={`전주 ${unsubBefore}명`} />
          <Tile label="수신 동의 중" value={`${(consenting.count ?? 0).toLocaleString("ko-KR")}명`} />
        </div>
        <p className="mt-2.5 text-xs text-faint">성공률 = 발송 ÷ (발송 + 실패). 미룸·대기·보내지 않음은 계산에서 빠져요. 시험 모드 발송도 &quot;발송&quot;으로 세어져요.</p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2.5 text-[0.9375rem] font-medium">종류별 (이번 달)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.8125rem]">
            <thead>
              <tr className="text-faint">
                {["종류", "발송", "실패", "보내지 않음"].map((head) => (
                  <th key={head} scope="col" className="border-b border-line px-1.5 py-1.5 font-normal">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kinds.map((row) => (
                <tr key={row.kind}>
                  <td className="border-b border-line px-1.5 py-2">{KIND[row.kind]}</td>
                  <td className="border-b border-line px-1.5 py-2 tabular-nums">{row.sent}</td>
                  <td className={`border-b border-line px-1.5 py-2 tabular-nums ${row.failed > 0 ? "text-bad" : ""}`}>{row.failed}</td>
                  <td className="border-b border-line px-1.5 py-2 tabular-nums">{row.skipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-2.5 text-[0.9375rem] font-medium">최근 14일 발송</h2>
        <div className="flex h-28 items-end gap-1.5" role="img" aria-label={`최근 14일 발송 수. 가장 많은 날 ${maxBar}통`}>
          {bars.map((bar) => (
            <div key={bar.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${bar.label} 발송 ${bar.sent}, 실패 ${bar.failed}`}>
              <div className="flex w-full flex-col justify-end" style={{ height: `${((bar.sent + bar.failed) / maxBar) * 100}%` }}>
                {bar.failed > 0 && <div className="w-full bg-bad" style={{ flexGrow: bar.failed, minHeight: 2 }} />}
                {bar.sent > 0 && <div className="w-full bg-accent" style={{ flexGrow: bar.sent, minHeight: 2 }} />}
              </div>
              <span className="text-[0.625rem] text-faint">{bar.label.split("/")[1]}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 flex gap-3 text-xs text-muted">
          <span><i className="mr-1 inline-block size-2 rounded-sm bg-accent" />발송</span>
          <span><i className="mr-1 inline-block size-2 rounded-sm bg-bad" />실패</span>
          <span className="text-faint">날짜는 한국 시간 기준이에요.</span>
        </p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2.5 text-[0.9375rem] font-medium">최근 발송 기록 (20건)</h2>
        {(recent.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">아직 발송 기록이 없어요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[0.8125rem]">
              <thead>
                <tr className="text-faint">
                  {["시각", "종류", "상태", "실패 이유"].map((head) => (
                    <th key={head} scope="col" className="border-b border-line px-1.5 py-1.5 font-normal">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(recent.data ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap border-b border-line px-1.5 py-2">{fmt(row.created_at)}</td>
                    <td className="border-b border-line px-1.5 py-2">{KIND[row.kind] ?? row.kind}</td>
                    <td className="border-b border-line px-1.5 py-2"><Badge status={row.status} /></td>
                    <td className="border-b border-line px-1.5 py-2 text-muted">{row.status === "failed" ? (maskSensitive(row.error) ?? "이유 기록 없음") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2.5 text-xs text-faint">메일 주소, 제목, 본문은 보여 주지 않아요. 실패 이유에 주소가 섞여 있으면 가려서 보여 줘요.</p>
      </section>
    </>
  );
}

export default function AdminMail() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">불러오는 중…</p>}>
      <AdminMailContent />
    </Suspense>
  );
}
