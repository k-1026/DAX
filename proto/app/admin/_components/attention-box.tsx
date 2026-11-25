// 개요 맨 위 "현재 관리자 확인 필요 사항": 4개 화면의 "지금 확인" 제안을 모아서 보여 준다(읽기만).
import Link from "next/link";
import type { AttentionGroup } from "@/lib/admin/screen-advice";

export function AttentionBox({ groups }: { groups: AttentionGroup[] }) {
  const nowItems = groups.flatMap((group) => group.now.map((item) => ({ group, item })));
  const soon = groups.filter((group) => group.soon.length > 0);

  return (
    <section className={`card p-4 ${nowItems.length > 0 ? "border-bad" : ""}`} aria-label="현재 관리자 확인 필요 사항">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[0.9375rem] font-medium">현재 관리자 확인 필요 사항</h2>
          <p className="text-xs text-muted">매물 갱신, 에이전트 실행, 메일 발송, 품질·개선 제안, 가중치 보정안, 사용자 현황, AI 사용량 화면의 &quot;지금 확인&quot; 제안을 모았어요.</p>
        </div>
        <span className="rounded-full bg-soft px-2.5 py-1 text-[11px] text-muted">자동 해석 · 규칙 기반 시험용</span>
      </div>

      {nowItems.length === 0 ? (
        <p className="rounded-xl bg-ok-soft px-3.5 py-3 text-sm text-ok">지금 바로 확인할 일이 없어요.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {nowItems.map(({ group, item }) => (
            <li key={`${group.screen}-${item.title}`} className="rounded-xl border border-bad bg-bad-soft px-3.5 py-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <span className="rounded-full bg-bad px-2 py-0.5 text-[11px] text-white">지금 확인</span>
                <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted">{group.label}</span>
                {item.title}
              </p>
              <p className="mt-1.5 text-xs text-muted">해석 · {item.reading}</p>
              <p className="mt-1 text-[0.8125rem]">할 일 · {item.action}</p>
              <Link href={group.href} className="mt-1.5 inline-block text-xs text-accent underline">
                {group.label} 화면에서 자세히 보기
              </Link>
            </li>
          ))}
        </ol>
      )}

      {soon.length > 0 && (
        <p className="mt-2.5 text-xs text-muted">
          곧 점검할 일도 있어요:{" "}
          {soon.map((group, index) => (
            <span key={group.screen}>
              {index > 0 && ", "}
              <Link href={group.href} className="text-accent underline">
                {group.label} {group.soon.length}건
              </Link>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
