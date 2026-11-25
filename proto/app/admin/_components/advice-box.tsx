// "다음에 할 일 제안" 박스: 관리자 화면 4곳이 같이 쓴다. 규칙은 content/admin-playbook/*.md에서 온다.
import type { Advice } from "@/lib/admin/playbook";

const LABEL = { now: "지금 확인", soon: "곧 점검", info: "참고" } as const;

export function AdviceBox({ advice, errors, scope }: { advice: Advice[]; errors: string[]; scope: string }) {
  return (
    <section className="card p-4" aria-label="다음에 할 일 제안">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[0.9375rem] font-medium">다음에 할 일 제안</h2>
          <p className="text-xs text-muted">{scope}</p>
        </div>
        <span className="rounded-full bg-soft px-2.5 py-1 text-[11px] text-muted">자동 해석 · 규칙 기반 시험용</span>
      </div>
      <ol className="flex flex-col gap-2.5">
        {advice.map((item) => (
          <li key={item.title} className={`rounded-xl border px-3.5 py-3 text-sm ${item.level === "now" ? "border-bad bg-bad-soft" : item.level === "soon" ? "border-warn bg-warn-soft" : "border-line bg-soft"}`}>
            <p className="flex items-center gap-2 font-medium">
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${item.level === "now" ? "bg-bad text-white" : item.level === "soon" ? "bg-warn text-white" : "bg-panel text-muted"}`}>{LABEL[item.level]}</span>
              {item.title}
            </p>
            <p className="mt-1.5 text-xs text-muted">해석 · {item.reading}</p>
            <p className="mt-1 text-[0.8125rem]">할 일 · {item.action}</p>
          </li>
        ))}
      </ol>
      {errors.length > 0 && (
        <details className="mt-2.5 rounded-xl bg-warn-soft px-3.5 py-2.5 text-xs text-warn">
          <summary className="cursor-pointer font-medium">규칙 파일에 고칠 곳이 {errors.length}군데 있어요 (나머지 규칙은 정상 동작해요)</summary>
          <ul className="mt-1.5 list-disc pl-4">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-2.5 text-xs text-faint">정해 둔 규칙으로 만든 제안이에요(AI 판단이 아니에요). 문구와 기준 숫자는 규칙 파일(md)에서 고쳐요. 사용자가 늘면 기준 숫자를 다시 맞춰야 해요.</p>
    </section>
  );
}
