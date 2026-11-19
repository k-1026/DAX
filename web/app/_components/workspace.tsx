"use client";
// 메인 작업 화면: [조건] · [추천 + AI 대화] · [스튜디오] 3단 구성 (NotebookLM 레이아웃 참고)
// 추천은 서버(/api/recommend)가 실제 매물로 계산하고, 화면은 그동안 "AI 스코어링" 단계를 보여 준다.
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FILTERS, industryLabel, type Filters, type Gu, type Item, type Preference, type Recommendation } from "@/lib/listings";
import { fetchRecommendation } from "@/lib/recommend-client";
import type { Viewer } from "@/lib/viewer";
import { ConditionsPanel } from "./conditions-panel";
import { ResultsPanel, type ChatMsg } from "./results-panel";
import { StudioPanel } from "./studio-panel";
import { Icon, TopBar } from "./ui";
import { answer, summary } from "./chat-engine";
import { useTicker } from "./ai-bits";
import { Puppy } from "./puppy";

// 화면 연출 속도 (시계 1칸 = 80ms)
const STEP_TICKS = 7; // 스코어링 단계 하나
const CHARS_PER_TICK = 6; // 요약 글자
const CARD_TICKS = 3; // 카드·지도 핀 하나

export type Reveal = {
  scoring: boolean;
  step: number;
  steps: string[];
  typed: number;
  revealed: number;
  done: boolean;
  skip: () => void;
};
type Tab = "conditions" | "results" | "studio";
type Feedback = Record<string, { v: "up" | "down"; gu: Gu }>;

export function Workspace({ viewer }: { viewer: Viewer }) {
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);
  const [runId, setRunId] = useState(0);
  const [data, setData] = useState<{ run: number; r: Recommendation } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({});
  const [saved, setSaved] = useState<Item[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [tab, setTab] = useState<Tab>("results");
  const [toast, setToast] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 좋아요/아쉬워요를 누른 매물의 구에 가산점 → "내 선호 반영"
  const pref = useMemo<Preference>(() => {
    const likedGus: Partial<Record<Gu, number>> = {};
    if (!viewer.loggedIn) return { likedGus };
    for (const { v, gu } of Object.values(feedback)) {
      likedGus[gu] = Math.max(-4, Math.min(4, (likedGus[gu] ?? 0) + (v === "up" ? 2 : -2)));
    }
    return { likedGus };
  }, [feedback, viewer.loggedIn]);
  const prefKey = JSON.stringify(pref.likedGus);

  // 조건이 바뀌면(runId) 새로 계산, 선호만 바뀌면 조용히 다시 계산
  useEffect(() => {
    let alive = true;
    fetchRecommendation(applied, pref, viewer.previewAs)
      .then((r) => {
        if (!alive) return;
        setData({ run: runId, r });
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applied는 runId와 함께 바뀐다
  }, [runId, prefKey]);

  const cur = data?.run === runId ? data.r : null;
  const loading = !cur && !error;
  const items: Item[] = cur?.items ?? [];
  const sum = useMemo(
    () => (error ? { text: `추천을 불러오지 못했어요. ${error}`, cites: [] } : summary(cur, applied.industry)),
    [cur, applied.industry, error],
  );

  // AI 스코어링 연출: 단계 표시 → 요약 타이핑 → 카드·핀이 하나씩
  const shownCount = items.length + (cur?.locked.length ?? 0);
  const steps = [
    `대구 빈 상가 ${cur ? `${cur.total.toLocaleString()}건 ` : ""}불러오는 중`,
    `면적·보증금·월세·지역 조건으로 추리는 중${cur ? ` → ${cur.matched.toLocaleString()}곳` : ""}`,
    `${industryLabel(applied.industry)} 기준 비용·공간·위치·업종 맞춤 점수 계산 중`,
    `건물 용도·교통·주변 상권 확인 중 (점수 엔진 ${cur?.version ?? "v1"})`,
    viewer.loggedIn ? `내 평가 ${Object.keys(feedback).length}건으로 선호 보정, 순위 정리 중` : "순위 정리 중",
  ];
  const scoringEnd = STEP_TICKS * steps.length;
  const typeEnd = scoringEnd + Math.ceil(sum.text.length / CHARS_PER_TICK);
  const maxTick = loading ? scoringEnd - 2 : typeEnd + shownCount * CARD_TICKS + 1; // 서버 답을 기다리는 동안 마지막 단계에서 멈춤
  const { t, skip } = useTicker(runId, maxTick);
  const reveal: Reveal = {
    scoring: t < scoringEnd,
    step: Math.min(steps.length - 1, Math.floor(t / STEP_TICKS)),
    steps,
    typed: Math.max(0, Math.min(sum.text.length, (t - scoringEnd) * CHARS_PER_TICK)),
    revealed: t < typeEnd ? 0 : Math.min(shownCount, Math.floor((t - typeEnd) / CARD_TICKS) + 1),
    done: t >= maxTick && !loading,
    skip: () => !loading && skip(),
  };

  function notify(text: string) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  function apply(next: Filters = draft) {
    setApplied(next);
    setMessages([]);
    setRunId((r) => r + 1);
    setTab("results");
  }

  function ask(q: string) {
    if (!q.trim()) return;
    if (!viewer.loggedIn && messages.filter((m) => m.role === "user").length >= 2) {
      notify("비회원은 질문 2개까지 가능해요. 로그인하면 계속 물어볼 수 있어요.");
      return;
    }
    setMessages((m) => [...m, { role: "user", text: q }, { role: "ai", ...answer(q, items, applied.industry) }]);
  }

  function rate(item: Item, v: "up" | "down") {
    if (!viewer.loggedIn) return notify("로그인하면 평가가 내 추천에 반영돼요.");
    setFeedback((f) => {
      const next = { ...f };
      if (next[item.id]?.v === v) delete next[item.id];
      else next[item.id] = { v, gu: item.gu };
      return next;
    });
    notify(v === "up" ? `좋아요를 반영했어요. ${item.gu} 매물 점수가 올라가요.` : `아쉬워요를 반영했어요. ${item.gu} 매물은 덜 보여드릴게요.`);
  }

  function toggleSave(item: Item) {
    if (!viewer.loggedIn) return notify("관심 매물 저장은 로그인 후 이용할 수 있어요.");
    setSaved((s) => (s.some((x) => x.id === item.id) ? s.filter((x) => x.id !== item.id) : [...s, item]));
  }

  function cite(rank: number) {
    const l = items[rank - 1];
    if (!l) return;
    setFocusId(l.id);
    setTab("results");
    document.getElementById(`card-${l.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setFocusId(null), 1600);
  }

  const panelClass = (t: Tab) => (tab === t ? "flex" : "hidden lg:flex");
  const latest = data?.r;

  return (
    <div className="flex h-dvh flex-col">
      <TopBar viewer={viewer} title="내 공실 탐색 노트">
        <button
          type="button"
          onClick={() => notify("공유 링크를 복사했어요. (데모)")}
          className="hidden items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 py-2 text-sm hover:bg-soft sm:flex"
        >
          <Icon name="share" size={16} /> 공유
        </button>
      </TopBar>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 pb-20 lg:grid-cols-[300px_minmax(0,1fr)_340px] lg:pb-4 xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <ConditionsPanel
          className={panelClass("conditions")}
          draft={draft}
          setDraft={setDraft}
          onApply={apply}
          viewer={viewer}
          feedbackCount={Object.keys(feedback).length}
          savedCount={saved.length}
          meta={latest ? { date: latest.date, total: latest.total } : null}
        />
        <ResultsPanel
          className={panelClass("results")}
          viewer={viewer}
          filters={applied}
          rec={cur}
          items={items}
          summary={sum}
          reveal={reveal}
          messages={messages}
          onAsk={ask}
          onCite={cite}
          feedback={Object.fromEntries(Object.entries(feedback).map(([k, x]) => [k, x.v]))}
          onRate={rate}
          saved={saved.map((x) => x.id)}
          onSave={toggleSave}
          focusId={focusId}
        />
        <StudioPanel
          className={panelClass("studio")}
          viewer={viewer}
          filters={applied}
          items={items}
          saved={saved}
          notify={notify}
        />
      </main>

      {/* 휴대폰: 아래 탭으로 3단을 전환 */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-line bg-panel lg:hidden">
        {(
          [
            ["conditions", "조건", "tune"],
            ["results", "추천", "spark"],
            ["studio", "스튜디오", "report"],
          ] as const
        ).map(([t, label, icon]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-xs ${tab === t ? "text-accent" : "text-muted"}`}
          >
            <Icon name={icon} size={20} />
            {label}
          </button>
        ))}
      </nav>

      <Puppy
        viewer={viewer}
        onRun={(f) => {
          setDraft(f);
          apply(f);
        }}
        current={applied}
        items={items}
      />

      {toast && (
        <div
          role="status"
          className="animate-rise fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-xl bg-brand px-4 py-3 text-sm text-brand-ink shadow-lg lg:bottom-8"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
