"use client";
// AI 상담견 "공실이": 화면 구석에서 "자리있능교?" 하고 묻고, 누르면 대화로 조건을 골라 준다.
import { useEffect, useRef, useState } from "react";
import {
  DEPOSIT_ANY,
  GU_LIST,
  INDUSTRIES,
  RENT_ANY,
  toPyeong,
  won,
  type Filters,
  type Gu,
  type IndustryId,
  type Item,
} from "@/lib/listings";
import { fetchRecommendation } from "@/lib/recommend-client";
import type { Viewer } from "@/lib/viewer";
import { AiText } from "./ai-bits";
import { answer } from "./chat-engine";
import { Icon } from "./ui";

/** 노란 강아지 얼굴 (직접 그린 SVG) */
export function PuppyFace({ size = 64, wag = false }: { size?: number; wag?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      {/* 꼬리 */}
      <path className={wag ? "animate-wag" : ""} d="M50 50 q10 -4 9 -14" stroke="#E0A92E" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* 귀 */}
      <ellipse cx="13" cy="26" rx="7" ry="13" fill="#C98A2B" transform="rotate(20 13 26)" />
      <ellipse cx="51" cy="26" rx="7" ry="13" fill="#C98A2B" transform="rotate(-20 51 26)" />
      {/* 얼굴 */}
      <circle cx="32" cy="33" r="21" fill="#FFD449" />
      <ellipse cx="32" cy="41" rx="11" ry="8.5" fill="#FFF2C6" />
      {/* 볼 */}
      <circle cx="19" cy="40" r="3.2" fill="#FF9AA8" opacity="0.55" />
      <circle cx="45" cy="40" r="3.2" fill="#FF9AA8" opacity="0.55" />
      {/* 눈 */}
      <circle cx="24.5" cy="31" r="3.1" fill="#2B1D0E" />
      <circle cx="39.5" cy="31" r="3.1" fill="#2B1D0E" />
      <circle cx="25.6" cy="29.9" r="1" fill="#fff" />
      <circle cx="40.6" cy="29.9" r="1" fill="#fff" />
      {/* 코·입·혀 */}
      <ellipse cx="32" cy="37.5" rx="3.2" ry="2.3" fill="#3A2614" />
      <path d="M32 39.8 v2.2 M32 42 q-3 3 -5.5 0.5 M32 42 q3 3 5.5 0.5" stroke="#3A2614" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M30.3 43.6 q1.7 3.6 3.4 0" fill="#FF7E8F" />
      {/* 목걸이 + AI 이름표 */}
      <path d="M17 50 q15 8 30 0" stroke="#E5484D" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <circle cx="32" cy="55" r="5" fill="#FFFFFF" stroke="#E5484D" strokeWidth="1.2" />
      <text x="32" y="57.2" textAnchor="middle" fontSize="5.6" fontWeight="700" fill="#E5484D" fontFamily="sans-serif">
        AI
      </text>
    </svg>
  );
}

type Msg = { from: "bot" | "me"; text: string; chips?: Chip[]; id: number };
type Chip = { label: string; act: () => void };
type Step = "industry" | "budget" | "gu" | "size" | "done";

export function Puppy({
  viewer,
  onRun,
  current,
  items,
}: {
  viewer: Viewer;
  onRun: (f: Filters) => void;
  current: Filters;
  items: Item[];
}) {
  const [open, setOpen] = useState(false);
  const [bubble, setBubble] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false); // 공실이가 말하는 중이면 버튼 숨김
  const [input, setInput] = useState("");
  const pick = useRef<Filters>(current);
  const step = useRef<Step>("industry");
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  function say(text: string, chips?: Chip[]) {
    setBusy(true);
    setMsgs((m) => [...m, { from: "bot", text, chips, id: nextId.current++ }]);
  }
  function me(text: string) {
    setMsgs((m) => [...m, { from: "me", text, id: nextId.current++ }]);
  }

  function askIndustry() {
    step.current = "industry";
    say(
      `어서 오이소! 저는 AI 상담견 공실이라예 🐶 ${viewer.loggedIn ? `${viewer.name} 님, ` : ""}대구 빈 상가 중에 딱 맞는 자리 찾아드릴게예. 무슨 가게 하실라꼬예?`,
      INDUSTRIES.map((i) => ({
        label: `${i.emoji} ${i.label}`,
        act: () => {
          me(i.label);
          pick.current = { ...pick.current, industry: i.id as IndustryId };
          askBudget();
        },
      })),
    );
  }
  function askBudget() {
    step.current = "budget";
    say(
      "좋네예! 월세(관리비 포함)는 한 달에 얼마까지 생각하시능교?",
      [100, 200, 300, 500, RENT_ANY].map((v) => ({
        label: v === RENT_ANY ? "상관없어예" : `${v}만원까지`,
        act: () => {
          me(v === RENT_ANY ? "상관없어요" : `${v}만원까지`);
          pick.current = { ...pick.current, rentMax: v, depositMax: DEPOSIT_ANY };
          askGu();
        },
      })),
    );
  }
  function askGu() {
    step.current = "gu";
    say("어느 동네가 좋능교? 하나 골라 주이소.", [
      ...GU_LIST.map((g) => ({
        label: g,
        act: () => {
          me(g);
          pick.current = { ...pick.current, gus: [g as Gu] };
          askSize();
        },
      })),
      {
        label: "대구 어디든 괜찮아예",
        act: () => {
          me("어디든 괜찮아요");
          pick.current = { ...pick.current, gus: [...GU_LIST] };
          askSize();
        },
      },
    ]);
  }
  function askSize() {
    step.current = "size";
    const sizes: [string, number, number][] = [
      ["10평 이하", 20, 36],
      ["10~20평", 30, 70],
      ["20~30평", 62, 102],
      ["30평 이상", 95, 100000],
      ["상관없어예", 0, 100000],
    ];
    say(
      "마지막! 넓이는 어느 정도면 되겠능교?",
      sizes.map(([label, min, max]) => ({
        label,
        act: () => {
          me(label);
          pick.current = { ...pick.current, areaMin: min, areaMax: max, floors: ["1층", "지상 2층 이상", "지하"], prio: 0 };
          finish();
        },
      })),
    );
  }
  function finish() {
    step.current = "done";
    const f = pick.current;
    onRun(f);
    setBusy(true);
    fetchRecommendation(f, { likedGus: {} }, viewer.previewAs)
      .then((r) => {
        if (r.okCount === 0) {
          say("아이고, 그 조건에 맞는 자리가 지금은 없네예 😢 월세나 동네를 좀 넓혀 볼까예?", [{ label: "다시 고르기", act: restart }]);
          return;
        }
        const top = r.items[0];
        say(
          `알겠심더! 대구 빈 상가 ${r.total.toLocaleString()}곳 중에 ${r.okCount.toLocaleString()}곳을 AI가 스코어링 해봤어예 🔍 1등은 ${top.title}${top.bldg ? `(${top.bldg})` : ""}! 점수 ${top.score}점, ${toPyeong(top.areaM2)}평에 보증금 ${won(top.deposit)}원·월세 ${won(top.rent)}원이라예. 지도에 핀으로 하나씩 꽂아 드릴게예.`,
          [
            { label: "추천 화면 보기", act: () => setOpen(false) },
            { label: "다시 고르기", act: restart },
          ],
        );
      })
      .catch(() => say("아이고, 서버가 대답을 안 하네예. 잠시 뒤에 다시 해 보이소.", [{ label: "다시 고르기", act: restart }]));
  }
  function restart() {
    pick.current = current;
    me("다시 고를래요");
    askIndustry();
  }

  function openChat() {
    setOpen(true);
    setBubble(false);
    if (msgs.length === 0) askIndustry();
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    me(q);
    const a = answer(q, items, current.industry);
    say(`${a.text} (더 궁금한 거 있으면 물어보이소!)`);
  }

  const last = msgs[msgs.length - 1];

  return (
    <>
      {/* 떠 있는 공실이 */}
      {!open && (
        <div className="fixed bottom-36 right-4 z-40 flex items-end gap-2 lg:bottom-6 lg:right-6">
          {bubble && (
            <div className="animate-rise relative mb-10 rounded-2xl rounded-br-sm border border-line bg-panel px-4 py-2.5 text-sm shadow-lg">
              <button type="button" onClick={openChat} className="font-medium">
                자리있능교? 🏠
              </button>
              <p className="text-[11px] text-muted">AI 공실이가 찾아드려요</p>
              <button
                type="button"
                aria-label="말풍선 닫기"
                onClick={() => setBubble(false)}
                className="absolute -left-2 -top-2 grid size-5 place-items-center rounded-full border border-line bg-panel text-muted"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={openChat}
            aria-label="AI 상담견 공실이와 대화하기"
            className="animate-bob grid size-[76px] place-items-center rounded-full bg-[#FFF6D6] shadow-xl ring-4 ring-panel transition hover:scale-105"
          >
            <PuppyFace size={66} wag />
          </button>
        </div>
      )}

      {/* 대화창: 닫아도 내용이 다시 타이핑되지 않도록 숨기기만 한다 */}
      {msgs.length > 0 && (
        <div
          role="dialog"
          aria-label="AI 상담견 공실이"
          hidden={!open}
          className="animate-rise fixed inset-x-3 bottom-20 z-40 flex h-[min(560px,calc(100dvh-7rem))] flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[380px] lg:bottom-6"
        >
          <header className="flex items-center gap-3 bg-[#FFF3C4] px-4 py-3 text-[#3a2a00]">
            <PuppyFace size={44} wag={busy} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">공실이</p>
              <p className="flex items-center gap-1 text-xs opacity-75">
                <Icon name="spark" size={12} /> AI 상담견 · 대구 공실 {busy ? "생각 중…" : "대기 중"}
              </p>
            </div>
            <button type="button" aria-label="대화창 닫기" onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-full hover:bg-black/5">
              <Icon name="close" size={18} />
            </button>
          </header>

          <div ref={scroller} className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {msgs.map((m) =>
              m.from === "me" ? (
                <p key={m.id} className="animate-rise ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-sm">
                  {m.text}
                </p>
              ) : (
                <div key={m.id} className="animate-rise flex gap-2">
                  <span className="mt-0.5 shrink-0">
                    <PuppyFace size={30} />
                  </span>
                  <div className="min-w-0">
                    <p className="w-fit max-w-[95%] rounded-2xl rounded-tl-md bg-soft px-3.5 py-2 text-sm leading-6">
                      <AiText text={m.text} thinkTicks={8} charsPerTick={2} onDone={() => setBusy(false)} />
                    </p>
                    {m.chips && m === last && !busy && (
                      <div className="animate-rise mt-2 flex flex-wrap gap-1.5">
                        {m.chips.map((c) => (
                          <button
                            key={c.label}
                            type="button"
                            onClick={c.act}
                            className="rounded-full border border-[#E8C55A] bg-[#FFF8DD] px-3 py-1.5 text-[13px] text-[#4a3800] hover:bg-[#FFEFB0] dark:border-[#6b5a1f] dark:bg-[#3a3218] dark:text-[#ffe9a3]"
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>

          <form onSubmit={send} className="flex items-center gap-2 border-t border-line px-3 py-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="공실이한테 물어보이소"
              className="min-w-0 flex-1 rounded-full bg-soft px-4 py-2.5 text-sm outline-none placeholder:text-faint"
            />
            <button type="submit" aria-label="보내기" disabled={!input.trim() || busy} className="grid size-10 place-items-center rounded-full bg-[#FFD449] text-[#3a2a00] disabled:opacity-40">
              <Icon name="send" size={18} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
