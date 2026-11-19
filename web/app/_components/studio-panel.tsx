"use client";
// 오른쪽 [스튜디오] 패널: 추천 결과로 리포트·비교표·시뮬레이터 등을 만든다 (NotebookLM의 "스튜디오" 자리)
import Link from "next/link";
import { useState } from "react";
import { GROUPS, industryLabel, monthly, scoreLabel, toPyeong, walk, won, type Filters, type Item } from "@/lib/listings";
import type { Viewer } from "@/lib/viewer";
import { Icon, Panel } from "./ui";

type ToolId = "report" | "compare" | "sim" | "check" | "mail" | "review";

const TOOLS: { id: ToolId; label: string; icon: string; tile: string; memberOnly: boolean; desc: string }[] = [
  { id: "report", label: "상권 리포트", icon: "report", tile: "bg-tile-blue", memberOnly: false, desc: "1위 매물 주변 상권 요약" },
  { id: "compare", label: "매물 비교표", icon: "table", tile: "bg-tile-green", memberOnly: true, desc: "저장한 매물 나란히 보기" },
  { id: "sim", label: "임대료 시뮬레이터", icon: "calc", tile: "bg-tile-yellow", memberOnly: true, desc: "예상 매출 대비 임대료 비율" },
  { id: "check", label: "현장 체크리스트", icon: "list", tile: "bg-tile-teal", memberOnly: false, desc: "방문 전 확인할 것" },
  { id: "mail", label: "추천 메일 받기", icon: "mail", tile: "bg-tile-pink", memberOnly: true, desc: "새 매물이 들어오면 알려드려요" },
  { id: "review", label: "리뷰 남기기", icon: "star", tile: "bg-tile-purple", memberOnly: true, desc: "추천 정확도를 높여 주세요" },
];

export function StudioPanel({
  className,
  viewer,
  filters,
  items,
  saved,
  notify,
}: {
  className: string;
  viewer: Viewer;
  filters: Filters;
  items: Item[];
  saved: Item[];
  notify: (t: string) => void;
}) {
  const [view, setView] = useState<ToolId | null>(null);
  const [notes, setNotes] = useState<{ tool: ToolId; title: string; at: string }[]>([]);
  const tool = TOOLS.find((t) => t.id === view);

  function open(t: (typeof TOOLS)[number]) {
    if (t.memberOnly && !viewer.loggedIn) {
      notify(`${t.label}은(는) 로그인 후 이용할 수 있어요.`);
      return;
    }
    setView(t.id);
    if (t.id === "report" || t.id === "compare") {
      const title = t.id === "report" ? `${items[0]?.dong ?? ""} 상권 리포트` : `매물 비교표 (${industryLabel(filters.industry)})`;
      setNotes((n) => [{ tool: t.id, title, at: "방금" }, ...n.filter((x) => x.title !== title)].slice(0, 5));
    }
  }

  return (
    <Panel
      title={tool ? tool.label : "스튜디오"}
      className={className}
      action={
        tool ? (
          <button type="button" onClick={() => setView(null)} aria-label="스튜디오로 돌아가기" className="grid size-8 place-items-center rounded-full hover:bg-soft">
            <Icon name="back" size={18} />
          </button>
        ) : (
          <Icon name="panel" size={18} className="text-muted" />
        )
      }
    >
      <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
        {!tool ? (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              {TOOLS.map((t) => {
                const locked = t.memberOnly && !viewer.loggedIn;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => open(t)}
                    className={`relative flex min-h-[88px] flex-col justify-between rounded-2xl p-3.5 text-left transition hover:brightness-[0.97] ${t.tile}`}
                  >
                    <Icon name={t.icon} size={20} />
                    <span>
                      <span className="block text-sm font-medium">{t.label}</span>
                      <span className="block text-[11px] text-muted">{t.desc}</span>
                    </span>
                    {locked && <Icon name="lock" size={14} className="absolute right-3 top-3.5 text-muted" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 border-t border-line pt-4">
              <h3 className="text-sm font-medium">노트</h3>
              {notes.length === 0 ? (
                <div className="py-10 text-center">
                  <Icon name="spark" size={28} className="mx-auto text-faint" />
                  <p className="mt-3 text-sm text-muted">만든 리포트와 비교표가 여기 저장돼요.</p>
                  <p className="mt-1 text-xs text-faint">위의 타일을 눌러 시작해 보세요.</p>
                </div>
              ) : (
                <ul className="mt-2 space-y-1">
                  {notes.map((n) => (
                    <li key={n.title}>
                      <button type="button" onClick={() => setView(n.tool)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-soft">
                        <Icon name={TOOLS.find((t) => t.id === n.tool)!.icon} size={18} className="text-muted" />
                        <span className="min-w-0 flex-1 truncate text-sm">{n.title}</span>
                        <span className="text-xs text-faint">{n.at}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="animate-rise">
            {view === "report" && <Report items={items} filters={filters} />}
            {view === "compare" && <Compare items={items} saved={saved} />}
            {view === "sim" && <Simulator items={items} />}
            {view === "check" && <Checklist />}
            {view === "mail" && <MailSettings viewer={viewer} notify={notify} />}
            {view === "review" && <Review notify={notify} done={() => setView(null)} />}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Report({ items, filters }: { items: Item[]; filters: Filters }) {
  const top = items[0];
  if (!top) return <p className="text-sm text-muted">추천 매물이 있어야 리포트를 만들 수 있어요.</p>;
  const ranked = GROUPS.map((g, i) => ({ label: g.label, v: top.groups[i] })).filter((g) => g.v != null) as { label: string; v: number }[];
  ranked.sort((a, b) => b.v - a.v);
  const sameDong = items.filter((x) => x.dong === top.dong).length;
  return (
    <article className="space-y-4 text-sm leading-6">
      <div>
        <p className="text-xs text-faint">AI 생성 · {industryLabel(filters.industry)} 기준 · 1위 매물</p>
        <h3 className="mt-1 text-lg font-medium">{top.gu} {top.dong} 상권 리포트</h3>
        <p className="text-xs text-muted">{top.bldg || `${top.dong} ${top.fl} 상가`}</p>
      </div>
      <section>
        <h4 className="font-medium">한 줄 요약</h4>
        <p className="text-muted">
          {ranked.length > 0 && `${ranked[0].label} 점수(${ranked[0].v}점)가 가장 강하고 ${ranked[ranked.length - 1].label}(${ranked[ranked.length - 1].v}점)은 상대적으로 약해요. `}
          {top.pros[0]}.
        </p>
      </section>
      <section>
        <h4 className="font-medium">숫자로 보기</h4>
        <ul className="mt-1 space-y-1 text-muted">
          {top.stores != null && <li>· 반경 {top.radius}m 안 가게 {top.stores}곳{top.same != null && ` (같은 업종 ${top.same}곳)`}</li>}
          {top.subway != null && <li>· 지하철역 {top.subway}m ({walk(top.subway)}), 버스정류장 {top.bus}m</li>}
          <li>
            · ㎡당 월세 약 {(top.rent / top.areaM2).toFixed(1)}만원 ({toPyeong(top.areaM2)}평 {won(top.rent)}원)
          </li>
          <li>· 서류상 용도: {top.useName || "정보 없음"}</li>
          {sameDong > 1 && <li>· 이번 추천 상위권에 같은 동네 매물 {sameDong}곳</li>}
        </ul>
      </section>
      <section className="rounded-xl bg-soft p-3">
        <h4 className="font-medium">창업 전에 확인할 점</h4>
        <ul className="text-muted">
          {top.cons.map((c) => (
            <li key={c}>· {c}</li>
          ))}
          <li>· 평일 점심·저녁, 주말 오후에 각각 30분씩 지나가는 사람을 직접 세어 보세요.</li>
        </ul>
      </section>
    </article>
  );
}

function Compare({ items, saved }: { items: Item[]; saved: Item[] }) {
  const picked = saved.length >= 2 ? saved.slice(0, 4) : items.slice(0, 3);
  const rows: [string, (l: Item) => string][] = [
    ["점수", (l) => `${l.score} (${scoreLabel(l.score)[0]})`],
    ["위치", (l) => `${l.gu} ${l.dong}`],
    ["층", (l) => l.fl],
    ["넓이", (l) => `${toPyeong(l.areaM2)}평`],
    ["보증금", (l) => won(l.deposit)],
    ["한 달 합계", (l) => `${won(monthly(l))}${l.mgmt == null ? " (관리비 미기재)" : ""}`],
    ["지하철역", (l) => (l.subway == null ? "정보 없음" : walk(l.subway))],
    ...GROUPS.map((g, i) => [`${g.label} 점수`, (l: Item) => (l.groups[i] == null ? "–" : String(l.groups[i]))] as [string, (l: Item) => string]),
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{saved.length >= 2 ? "저장한 매물" : "저장한 매물이 2개 미만이라 상위 3곳"}을 비교해요.</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-soft">
            <tr>
              <th className="px-3 py-2 text-left font-normal text-muted">항목</th>
              {picked.map((l) => (
                <th key={l.id} className="px-3 py-2 text-left font-medium">
                  {l.bldg || l.dong}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, f]) => (
              <tr key={k} className="border-t border-line">
                <td className="whitespace-nowrap px-3 py-2 text-muted">{k}</td>
                {picked.map((l) => (
                  <td key={l.id} className="px-3 py-2 tabular-nums">
                    {f(l)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Simulator({ items }: { items: Item[] }) {
  const [sales, setSales] = useState(2500);
  const top = items[0];
  if (!top) return null;
  const m = monthly(top);
  const ratio = Math.round((m / sales) * 100);
  const tone = ratio <= 10 ? "text-ok" : ratio <= 15 ? "text-warn" : "text-bad";
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">1위 매물 {top.title} 기준이에요. 보통 매출 대비 임대료가 10% 이하면 안정적, 15%를 넘으면 위험 신호로 봐요.</p>
      <label className="block">
        <span className="flex justify-between">
          <span>예상 월 매출</span>
          <span className="font-medium">{won(sales)}원</span>
        </span>
        <input type="range" min={500} max={8000} step={100} value={sales} onChange={(e) => setSales(Number(e.target.value))} className="mt-2 w-full" />
      </label>
      <div className="rounded-2xl bg-soft p-4 text-center">
        <p className="text-xs text-muted">
          월세+관리비 {won(m)}원{top.mgmt == null ? " (관리비 미기재)" : ""} ÷ 매출
        </p>
        <p className={`mt-1 text-4xl font-medium ${tone}`}>{ratio}%</p>
        <p className="mt-1 text-xs text-muted">{ratio <= 10 ? "안정적이에요" : ratio <= 15 ? "주의가 필요해요" : "부담이 커요"}</p>
      </div>
    </div>
  );
}

function Checklist() {
  const items = ["등기부등본으로 소유자·근저당 확인", "건축물대장의 용도(근린생활시설) 확인", "업종 제한·관리규약 확인", "전기 용량·급배수·가스 확인", "간판 설치 가능 위치", "권리금과 원상복구 조건", "평일/주말 유동 인구 직접 확인"];
  const [done, setDone] = useState<number[]>([]);
  return (
    <ul className="space-y-1">
      {items.map((t, i) => {
        const on = done.includes(i);
        return (
          <li key={t}>
            <button type="button" onClick={() => setDone(on ? done.filter((x) => x !== i) : [...done, i])} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left text-sm hover:bg-soft">
              <span className={`grid size-5 place-items-center rounded-md border ${on ? "border-accent bg-accent text-panel" : "border-faint"}`}>{on && <Icon name="check" size={14} />}</span>
              <span className={on ? "text-faint line-through" : ""}>{t}</span>
            </button>
          </li>
        );
      })}
      <li className="px-2 pt-2 text-xs text-faint">
        {done.length}/{items.length} 완료
      </li>
    </ul>
  );
}

function MailSettings({ viewer, notify }: { viewer: Viewer; notify: (t: string) => void }) {
  const [on, setOn] = useState(true);
  const [freq, setFreq] = useState("갱신될 때마다 (3일)");
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between rounded-2xl bg-soft p-4">
        <div>
          <p className="font-medium">추천 메일</p>
          <p className="text-xs text-muted">{viewer.email ?? "가입 이메일"}로 보내요</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="추천 메일 받기"
          onClick={() => {
            setOn(!on);
            notify(on ? "추천 메일을 껐어요." : "추천 메일을 켰어요.");
          }}
          className={`relative h-6 w-11 rounded-full transition ${on ? "bg-accent" : "bg-line"}`}
        >
          <span className={`absolute top-0.5 size-5 rounded-full bg-panel shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      <fieldset className="space-y-1" disabled={!on}>
        <legend className="mb-1 font-medium">받는 주기</legend>
        {["갱신될 때마다 (3일)", "주 1회 (월요일 아침)", "점수 85점 이상 새 매물만"].map((f) => (
          <label key={f} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-soft">
            <input type="radio" name="freq" checked={freq === f} onChange={() => setFreq(f)} className="accent-[var(--accent)]" />
            {f}
          </label>
        ))}
      </fieldset>
      <Link href="/mail-preview" className="flex items-center justify-between rounded-xl border border-line px-4 py-3 hover:bg-soft">
        이번 주 메일 미리보기 <Icon name="chevron" size={18} />
      </Link>
    </div>
  );
}

function Review({ notify, done }: { notify: (t: string) => void; done: () => void }) {
  const [stars, setStars] = useState(0);
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const opts = ["임대료가 실제와 달라요", "업종이 잘 맞아요", "이미 계약된 매물", "지역이 좋아요", "유동인구가 생각보다 적어요"];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        notify("고마워요! 리뷰는 다음 점수 규칙 업데이트(v2)에 반영돼요.");
        done();
      }}
      className="space-y-4 text-sm"
    >
      <p className="text-muted">이번 추천이 얼마나 맞았나요? 리뷰는 리뷰 분석 에이전트가 모아 점수 공식을 고치는 데 써요.</p>
      <div className="flex gap-1" role="radiogroup" aria-label="별점">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n}점`} onClick={() => setStars(n)} className={n <= stars ? "text-warn" : "text-line"}>
            <Icon name="star" size={30} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {opts.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={tags.includes(o)}
            onClick={() => setTags(tags.includes(o) ? tags.filter((x) => x !== o) : [...tags, o])}
            className={`rounded-full border px-3 py-1.5 text-[13px] ${tags.includes(o) ? "border-transparent bg-accent-soft" : "border-line text-muted"}`}
          >
            {o}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="자세히 알려 주시면 더 좋아요" className="w-full rounded-xl border border-line bg-transparent p-3 outline-none focus:border-accent" />
      <button type="submit" disabled={stars === 0} className="w-full rounded-full bg-brand py-3 font-medium text-brand-ink disabled:opacity-40">
        리뷰 보내기
      </button>
    </form>
  );
}
