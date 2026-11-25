"use client";
// AI 상담견 공실이(발표 데모와 같은 단계 대화, 경상도 말투). 월세 → 동네 → 넓이를 물어 검색 조건으로 바꾼다.
// 업종과 점수는 5단계 전이라 묻지 않고 말하지 않는다. 직접 입력은 "문장으로 찾기"와 같은 규칙 기반 풀이(횟수 차감)를 쓴다.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { gongsilFind, gongsilStart, type GongsilChoice } from "./gongsil-actions";
import { convertSearchText } from "./sentence-search-actions";

type Option = { label: string; value: string };
type Msg = { id: number; from: "bot" | "me"; text: string; options?: Option[]; step?: string; link?: { href: string; label: string } };

const BUBBLE_KEY = "dax.gongsil.bubble-closed";
const GU = ["중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군"];
const RENTS: Option[] = [100, 200, 300, 500].map((n) => ({ label: `${n}만원까지`, value: String(n) })).concat({ label: "상관없어예", value: "any" });
const AREAS: Option[] = [
  { label: "10평 이하", value: "0-10" },
  { label: "10~20평", value: "10-20" },
  { label: "20~30평", value: "20-30" },
  { label: "30평 이상", value: "30-" },
  { label: "상관없어예", value: "any" },
];

export function GongsilDog({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M50 50 q10 -4 9 -14" stroke="#E0A92E" strokeWidth="5" strokeLinecap="round" fill="none" />
      <ellipse cx="13" cy="26" rx="7" ry="13" fill="#C98A2B" transform="rotate(20 13 26)" />
      <ellipse cx="51" cy="26" rx="7" ry="13" fill="#C98A2B" transform="rotate(-20 51 26)" />
      <circle cx="32" cy="33" r="21" fill="#FFD449" />
      <ellipse cx="32" cy="41" rx="11" ry="8.5" fill="#FFF2C6" />
      <circle cx="19" cy="40" r="3.2" fill="#FF9AA8" opacity="0.55" />
      <circle cx="45" cy="40" r="3.2" fill="#FF9AA8" opacity="0.55" />
      <circle cx="24.5" cy="31" r="3.1" fill="#2B1D0E" />
      <circle cx="39.5" cy="31" r="3.1" fill="#2B1D0E" />
      <circle cx="25.6" cy="29.9" r="1" fill="#fff" />
      <circle cx="40.6" cy="29.9" r="1" fill="#fff" />
      <ellipse cx="32" cy="37.5" rx="3.2" ry="2.3" fill="#3A2614" />
      <path d="M32 39.8 v2.2 M32 42 q-3 3 -5.5 0.5 M32 42 q3 3 5.5 0.5" stroke="#3A2614" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M30.3 43.6 q1.7 3.6 3.4 0" fill="#FF7E8F" />
      <path d="M17 50 q15 8 30 0" stroke="#E5484D" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <circle cx="32" cy="55" r="5" fill="#FFFFFF" stroke="#E5484D" strokeWidth="1.2" />
      <text x="32" y="57.2" textAnchor="middle" fontSize="5.6" fontWeight="700" fill="#E5484D" fontFamily="sans-serif">AI</text>
    </svg>
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const man = (value: number | null) => (value === null ? "미기재" : `${value.toLocaleString("ko-KR")}만원`);

export function GongsilChat() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bubble, setBubble] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const idRef = useRef(0);
  const started = useRef(false);
  const choice = useRef<GongsilChoice>({ rent: null, gu: null, area: null });
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 말풍선 닫힘 상태를 처음 한 번만 읽는다
      setBubble(window.sessionStorage.getItem(BUBBLE_KEY) !== "1");
    } catch {
      setBubble(true);
    }
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);

  const say = useCallback(async (message: Omit<Msg, "id" | "from">, from: "bot" | "me" = "bot") => {
    if (from === "bot") {
      setBusy(true);
      await wait(650);
      setBusy(false);
    }
    setMsgs((current) => [...current, { id: ++idRef.current, from, ...message }]);
  }, []);

  const askRent = useCallback(async () => {
    await say({ text: "월세(관리비 포함)는 한 달에 얼마까지 생각하시능교?", options: RENTS, step: "rent" });
  }, [say]);

  const start = useCallback(async () => {
    choice.current = { rent: null, gu: null, area: null };
    await say({ text: "어서 오이소! 저는 AI 상담견 공실이라예 🐶 대구 빈 상가 중에 딱 맞는 자리 찾아드릴게예." });
    // 횟수를 다 썼으면 대화를 시작하기 전에 알려 준다.
    const status = await gongsilStart().catch(() => null);
    if (status && (!status.ok || (status.remaining !== null && status.remaining <= 0))) {
      await say({
        text: status.guest
          ? "비회원 AI 이용 횟수를 다 썼어예. 로그인하면 하루 10회까지 쓸 수 있어예."
          : status.ok
            ? "오늘 AI 이용 횟수를 다 썼어예. 내일 다시 만나예."
            : "지금은 AI 기능을 쓸 수 없어예. 잠시 후 다시 불러 주이소.",
        link: status.guest ? { href: "/login", label: "로그인하기" } : undefined,
      });
      return;
    }
    await say({ text: "업종별 점수는 아직 준비 중이라예. 먼저 월세부터 여쭤볼게예." });
    await askRent();
  }, [say, askRent]);

  useEffect(() => {
    if (open && !started.current) {
      started.current = true;
      void start();
    }
  }, [open, start]);

  function closeBubble() {
    setBubble(false);
    try {
      window.sessionStorage.setItem(BUBBLE_KEY, "1");
    } catch {
      /* 저장소를 못 쓰면 이번 화면에서만 닫혀요 */
    }
  }

  function lock(step: string) {
    // 고른 단계의 선택지는 더 누르지 못하게 지운다.
    setMsgs((current) => current.map((msg) => (msg.step === step ? { ...msg, options: undefined } : msg)));
  }

  async function finish() {
    await say({ text: "조건에 맞는 자리를 찾아볼게예…" });
    const result = await gongsilFind(choice.current);
    if (!result.ok && result.reason === "limit") {
      await say({ text: "AI 이용 횟수를 다 썼어예. 조건은 정해졌으니 아래 버튼으로 직접 확인해 보이소.", link: { href: result.href, label: "이 조건으로 보기" }, options: [{ label: "처음부터 다시", value: "restart" }], step: "end" });
      return;
    }
    if (!result.ok) {
      await say({ text: "조건은 정했는데 지금은 목록을 못 불러왔어예. 아래 버튼으로 직접 확인해 보이소.", link: { href: result.href, label: "이 조건으로 보기" }, options: [{ label: "처음부터 다시", value: "restart" }], step: "end" });
      return;
    }
    if (result.total === 0) {
      await say({ text: "조건에 딱 맞는 상가가 없어예 😢 월세나 넓이를 조금 넓혀서 다시 해 보시겠능교?", options: [{ label: "처음부터 다시", value: "restart" }], step: "end" });
      return;
    }
    const first = result.first ? ` 1번은 ${result.first.place}, 보증금 ${man(result.first.deposit)}에 월세 ${man(result.first.rent)}이라예.` : "";
    await say({
      text: `알겠심더! 조건에 맞는 빈 상가가 ${result.total.toLocaleString("ko-KR")}곳 있어예 🔍 점수는 아직 준비 중이라 최근 확인된 순으로 보여 드릴게예.${first}${result.remaining === null ? "" : ` (AI 횟수 ${result.remaining}회 남았어예)`}`,
      link: { href: result.href, label: "지도와 목록 보기" },
      options: [{ label: "처음부터 다시", value: "restart" }],
      step: "end",
    });
  }

  async function pick(step: string, option: Option) {
    if (busy) return;
    lock(step);
    await say({ text: option.label }, "me");
    if (step === "rent") {
      choice.current.rent = option.value === "any" ? null : Number(option.value);
      await say({ text: "좋네예! 어느 동네가 좋능교? 하나 골라 주이소.", options: [...GU.map((gu) => ({ label: gu, value: gu })), { label: "대구 어디든 괜찮아예", value: "any" }], step: "gu" });
    } else if (step === "gu") {
      choice.current.gu = option.value === "any" ? null : option.value;
      await say({ text: "마지막! 넓이는 어느 정도면 되겠능교?", options: AREAS, step: "area" });
    } else if (step === "area") {
      if (option.value === "any") choice.current.area = null;
      else {
        const [min, max] = option.value.split("-");
        choice.current.area = [min === "0" ? null : Number(min), max ? Number(max) : null];
      }
      await finish();
    } else if (step === "end" && option.value === "restart") {
      await start();
    }
  }

  async function sendFree(event: React.FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    await say({ text: value }, "me");
    setBusy(true);
    const result = await convertSearchText(value).catch(() => null);
    setBusy(false);
    if (!result) await say({ text: "지금은 잘 못 알아들었어예. 잠시 후 다시 말씀해 주이소." });
    else if (!result.ok) await say({ text: result.message });
    else {
      await say({
        text: `이렇게 알아들었심더: ${result.chips.join(", ")}${result.notes.length ? ` (${result.notes.join(" ")})` : ""}`,
        link: { href: result.href, label: "이 조건으로 보기" },
      });
    }
  }

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      {!open && bubble && (
        <div className="fixed bottom-24 right-4 z-40 flex max-w-[15rem] items-start gap-2 rounded-2xl border border-line bg-panel px-3.5 py-2.5 text-xs shadow-lg">
          <button type="button" onClick={() => { setOpen(true); closeBubble(); }} className="text-left">
            <span className="block font-medium">자리있능교? 🏠</span>
            <span className="text-muted">AI 공실이가 찾아드려요</span>
          </button>
          <button type="button" onClick={closeBubble} aria-label="말풍선 닫기" className="text-faint hover:text-ink">×</button>
        </div>
      )}
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); closeBubble(); }}
        aria-label={open ? "공실이 대화창 닫기" : "AI 상담견 공실이와 대화하기"}
        aria-expanded={open}
        className="fixed bottom-4 right-4 z-40 inline-flex size-16 items-center justify-center rounded-full border border-line bg-tile-yellow shadow-lg hover:scale-105"
      >
        <GongsilDog size={44} />
      </button>

      {open && (
        <section role="dialog" aria-label="AI 상담견 공실이" className="fixed bottom-24 right-4 z-50 flex h-[min(34rem,calc(100dvh-8rem))] w-[min(23.5rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl">
          <header className="flex items-center gap-3 bg-tile-yellow px-4 py-3">
            <GongsilDog size={40} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">공실이</p>
              <p className="text-[11px] text-muted">AI 상담견 · 대구 공실 {busy ? "생각 중…" : "대기 중"}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="대화창 닫기" className="rounded-full px-2 py-1 text-lg leading-none hover:bg-panel/60">×</button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {msgs.map((msg) => (
              <div key={msg.id} className={`flex flex-col gap-2 ${msg.from === "me" ? "items-end" : "items-start"}`}>
                <div className={`flex max-w-[88%] items-start gap-2 ${msg.from === "me" ? "flex-row-reverse" : ""}`}>
                  {msg.from === "bot" && <span className="mt-0.5 shrink-0"><GongsilDog size={28} /></span>}
                  <p className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${msg.from === "me" ? "bg-brand text-brand-ink" : "bg-soft"}`}>{msg.text}</p>
                </div>
                {msg.link && (
                  <button type="button" onClick={() => go(msg.link!.href)} className="ml-9 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-ink">{msg.link.label}</button>
                )}
                {msg.options && (
                  <div className="ml-9 flex flex-wrap gap-1.5">
                    {msg.options.map((option) => (
                      <button key={option.value} type="button" disabled={busy} onClick={() => void pick(msg.step ?? "", option)} className="rounded-full border border-line bg-panel px-3 py-1.5 text-sm hover:bg-soft disabled:opacity-50">
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2">
                <GongsilDog size={28} />
                <span className="rounded-2xl bg-soft px-3.5 py-2.5 text-sm text-muted" aria-label="공실이가 답을 쓰는 중">···</span>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form onSubmit={sendFree} className="flex items-center gap-2 border-t border-line px-3 py-3">
            <input value={text} onChange={(event) => setText(event.target.value)} maxLength={200} placeholder="공실이한테 물어보이소" aria-label="공실이에게 직접 말하기" className="min-w-0 flex-1 rounded-full bg-soft px-4 py-2.5 text-sm outline-none placeholder:text-faint" />
            <button type="submit" disabled={busy || !text.trim()} aria-label="보내기" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-tile-yellow disabled:opacity-40">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14 M13 6l6 6-6 6" /></svg>
            </button>
          </form>
        </section>
      )}
    </>
  );
}
