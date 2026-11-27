// 검색 결과를 기다리는 동안 보여 주는 화면. AI가 일하는 단계를 하나씩 보여 준다.
// 점수가 없으므로 "스코어링"이라고는 말하지 않는다.
const STEPS = ["AI가 검색 조건을 읽는 중", "AI가 조건에 맞는 매물을 찾는 중", "AI가 지도에 올리고 순서를 정리하는 중", "AI가 요약을 만드는 중"];
const STEP_SECONDS = 0.9;

export function RecommendLoading() {
  return (
    // 실제 첫 화면과 같은 2단(가운데: 접힌 조건 줄 + 추천, 오른쪽: 스튜디오) 모양으로 기다린다.
    <div className="grid min-h-0 min-w-0 gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_360px]" role="status" aria-live="polite">
      <div className="flex min-h-0 min-w-0 flex-col gap-4">
      <div className="hidden items-center gap-3 rounded-3xl border border-line bg-panel px-5 py-3 lg:flex" aria-hidden="true">
        <span className="text-sm font-medium">조건</span>
        <span className="h-3 w-40 rounded-full bg-soft" />
      </div>
      <section className="flex min-h-[18rem] flex-col rounded-3xl border border-line bg-panel lg:flex-1">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-medium">추천</h2>
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] text-accent">AI 검색 중…</span>
        </div>
        <div className="flex flex-1 flex-col gap-4 px-5 py-5">
          <div className="rounded-2xl bg-soft p-5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="animate-pulse text-accent" aria-hidden="true">
                <path d="M12 2l2.2 6.3L20 10.5l-5.8 2.2L12 19l-2.2-6.3L4 10.5l5.8-2.2z" />
              </svg>
              AI 에이전트가 일하고 있어요
            </p>
            <ol className="mt-3 flex flex-col gap-2.5 text-sm">
              {STEPS.map((step, index) => {
                const last = index === STEPS.length - 1;
                return (
                  <li key={step} className="loading-step flex items-center gap-2.5 text-muted" style={{ animationDelay: `${index * STEP_SECONDS}s` }}>
                    <span className="relative inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                      <span
                        className={`${last ? "" : "step-spin"} absolute inline-block size-4 animate-spin rounded-full border-2 border-accent border-t-transparent`}
                        style={last ? undefined : { animationDelay: `${(index + 1) * STEP_SECONDS}s` }}
                      />
                      {!last && (
                        <svg className="step-check absolute text-ok" style={{ animationDelay: `${(index + 1) * STEP_SECONDS}s` }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12l5 5 9-10" />
                        </svg>
                      )}
                    </span>
                    {step}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>
      </div>
      <div className="hidden rounded-3xl border border-line bg-panel lg:block" aria-hidden="true" />
    </div>
  );
}
