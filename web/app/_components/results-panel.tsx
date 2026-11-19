"use client";
// 가운데 [추천] 패널: AI 요약 + 지도 + 순위별 공실 카드 + 질문 입력창 (NotebookLM의 "채팅" 자리)
import Link from "next/link";
import { useState } from "react";
import {
  GROUPS,
  GUEST_LIMIT,
  industryLabel,
  monthly,
  scoreLabel,
  toPyeong,
  walk,
  won,
  type Filters,
  type Item,
  type LockedItem,
  type Recommendation,
} from "@/lib/listings";
import type { Viewer } from "@/lib/viewer";
import { SUGGESTIONS, type Answer } from "./chat-engine";
import { AiText, Caret, ScoringSteps } from "./ai-bits";
import { ListingMap } from "./listing-map";
import { Icon, Panel } from "./ui";
import type { Reveal } from "./workspace";

export type ChatMsg = { role: "user"; text: string } | { role: "ai"; text: string; cites: number[] };

const TONE = { a: "bg-ok-soft text-ok", b: "bg-tile-blue text-accent", c: "bg-soft text-muted", d: "bg-warn-soft text-warn" } as const;

export function ResultsPanel(props: {
  className: string;
  viewer: Viewer;
  filters: Filters;
  rec: Recommendation | null;
  items: Item[];
  summary: Answer;
  reveal: Reveal;
  messages: ChatMsg[];
  onAsk: (q: string) => void;
  onCite: (rank: number) => void;
  feedback: Record<string, "up" | "down">;
  onRate: (item: Item, v: "up" | "down") => void;
  saved: string[];
  onSave: (item: Item) => void;
  focusId: string | null;
}) {
  const { viewer, items, rec, filters, reveal, summary: sum } = props;
  const [q, setQ] = useState("");
  const locked = rec?.locked ?? [];
  const cards: (Item | LockedItem)[] = [...items, ...locked];
  const typing = !reveal.scoring && reveal.typed < sum.text.length;

  return (
    <Panel
      title="추천"
      className={props.className}
      action={
        <span className="flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 text-xs text-muted">
          <Icon name="spark" size={13} className="text-accent" />
          AI 점수 엔진 {rec?.version ?? "v1"} · 실제 매물 {rec ? rec.total.toLocaleString() : "…"}건
        </span>
      }
    >
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-5 py-6">
          {/* AI 요약 (NotebookLM의 노트북 가이드) */}
          <article>
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-tile-blue text-2xl">
                {reveal.scoring ? <Icon name="spark" className="animate-pulse text-accent" /> : "🏬"}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-[22px] font-medium leading-tight">{industryLabel(filters.industry)}에 맞는 대구 공실</h1>
                <p className="text-sm text-muted">
                  {reveal.scoring || !rec ? "추천 계산 중" : `추천 ${rec.okCount.toLocaleString()}곳`} · {toPyeong(filters.areaMin)}~{toPyeong(filters.areaMax)}평 ·{" "}
                  {filters.rentMax >= 800 ? "월세 상관없음" : `한 달 ${won(filters.rentMax)}원 이하`}
                </p>
              </div>
              {!reveal.done && rec && (
                <button type="button" onClick={reveal.skip} className="shrink-0 rounded-full px-3 py-1.5 text-xs text-muted hover:bg-soft">
                  건너뛰기
                </button>
              )}
            </div>

            <div className="mt-4">
              {reveal.scoring ? (
                <ScoringSteps steps={reveal.steps} current={reveal.step} />
              ) : (
                <div className="animate-rise">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-accent">
                    <Icon name="spark" size={13} /> AI 분석 요약
                  </p>
                  <p className="text-[15px] leading-7">
                    {sum.text.slice(0, reveal.typed)}
                    {typing ? <Caret /> : sum.cites.map((c) => <CiteChip key={c} n={c} onClick={() => props.onCite(c)} />)}
                  </p>
                </div>
              )}
            </div>
            {!reveal.scoring && !typing && items.length > 0 && (
              <div className="animate-rise mt-3 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => props.onAsk(s)}
                    className="rounded-full border border-line px-3 py-1.5 text-[13px] text-muted hover:bg-soft hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </article>

          {/* 지도: 카드가 하나씩 나올 때마다 핀도 하나씩 */}
          <ListingMap
            listings={items}
            revealed={Math.min(reveal.revealed, items.length)}
            focusId={props.focusId}
            scoring={reveal.scoring}
            onSelect={(id) => {
              const rank = items.findIndex((r) => r.id === id) + 1;
              if (rank) props.onCite(rank);
            }}
          />

          {/* 순위 카드 */}
          <ol className="space-y-3">
            {cards.slice(0, reveal.revealed).map((l, i) =>
              "id" in l ? (
                <li key={l.id} id={`card-${l.id}`} className="animate-rise">
                  <ListingCard
                    l={l}
                    rank={i + 1}
                    member={viewer.loggedIn}
                    weights={rec?.weights ?? []}
                    focused={props.focusId === l.id}
                    feedback={props.feedback[l.id]}
                    onRate={(v) => props.onRate(l, v)}
                    saved={props.saved.includes(l.id)}
                    onSave={() => props.onSave(l)}
                    onLocate={() => props.onCite(i + 1)}
                  />
                </li>
              ) : (
                <li key={`locked-${l.rank}`} className="animate-rise">
                  <LockedCard l={l} />
                </li>
              ),
            )}
            {!reveal.scoring && reveal.revealed > 0 && reveal.revealed < cards.length && (
              <li className="flex items-center gap-2 px-2 text-sm text-muted">
                <Icon name="spark" size={14} className="animate-pulse text-accent" /> {reveal.revealed + 1}위 매물 점수 확인 중…
              </li>
            )}
          </ol>

          {!viewer.loggedIn && rec && rec.okCount > GUEST_LIMIT && reveal.done && (
            <div className="animate-rise rounded-2xl border border-dashed border-line bg-soft p-5 text-center">
              <p className="font-medium">나머지 {(rec.okCount - GUEST_LIMIT).toLocaleString()}곳과 점수 근거는 회원에게 보여드려요</p>
              <p className="mt-1 text-sm text-muted">카카오로 3초 만에 가입하고 관심 매물 저장, 비교표, 추천 메일까지 써 보세요.</p>
              <Link href="/login" className="mt-4 inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-ink">
                로그인하고 전체 보기
              </Link>
            </div>
          )}
          {viewer.loggedIn && rec && rec.okCount > items.length && reveal.done && (
            <p className="text-center text-sm text-muted">
              상위 {items.length}곳을 보여 드렸어요. 조건을 좁히면 다른 매물도 순위에 올라와요.
            </p>
          )}

          {/* 대화 */}
          {props.messages.length > 0 && (
            <div className="space-y-4 border-t border-line pt-6">
              {props.messages.map((m, i) =>
                m.role === "user" ? (
                  <p key={i} className="animate-rise ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-sm">
                    {m.text}
                  </p>
                ) : (
                  <div key={i} className="animate-rise flex gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-tile-blue text-accent">
                      <Icon name="spark" size={16} />
                    </span>
                    <p className="text-[15px] leading-7">
                      <AiText text={m.text}>
                        {m.cites.map((c) => (
                          <CiteChip key={c} n={c} onClick={() => props.onCite(c)} />
                        ))}
                      </AiText>
                    </p>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>

      {/* 입력창 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onAsk(q);
          setQ("");
        }}
        className="shrink-0 px-5 pb-4 pt-2"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-full border border-line bg-panel py-1.5 pl-5 pr-1.5 shadow-sm focus-within:border-accent">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="추천 결과에 대해 물어보세요"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-faint"
          />
          <span className="hidden text-xs text-faint sm:block">공실 {rec ? rec.okCount.toLocaleString() : "…"}곳</span>
          <button
            type="submit"
            aria-label="보내기"
            disabled={!q.trim()}
            className="grid size-10 place-items-center rounded-full bg-brand text-brand-ink disabled:opacity-30"
          >
            <Icon name="send" size={18} />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-faint">
          AI 추천은 참고용이에요. 계약 전 현장 확인과 등기부등본·건축물대장 확인을 꼭 하세요.
        </p>
      </form>
    </Panel>
  );
}

function CiteChip({ n, onClick }: { n: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${n}위 매물로 이동`}
      className="mx-0.5 inline-grid size-5 place-items-center rounded-full bg-soft align-[2px] text-[11px] font-medium text-muted hover:bg-accent-soft hover:text-ink"
    >
      {n}
    </button>
  );
}

function LockedCard({ l }: { l: LockedItem }) {
  // 서버가 내용을 보내지 않은 순위: 자리만 보여 준다
  return (
    <Link href="/login" className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-panel p-4 hover:bg-soft">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-soft text-sm font-medium">{l.rank}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-medium">
          <Icon name="lock" size={15} /> {l.gu}의 {l.rank}위 매물
        </p>
        <p className="text-sm text-muted">로그인하면 위치·가격·점수 근거를 볼 수 있어요</p>
      </div>
      <div className="grid size-14 place-items-center rounded-2xl bg-soft text-xl font-medium text-muted">{l.score}</div>
    </Link>
  );
}

function ListingCard({
  l,
  rank,
  member,
  weights,
  focused,
  feedback,
  onRate,
  saved,
  onSave,
  onLocate,
}: {
  l: Item;
  rank: number;
  member: boolean;
  weights: number[];
  focused: boolean;
  feedback?: "up" | "down";
  onRate: (v: "up" | "down") => void;
  saved: boolean;
  onSave: () => void;
  onLocate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [lab, tone] = scoreLabel(l.score);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-panel transition-shadow ${
        focused ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-soft text-sm font-medium">{rank}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="font-medium">{l.bldg || `${l.dong} ${l.fl} 상가`}</h3>
              {l.days != null && l.days <= 14 && <span className="rounded-full bg-tile-green px-2 py-0.5 text-[11px] text-ok">{l.days}일 전 확인</span>}
              {l.noPremium && <span className="rounded-full bg-tile-yellow px-2 py-0.5 text-[11px]">권리금 없음</span>}
              {l.prefBonus !== 0 && (
                <span className="rounded-full bg-tile-purple px-2 py-0.5 text-[11px]">
                  내 선호 {l.prefBonus > 0 ? "+" : ""}
                  {l.prefBonus}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {l.title}
              {l.subway != null && ` · 지하철역 ${walk(l.subway)}`}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <Stat k="넓이" v={`${toPyeong(l.areaM2)}평 (${Math.round(l.areaM2)}㎡)`} />
              <Stat k="보증금" v={`${won(l.deposit)}원`} />
              <Stat k="월세" v={`${won(l.rent)}원`} />
              <Stat k="관리비" v={l.mgmt == null ? "안 적힘" : `${won(l.mgmt)}원`} />
            </dl>
            <ul className="mt-3 space-y-1 text-[13px]">
              {l.pros.slice(0, 2).map((p) => (
                <li key={p} className="flex gap-1.5">
                  <span className="text-ok">👍</span>
                  {p}
                </li>
              ))}
              <li className="flex gap-1.5 text-muted">
                <span>⚠️</span>
                {l.cons[0]}
              </li>
            </ul>
          </div>
          <div className="text-center">
            <div className={`grid size-14 place-items-center rounded-2xl text-xl font-medium ${TONE[tone]}`}>{l.score}</div>
            <p className="mt-1 text-[11px] text-faint">{lab}</p>
          </div>
        </div>

        {open && (
          <div className="animate-rise mt-4 space-y-4 rounded-xl bg-soft p-4">
            {member ? (
              <>
                <div>
                  <p className="mb-2 text-xs text-muted">점수 근거 (그룹 점수 × 가중치)</p>
                  <div className="space-y-2">
                    {GROUPS.map((g, gi) => (
                      <div key={g.key} className="grid grid-cols-[72px_1fr_72px] items-center gap-3 text-sm">
                        <span className="text-muted">{g.label}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-panel">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${l.groups[gi] ?? 0}%` }} />
                        </span>
                        <span className="text-right tabular-nums">
                          {l.groups[gi] ?? "–"} <span className="text-faint">×{weights[gi] ?? 0}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {l.facts.flat().map((f) => (
                    <div key={f.name} className="text-sm">
                      <p className="flex items-baseline justify-between gap-2">
                        <span className="text-muted">{f.name}</span>
                        <span className="font-medium">{f.value}</span>
                      </p>
                      <p className="text-xs text-faint">{f.detail}</p>
                    </div>
                  ))}
                </div>
                {l.cons.length > 1 && (
                  <div className="text-sm">
                    <p className="mb-1 text-xs text-muted">확인할 점</p>
                    <ul className="space-y-0.5">
                      {l.cons.map((c) => (
                        <li key={c}>· {c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-faint">
                  서류상 용도: {l.useName || "정보 없음"}
                  {l.rec && ` · 매물 소개의 추천 업종: ${l.rec}`} · 한 달 합계 {won(monthly(l))}원
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Icon name="lock" size={16} /> 점수 근거와 확인할 점은 로그인 후 볼 수 있어요.
              </p>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3">
          <button type="button" onClick={() => setOpen(!open)} className="rounded-full px-3 py-1.5 text-sm text-accent hover:bg-accent-soft">
            {open ? "근거 접기" : "왜 추천됐나요?"}
          </button>
          {l.lat != null && (
            <button type="button" onClick={onLocate} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-soft">
              <Icon name="pin" size={15} /> 지도
            </button>
          )}
          {member && l.link && (
            <a href={l.link} target="_blank" rel="noreferrer" className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-soft">
              원본 매물 ↗
            </a>
          )}
          <div className="ml-auto flex items-center gap-1">
            <IconBtn label="좋아요" active={feedback === "up"} onClick={() => onRate("up")} icon="up" />
            <IconBtn label="아쉬워요" active={feedback === "down"} onClick={() => onRate("down")} icon="down" />
            <IconBtn label={saved ? "저장 취소" : "관심 매물 저장"} active={saved} onClick={onSave} icon={saved ? "bookmarkFill" : "bookmark"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-faint">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function IconBtn({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`grid size-9 place-items-center rounded-full ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-soft"}`}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}
