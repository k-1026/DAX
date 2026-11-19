// 관리자 전용 시스템 모니터링: 서비스 상태, 오케스트레이터·서브에이전트, 매물 갱신, 스코어링 버전, 리뷰, 메일링
// 관리자는 .env.local 의 ADMIN_EMAILS(쉼표로 구분)에 적힌 이메일로 로그인한 사람이다.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AGENTS, MAIL, NEXT_PROPOSAL, ORCHESTRATOR, REVIEWS, UPTIME_30D, type Agent } from "@/lib/admin-data";
import { dataMeta } from "@/lib/engine";
import { GROUPS, GU_LIST, INDUSTRIES } from "@/lib/listings";
import { getViewer } from "@/lib/viewer";
import { Icon, TopBar } from "../_components/ui";
import { LogViewer } from "./log-viewer";

type Check = { name: string; ok: boolean | "warn"; detail: string; ms?: number; live: boolean };

async function timed(url: string, headers: Record<string, string>) {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(4000) });
    return { status: res.status, ms: Date.now() - t };
  } catch {
    return { status: 0, ms: Date.now() - t };
  }
}

async function runChecks(): Promise<{ checks: Check[]; elapsed: number; at: string; now: number }> {
  const t0 = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const checks: Check[] = [{ name: "웹 서버 (Next.js)", ok: true, detail: "이 페이지를 정상적으로 그렸어요", live: true }];

  if (url && key) {
    const [auth, rest] = await Promise.all([
      timed(`${url}/auth/v1/health`, { apikey: key }),
      timed(`${url}/rest/v1/`, { apikey: key }),
    ]);
    checks.push({
      name: "Supabase 로그인(Auth)",
      ok: auth.status === 200,
      detail: auth.status ? `응답 코드 ${auth.status}` : "접속 실패",
      ms: auth.ms,
      live: true,
    });
    checks.push({
      name: "Supabase 데이터베이스",
      ok: rest.status > 0 && rest.status < 500,
      detail: rest.status ? `접속 가능 · 응답 코드 ${rest.status}` : "접속 실패",
      ms: rest.ms,
      live: true,
    });
  } else {
    checks.push({ name: "Supabase", ok: false, detail: ".env.local 에 Supabase 값이 없어요", live: true });
  }

  const env = (k: string, name: string, what: string) =>
    checks.push({ name, ok: process.env[k] ? true : "warn", detail: process.env[k] ? `${k} 설정됨` : `${k} 미설정 · ${what}`, live: true });
  env("ANTHROPIC_API_KEY", "Claude API (오케스트레이터)", "AI 추천이 샘플로 동작 중");
  env("MAIL_API_KEY", "메일 발송 서비스", "추천 메일 발송 불가");
  env("CRON_SECRET", "예약 작업 (3일 갱신)", "자동 갱신 미연결");
  const at = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return { checks, elapsed: Date.now() - t0, at, now: Date.now() };
}

const STATUS: Record<Agent["status"], { label: string; cls: string }> = {
  running: { label: "실행 중", cls: "bg-tile-blue text-accent" },
  ok: { label: "정상", cls: "bg-ok-soft text-ok" },
  waiting: { label: "대기", cls: "bg-warn-soft text-warn" },
  error: { label: "오류", cls: "bg-bad-soft text-bad" },
};

function Card({ title, sub, children, className = "" }: { title: string; sub?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel p-5 ${className}`}>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </header>
      {children}
    </section>
  );
}

function Kpi({ label, value, note, tile }: { label: string; value: string; note: string; tile: string }) {
  return (
    <div className={`rounded-2xl p-4 ${tile}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{note}</p>
    </div>
  );
}

async function Dashboard() {
  await connection(); // 요청마다 새로 점검
  const { checks, elapsed, at, now } = await runChecks();
  const meta = dataMeta();
  const ageDays = Math.floor((now - Date.parse(`${meta.date}T00:00:00+09:00`)) / 86400000);
  const maxGu = Math.max(...Object.values(meta.byGu));
  const bad = checks.filter((c) => c.ok === false).length;
  const warn = checks.filter((c) => c.ok === "warn").length;
  const downMinutes = 14; // 샘플: 11/01 장애 14분
  const uptime = ((1 - downMinutes / (UPTIME_30D.length * 1440)) * 100).toFixed(2);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 pb-10 sm:px-6">
      {/* 상단 요약 */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-5">
        <span className={`grid size-11 place-items-center rounded-full ${bad ? "bg-bad-soft text-bad" : warn ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>
          <Icon name={bad ? "close" : "check"} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-medium leading-tight">
            {bad ? `장애 ${bad}건 확인 필요` : warn ? `정상 운영 중 · 설정 필요 ${warn}건` : "모든 시스템 정상"}
          </h1>
          <p className="text-sm text-muted">점검 시각 {at} · 점검 {elapsed}ms</p>
        </div>
        <a href="" className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm hover:bg-soft">
          <Icon name="refresh" size={16} /> 다시 점검
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="30일 가동률" value={`${uptime}%`} note="장애 1회 · 11/01 14분" tile="bg-tile-green" />
        <Kpi label="추천 응답 p95" value="312ms" note="기준 1,500ms" tile="bg-tile-blue" />
        <Kpi label="오늘 추천 요청" value="2,184" note="회원 61% · 비회원 39%" tile="bg-tile-yellow" />
        <Kpi label="추천 만족도" value="4.3 / 5" note="샘플 · 리뷰 기능 연결 전" tile="bg-tile-purple" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 서비스 상태 */}
        <Card title="서비스 상태" sub="실시간 점검" className="lg:col-span-1">
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.name} className="flex items-start gap-3 rounded-xl bg-soft px-3 py-2.5">
                <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${c.ok === true ? "bg-ok" : c.ok === "warn" ? "bg-warn" : "bg-bad"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted">{c.detail}</p>
                </div>
                {c.ms !== undefined && <span className="text-xs tabular-nums text-faint">{c.ms}ms</span>}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <p className="mb-2 text-xs text-muted">최근 30일 (샘플)</p>
            <div className="flex gap-[3px]" role="img" aria-label="최근 30일 중 장애 1일, 지연 2일, 나머지 정상">
              {UPTIME_30D.map((d, i) => (
                <span key={i} title={`${i + 1}일 전 · ${d}`} className={`h-7 flex-1 rounded-[3px] ${d === "ok" ? "bg-ok" : d === "warn" ? "bg-warn" : "bg-bad"}`} style={{ opacity: d === "ok" ? 0.55 : 1 }} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-faint">
              <span>30일 전</span>
              <span>오늘</span>
            </div>
          </div>
        </Card>

        {/* 오케스트레이터 + 서브에이전트 */}
        <Card title="오케스트레이터 · 서브에이전트" sub="샘플 데이터" className="lg:col-span-2">
          <div className="rounded-2xl border border-line bg-tile-blue p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-panel text-accent">
                <Icon name="agent" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{ORCHESTRATOR.name}</p>
                <p className="text-xs text-muted">{ORCHESTRATOR.role}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs ${STATUS[ORCHESTRATOR.status].cls}`}>{STATUS[ORCHESTRATOR.status].label}</span>
            </div>
            <p className="mt-2 text-xs text-muted">{ORCHESTRATOR.detail}</p>
          </div>
          <div className="ml-5 border-l-2 border-dashed border-line pl-4 pt-3">
            <ul className="grid gap-2 sm:grid-cols-2">
              {AGENTS.map((a) => (
                <li key={a.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{a.name} 에이전트</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{a.role}</p>
                  <p className="mt-2 text-xs">{a.detail}</p>
                  <p className="mt-1 text-[11px] text-faint">
                    최근 {a.lastRun} ({a.duration}) · 다음 {a.nextRun}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 매물 갱신 (실제 데이터 기준) */}
        <Card title="매물 데이터" sub="3일 주기 갱신 예정">
          <div className="flex items-center gap-4">
            <div className={`grid size-20 shrink-0 place-items-center rounded-full ${ageDays > 3 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>
              <span className="text-center text-xs leading-tight">
                <b className="block text-lg font-medium">{ageDays}일</b>지난 데이터
              </span>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex gap-2"><dt className="w-16 text-muted">기준일</dt><dd>{meta.date}</dd></div>
              <div className="flex gap-2"><dt className="w-16 text-muted">전체</dt><dd>{meta.total.toLocaleString()}건</dd></div>
              <div className="flex gap-2"><dt className="w-16 text-muted">좌표 없음</dt><dd>{meta.noCoord}건 (지도에서 빠짐)</dd></div>
            </dl>
          </div>
          {ageDays > 3 && (
            <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">
              갱신 주기(3일)를 넘겼어요. 자동 수집이 아직 연결되지 않아 데모 데이터를 쓰는 중입니다.
            </p>
          )}
          <ul className="mt-4 space-y-1.5 text-xs">
            {GU_LIST.map((g) => (
              <li key={g} className="grid grid-cols-[44px_1fr_40px] items-center gap-2">
                <span className="text-muted">{g}</span>
                <span className="h-2 overflow-hidden rounded-full bg-soft">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${((meta.byGu[g] ?? 0) / maxGu) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">{meta.byGu[g] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* 메일링 */}
        <Card title="추천 메일링" sub={`다음 발송 ${MAIL.nextSend}`}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-muted">구독자</p><p className="text-xl font-medium">{MAIL.subscribers.toLocaleString()}</p></div>
            <div><p className="text-xs text-muted">최근 캠페인</p><p className="text-xl font-medium">{MAIL.lastCampaign}</p></div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            {[["열람률", MAIL.openRate], ["클릭률", MAIL.clickRate], ["수신 거부", MAIL.unsub]].map(([k, v]) => (
              <div key={k as string} className="grid grid-cols-[64px_1fr_48px] items-center gap-2">
                <span className="text-muted">{k}</span>
                <span className="h-2 overflow-hidden rounded-full bg-soft"><span className="block h-full rounded-full bg-accent" style={{ width: `${v}%` }} /></span>
                <span className="text-right tabular-nums">{v}%</span>
              </div>
            ))}
          </div>
          <Link href="/mail-preview" className="mt-4 flex items-center justify-between rounded-xl border border-line px-4 py-2.5 text-sm hover:bg-soft">
            다음 메일 미리보기 <Icon name="chevron" size={18} />
          </Link>
        </Card>

        {/* 최근 리뷰 */}
        <Card title="최근 리뷰" sub="리뷰 분석 에이전트 입력">
          <ul className="space-y-3">
            {REVIEWS.map((r) => (
              <li key={r.text} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">{r.who}</span>
                  <span className="text-xs text-warn" aria-label={`별점 ${r.stars}점`}>{"★".repeat(r.stars)}<span className="text-line">{"★".repeat(5 - r.stars)}</span></span>
                </div>
                <p className="mt-0.5">{r.text}</p>
                <p className="mt-0.5 text-[11px] text-faint">{r.tag} · {r.at}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* 스코어링 규칙 (실제 적용 중인 값) */}
      <Card title={`점수 규칙 ${meta.version} · 업종별 그룹 가중치`} sub="실제 적용 중 · 리뷰·선호를 반영해 3일마다 검토 예정">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 font-normal">업종</th>
                {GROUPS.map((g) => (
                  <th key={g.key} className="py-2 font-normal">{g.label}</th>
                ))}
                <th className="py-2 font-normal">보통 넓이</th>
                <th className="py-2 font-normal">층 점수 (1층/2층/3층+/지하)</th>
              </tr>
            </thead>
            <tbody>
              {INDUSTRIES.map((ind) => {
                const p = meta.cfg.preset[ind.id];
                const tot = p.g.reduce((x, y) => x + y, 0);
                return (
                  <tr key={ind.id} className="border-b border-line last:border-0">
                    <td className="py-2.5">{ind.emoji} {ind.label}</td>
                    {p.g.map((w, i) => (
                      <td key={i} className="py-2.5 tabular-nums">{Math.round((w / tot) * 100)}%</td>
                    ))}
                    <td className="py-2.5 tabular-nums">{Math.round(p.area / 3.3058)}평</td>
                    <td className="py-2.5 tabular-nums text-muted">{p.floor.map((f) => f ?? "–").join(" / ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-faint">
          정보가 부족해 점수 반영 비율이 {meta.cfg.min_coverage}% 미만인 매물은 추천에서 뺍니다. 사용자가 &ldquo;중요하게 볼 것&rdquo;을 고르면 그 그룹에 +25를 더합니다.
        </p>
        <div className="mt-4 rounded-xl bg-tile-purple p-4 text-sm">
          <p className="font-medium">
            {NEXT_PROPOSAL.v} 조정안 (검토 대기 · 샘플) <span className="font-normal text-muted">· {NEXT_PROPOSAL.basedOn}</span>
          </p>
          <ul className="mt-2 space-y-1 text-muted">
            {NEXT_PROPOSAL.changes.map((c) => <li key={c}>· {c}</li>)}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" className="rounded-full bg-brand px-4 py-2 text-xs font-medium text-brand-ink">승인하고 다음 갱신에 적용</button>
            <button type="button" className="rounded-full border border-line bg-panel px-4 py-2 text-xs">보류</button>
          </div>
        </div>
      </Card>

      <LogViewer />
    </div>
  );
}

async function AdminGate({ searchParams }: PageProps<"/admin">) {
  const { as } = await searchParams;
  const viewer = await getViewer(typeof as === "string" ? as : undefined);

  if (!viewer.isAdmin) {
    return (
      <div className="flex min-h-dvh flex-col">
        <TopBar viewer={viewer} />
        <main className="grid flex-1 place-items-center p-6">
          <div className="max-w-sm rounded-2xl border border-line bg-panel p-8 text-center">
            <Icon name="lock" size={32} className="mx-auto text-muted" />
            <h1 className="mt-4 text-lg font-medium">관리자만 볼 수 있는 페이지예요</h1>
            <p className="mt-2 text-sm text-muted">
              {viewer.loggedIn ? "이 계정에는 관리자 권한이 없어요." : "관리자 계정으로 로그인해 주세요."}
            </p>
            <Link href={viewer.loggedIn ? "/" : "/login"} className="mt-6 inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-ink">
              {viewer.loggedIn ? "추천 화면으로" : "로그인"}
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar viewer={viewer} title="시스템 모니터링">
        <Link href="/" className="rounded-full border border-line bg-panel px-3.5 py-2 text-sm hover:bg-soft">
          서비스 화면
        </Link>
      </TopBar>
      <Suspense fallback={<p className="p-8 text-center text-sm text-muted">상태 점검 중…</p>}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

export default function AdminPage(props: PageProps<"/admin">) {
  return (
    <Suspense fallback={<p className="p-8 text-center text-sm text-muted">불러오는 중…</p>}>
      <AdminGate {...props} />
    </Suspense>
  );
}
