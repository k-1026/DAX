"use client";
// 스튜디오 타일을 누르면 열리는 상세 화면들: 임대료 시뮬레이터, 현장 체크리스트, 추천 메일 받기.
// 점수와 상관없는 기능만 둔다. 점수가 필요한 항목은 5단계에서 연결한다.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AiWorking } from "./ai-working";
import { getMailStatus, type MailStatus } from "./mail-status-actions";

export type Candidate = { id: string; title: string; place: string; rent: number | null; fee: number | null };
export type StudioView = "simulator" | "checklist" | "mail";

const TITLES: Record<StudioView, string> = { simulator: "임대료 시뮬레이터", checklist: "현장 체크리스트", mail: "추천 메일 받기" };

const WORK_STEPS: Record<StudioView, string[]> = {
  simulator: ["AI가 기준 매물을 확인하는 중", "월세와 관리비를 계산하는 중", "결과를 정리하는 중"],
  checklist: ["AI가 현장에서 볼 항목을 고르는 중", "확인 순서를 정리하는 중"],
  mail: ["AI가 내 메일 설정을 확인하는 중", "보낼 조건이 갖춰졌는지 점검하는 중", "결과를 정리하는 중"],
};

export function StudioDetail({ view, onBack, candidates, guest }: { view: StudioView; onBack: () => void; candidates: Candidate[]; guest: boolean }) {
  const [ready, setReady] = useState(false);
  const done = useCallback(() => setReady(true), []);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-medium">{TITLES[view]}</h3>
        <button type="button" onClick={onBack} aria-label="스튜디오로 돌아가기" className="rounded-full border border-line bg-panel px-3 py-1.5 text-sm hover:bg-soft">
          ← 돌아가기
        </button>
      </div>
      {!ready && <AiWorking steps={WORK_STEPS[view]} onDone={done} />}
      {ready && view === "simulator" && <RentSimulator candidates={candidates} />}
      {ready && view === "checklist" && <FieldChecklist />}
      {ready && view === "mail" && <MailPanel guest={guest} />}
    </div>
  );
}

// ---- 임대료 시뮬레이터 ------------------------------------------------------------
const verdict = (ratio: number) =>
  ratio <= 10
    ? { text: "안정적이에요", tone: "text-ok", box: "bg-ok-soft" }
    : ratio <= 15
      ? { text: "조금 부담돼요", tone: "text-warn", box: "bg-warn-soft" }
      : { text: "위험 신호예요. 매출을 더 잡을 수 있는지, 더 저렴한 곳은 없는지 살펴보세요", tone: "text-bad", box: "bg-bad-soft" };

function RentSimulator({ candidates }: { candidates: Candidate[] }) {
  const [id, setId] = useState(candidates[0]?.id ?? "");
  const [sales, setSales] = useState(2500);
  const target = candidates.find((candidate) => candidate.id === id) ?? candidates[0];

  if (!target) {
    return <p className="rounded-xl bg-soft p-4 text-sm text-muted">추천 목록에 매물이 있으면 그 매물 기준으로 계산해 드려요. 먼저 조건으로 검색해 주세요.</p>;
  }
  const total = target.rent === null ? null : target.rent + (target.fee ?? 0);
  const ratio = total === null || sales <= 0 ? null : (total / sales) * 100;
  const result = ratio === null ? null : verdict(ratio);

  return (
    <div className="reveal-seq flex flex-col gap-4 text-sm">
      <p className="text-xs text-muted">
        보통 매출 대비 임대료가 10% 이하면 안정적, 15%를 넘으면 위험 신호로 봐요. 아래 매출은 직접 정하는 예시 값이고, 실제 매출을 보장하지 않아요.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">기준 매물</span>
        <select value={target.id} onChange={(event) => setId(event.target.value)} className="rounded-xl border border-line bg-panel px-3 py-2">
          {candidates.map((candidate, index) => (
            <option key={candidate.id} value={candidate.id}>
              {index + 1}번 · {candidate.place}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="sim-sales" className="text-xs font-medium text-muted">예상 월 매출</label>
          <span className="text-base font-medium tabular-nums">{sales.toLocaleString("ko-KR")}만원</span>
        </div>
        <input id="sim-sales" type="range" min={0} max={10000} step={100} value={sales} onChange={(event) => setSales(Number(event.target.value))} className="w-full accent-[var(--accent)]" />
        <div className="flex justify-between text-[11px] text-faint"><span>0</span><span>1억원</span></div>
      </div>
      <div className="rounded-xl bg-soft p-4">
        <p className="text-xs text-muted">월세+관리비</p>
        <p className="mt-0.5 text-base font-medium tabular-nums">
          {total === null ? "월세가 적혀 있지 않아요" : `${total.toLocaleString("ko-KR")}만원`}
          {total !== null && target.fee === null && <span className="ml-1.5 text-xs font-normal text-warn">관리비 미기재</span>}
        </p>
        <p className="mt-3 text-xs text-muted">매출 대비 임대료</p>
        <p className="mt-0.5 text-2xl font-medium tabular-nums">{ratio === null ? "—" : `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}%`}</p>
      </div>
      {result && <p className={`rounded-xl px-4 py-3 font-medium ${result.box} ${result.tone}`}>{result.text}</p>}
      {total !== null && target.fee === null && <p className="text-xs text-faint">관리비가 적혀 있지 않아 월세만으로 계산했어요. 중개사에게 관리비를 꼭 물어보세요.</p>}
    </div>
  );
}

// ---- 현장 체크리스트 --------------------------------------------------------------
const CHECKS = [
  "등기부등본으로 소유자·근저당 확인",
  "건축물대장의 용도(근린생활시설) 확인",
  "업종 제한·관리규약 확인",
  "전기 용량·급배수·가스 확인",
  "간판 설치 가능 위치",
  "권리금과 원상복구 조건",
  "평일/주말 유동 인구 직접 확인",
];
const CHECK_KEY = "dax.field-checklist.v1";

function FieldChecklist() {
  const [done, setDone] = useState<boolean[]>(() => CHECKS.map(() => false));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CHECK_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 체크를 처음 한 번만 불러온다
      if (Array.isArray(saved) && saved.length === CHECKS.length) setDone(saved.map(Boolean));
    } catch {
      /* 저장소를 못 쓰면 이번 화면에서만 체크돼요 */
    }
    setLoaded(true);
  }, []);

  function update(next: boolean[]) {
    setDone(next);
    try {
      window.localStorage.setItem(CHECK_KEY, JSON.stringify(next));
    } catch {
      /* 무시 */
    }
  }

  const count = done.filter(Boolean).length;
  return (
    <div className="reveal-seq flex flex-col gap-3 text-sm">
      <p className="text-xs text-muted">현장에 가기 전에 하나씩 확인해 보세요. 체크는 이 기기에만 저장돼요.</p>
      <ul className="reveal-seq flex flex-col gap-2">
        {CHECKS.map((text, index) => (
          <li key={text}>
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3.5 py-3 ${done[index] ? "bg-soft text-muted" : "bg-panel"}`}>
              <input
                type="checkbox"
                checked={done[index]}
                onChange={(event) => update(done.map((value, i) => (i === index ? event.target.checked : value)))}
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              <span className={done[index] ? "line-through" : ""}>{text}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-soft" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(count / CHECKS.length) * 100}%` }} />
          </div>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted" aria-live="polite">{loaded ? count : 0}/{CHECKS.length} 완료</span>
        </div>
        <button type="button" onClick={() => update(CHECKS.map(() => false))} disabled={count === 0} className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs hover:bg-soft disabled:opacity-40">
          모두 해제
        </button>
      </div>
    </div>
  );
}

// ---- 추천 메일 받기 ---------------------------------------------------------------
function MailPanel({ guest }: { guest: boolean }) {
  const [status, setStatus] = useState<MailStatus | null>(null);

  useEffect(() => {
    if (guest) return;
    let alive = true;
    getMailStatus().then((next) => alive && setStatus(next)).catch(() => alive && setStatus({ ok: false }));
    return () => {
      alive = false;
    };
  }, [guest]);

  const checks = useMemo(
    () =>
      status && status.ok
        ? ([
            ["추천 메일 수신 동의", status.hasConsent, "마이페이지에서 켤 수 있어요"],
            ["메일 받을 주소", status.hasAddress, "마이페이지에서 입력해요"],
            ["선호 조건 저장", status.hasFilters, "마이페이지에서 저장해요"],
            ["조건에 맞는 매물", status.total > 0, status.hasFilters ? "지금은 맞는 매물이 없어요" : "선호 조건을 저장하면 확인돼요"],
          ] as [string, boolean, string][])
        : [],
    [status],
  );

  if (guest) {
    return (
      <p className="text-sm">
        로그인하면 내 선호 조건으로 추천 메일을 받을 수 있어요. <Link href="/login" className="underline">무료로 로그인하기</Link>
      </p>
    );
  }
  return (
    <div className="reveal-seq flex flex-col gap-4 text-sm">
      <div className="rounded-xl bg-soft p-4 text-xs leading-relaxed text-muted">
        <p className="font-medium text-ink">이렇게 보내요</p>
        <ul className="mt-1.5 list-disc pl-4">
          <li>로그인 회원은 선호 조건을 저장하면 맞는 매물 상위 5곳을 <b>한 번만</b> 보내요.</li>
          <li>구독 회원은 3일마다 갱신될 때 새 매물이 있으면 한 통으로 묶어 보내요. 한 달 보내는 수에 상한이 있어요.</li>
          <li>제목 앞에 (광고)가 붙고, 메일 안에서 수신 거부를 할 수 있어요. 밤 9시~아침 8시에는 보내지 않고 아침으로 미뤄요.</li>
        </ul>
      </div>
      {status === null ? (
        <p className="text-muted">내 상태를 확인하는 중…</p>
      ) : !status.ok ? (
        <p role="alert" className="text-bad">상태를 불러오지 못했어요. 잠시 후 다시 열어 주세요.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {checks.map(([label, ok, hint]) => (
              <li key={label} className={`flex items-baseline gap-2 ${ok ? "text-ok" : "text-muted"}`}>
                <span aria-hidden="true">{ok ? "✓" : "·"}</span>
                <span>
                  {label}
                  {!ok && <span className="ml-1.5 text-xs text-faint">{hint}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            {status.sentAt ? "첫 추천 메일은 이미 받으셨어요. 첫 메일은 한 번만 보내요." : "위 조건이 모두 갖춰지면 가까운 발송 시간에 한 번 보내요."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/mypage" className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-ink">선호 조건 설정하기</Link>
            <Link href="/mypage/mail-preview" className="rounded-full border border-line bg-panel px-4 py-2 text-sm hover:bg-soft">이번 메일 미리보기</Link>
          </div>
        </>
      )}
    </div>
  );
}
