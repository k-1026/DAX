"use client";
// 왼쪽 [조건] 패널: NotebookLM의 "출처" 자리. 업종·면적·가격·지역을 고른다.
import { useState } from "react";
import {
  DEPOSIT_ANY,
  GU_LIST,
  INDUSTRIES,
  PRIORITIES,
  RENT_ANY,
  toPyeong,
  won,
  type Filters,
  type Floor,
  type Gu,
  type IndustryId,
} from "@/lib/listings";
import type { Viewer } from "@/lib/viewer";
import { Icon, Panel } from "./ui";

const FLOORS: Floor[] = ["1층", "지상 2층 이상", "지하"];

// "수성구에서 20평 카페, 월세 200 이하" 같은 문장에서 조건을 뽑아낸다 (데모용 간단 규칙)
function parseSentence(text: string, base: Filters): Filters {
  const next = { ...base };
  const words: Record<string, string[]> = {
    식음료: ["카페", "식당", "음식", "술집", "주점", "베이커리"],
    소매: ["옷", "잡화", "편의점", "소매", "가게"],
    뷰티: ["미용", "네일", "헤어", "피부"],
    공연문화: ["공연", "전시", "스튜디오", "공방"],
    사무업무: ["사무실", "사무"],
    교육: ["학원", "교습", "공부방"],
    의료: ["병원", "의원", "약국", "치과", "한의원"],
    운동시설: ["헬스", "필라테스", "요가", "체육"],
  };
  const ind = INDUSTRIES.find((i) => words[i.id].some((w) => text.includes(w)));
  if (ind) next.industry = ind.id;
  const gus = GU_LIST.filter((g) => text.includes(g) || text.includes(g.slice(0, 2)));
  if (gus.length) next.gus = gus;
  const py = text.match(/(\d+)\s*평/);
  if (py) {
    const m2 = Number(py[1]) * 3.3058;
    next.areaMin = Math.round(m2 * 0.75);
    next.areaMax = Math.round(m2 * 1.3);
  }
  const rent = text.match(/월세\s*(\d+)/);
  if (rent) next.rentMax = Number(rent[1]);
  const dep = text.match(/보증금\s*(\d+)/);
  if (dep) next.depositMax = Number(dep[1]) < 100 ? Number(dep[1]) * 1000 : Number(dep[1]);
  if (text.includes("1층")) next.floors = ["1층"];
  return next;
}

export function ConditionsPanel({
  className,
  draft,
  setDraft,
  onApply,
  viewer,
  feedbackCount,
  savedCount,
  meta,
}: {
  className: string;
  draft: Filters;
  setDraft: (f: Filters) => void;
  onApply: (f?: Filters) => void;
  viewer: Viewer;
  feedbackCount: number;
  savedCount: number;
  meta: { date: string; total: number } | null;
}) {
  const [sentence, setSentence] = useState("");
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft({ ...draft, [k]: v });
  const toggleGu = (g: Gu) =>
    set("gus", draft.gus.includes(g) ? draft.gus.filter((x) => x !== g) : [...draft.gus, g]);
  const toggleFloor = (f: Floor) =>
    set("floors", draft.floors.includes(f) ? draft.floors.filter((x) => x !== f) : [...draft.floors, f]);
  const allGu = draft.gus.length === GU_LIST.length;

  return (
    <Panel
      title="조건"
      className={className}
      action={<Icon name="panel" size={18} className="text-muted" />}
    >
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto px-5 py-4">
        {/* 문장으로 찾기 */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = parseSentence(sentence, draft);
            setDraft(next);
            onApply(next);
          }}
          className="rounded-2xl border border-line bg-soft p-3"
        >
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <Icon name="spark" size={14} className="text-accent" /> 문장으로 찾기
          </label>
          <textarea
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            rows={2}
            placeholder="예: 수성구 20평 카페, 월세 200 이하 1층"
            className="mt-2 w-full resize-none bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <div className="flex justify-end">
            <button type="submit" className="rounded-full bg-panel px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-accent-soft">
              조건으로 바꾸기
            </button>
          </div>
        </form>

        <Field label="업종">
          <div className="flex flex-wrap gap-2">
            {INDUSTRIES.map((i) => (
              <Chip key={i.id} active={draft.industry === i.id} onClick={() => set("industry", i.id as IndustryId)}>
                <span aria-hidden>{i.emoji}</span> {i.label}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="면적" value={`${toPyeong(draft.areaMin)}~${toPyeong(draft.areaMax)}평 (${draft.areaMin}~${draft.areaMax}㎡)`}>
          <Range label="최소" min={20} max={180} step={1} value={draft.areaMin} onChange={(v) => set("areaMin", Math.min(v, draft.areaMax - 5))} />
          <Range label="최대" min={25} max={200} step={1} value={draft.areaMax} onChange={(v) => set("areaMax", Math.max(v, draft.areaMin + 5))} />
        </Field>

        <Field label="보증금 상한" value={draft.depositMax >= DEPOSIT_ANY ? "상관없음" : `${won(draft.depositMax)}원`}>
          <Range label="보증금" min={500} max={DEPOSIT_ANY} step={500} value={draft.depositMax} onChange={(v) => set("depositMax", v)} />
        </Field>

        <Field label="월세+관리비 상한" value={draft.rentMax >= RENT_ANY ? "상관없음" : `${won(draft.rentMax)}원`}>
          <Range label="월세" min={50} max={RENT_ANY} step={10} value={draft.rentMax} onChange={(v) => set("rentMax", v)} />
        </Field>

        <Field label="무엇을 가장 중요하게 볼까요?">
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((p, i) => (
              <Chip key={p} active={draft.prio === i} onClick={() => set("prio", i)}>
                {p}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-faint">고른 항목을 점수에 더 크게 반영해요.</p>
        </Field>

        <Field label="층">
          <div className="flex flex-wrap gap-2">
            {FLOORS.map((f) => (
              <Chip key={f} active={draft.floors.includes(f)} onClick={() => toggleFloor(f)}>
                {f}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="지역">
          <ul className="overflow-hidden rounded-xl border border-line">
            <li className="flex items-center justify-between border-b border-line bg-soft px-3 py-2 text-sm">
              <span className="text-muted">모든 지역 선택</span>
              <Check checked={allGu} onChange={() => set("gus", allGu ? [] : [...GU_LIST])} label="모든 지역" />
            </li>
            {GU_LIST.map((g) => (
              <li key={g} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-soft">
                <span className="flex items-center gap-2">
                  <Icon name="pin" size={16} className="text-faint" />
                  {g}
                </span>
                <Check checked={draft.gus.includes(g)} onChange={() => toggleGu(g)} label={g} />
              </li>
            ))}
          </ul>
        </Field>

        {viewer.loggedIn ? (
          <div className="rounded-2xl bg-tile-purple p-4 text-sm">
            <p className="font-medium">내 선호가 반영되고 있어요</p>
            <p className="mt-1 text-muted">
              평가 {feedbackCount}건 · 저장 {savedCount}건. 좋아요한 지역은 최대 +4점 가산돼요.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-soft p-4 text-sm">
            <p className="font-medium">로그인하면 더 정확해져요</p>
            <p className="mt-1 text-muted">평가와 저장이 내 추천 점수에 반영되고, 새 매물 추천 메일을 받을 수 있어요.</p>
          </div>
        )}
      </div>

      <footer className="shrink-0 space-y-3 border-t border-line px-5 py-4">
        <button
          type="button"
          onClick={() => onApply()}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-medium text-brand-ink hover:opacity-90"
        >
          <Icon name="spark" size={16} /> 이 조건으로 추천 받기
        </button>
        <p className="flex items-center gap-1.5 text-xs text-faint">
          <Icon name="refresh" size={14} />
          {meta ? `실제 매물 ${meta.total.toLocaleString()}건 · ${meta.date} 기준 · 3일마다 갱신 예정` : "매물 정보 불러오는 중…"}
        </p>
      </footer>
    </Panel>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{label}</h3>
        {value && <span className="text-xs text-muted">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
        active ? "border-transparent bg-accent-soft text-ink" : "border-line text-muted hover:bg-soft"
      }`}
    >
      {children}
    </button>
  );
}

function Range({ label, ...p }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      aria-label={label}
      min={p.min}
      max={p.max}
      step={p.step}
      value={p.value}
      onChange={(e) => p.onChange(Number(e.target.value))}
      className="w-full"
    />
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`grid size-[18px] place-items-center rounded-[5px] border ${checked ? "border-accent bg-accent text-panel" : "border-faint"}`}
    >
      {checked && <Icon name="check" size={14} />}
    </button>
  );
}
