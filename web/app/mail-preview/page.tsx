// 기존 회원에게 보내는 맞춤 추천 메일 미리보기
// 실제 발송은 추천 메일 에이전트가 회원별 조건·선호로 이 틀을 채워 메일 서비스로 보낸다.
import Link from "next/link";
import { MAIL } from "@/lib/admin-data";
import { recommend } from "@/lib/engine";
import { DEFAULT_FILTERS, industryLabel, toPyeong, won } from "@/lib/listings";

export default function MailPreview() {
  // 실제 매물로 계산: 최근 2주 안에 확인된 매물 중 점수 높은 3곳 (없으면 전체 상위 3곳)
  const rec = recommend(DEFAULT_FILTERS, { member: true, limit: 50 });
  const fresh = rec.items.filter((l) => l.days != null && l.days <= 14).slice(0, 3);
  const list = fresh.length >= 3 ? fresh : rec.items.slice(0, 3);

  return (
    <main className="flex-1 px-4 py-8">
      <div className="mx-auto mb-4 flex max-w-[640px] items-center justify-between text-sm text-muted">
        <span>메일 미리보기 · 캠페인 #28 (발송 예정 {MAIL.nextSend})</span>
        <Link href="/" className="hover:text-ink">← 서비스로</Link>
      </div>

      <article className="mx-auto max-w-[640px] overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="border-b border-line px-6 py-4 text-sm">
          <p><span className="text-muted">보낸 사람</span> 대구 공실 매칭</p>
          <p><span className="text-muted">제목</span> <b className="font-medium">{industryLabel(DEFAULT_FILTERS.industry)} 하기 좋은 대구 공실 3곳을 골랐어요</b></p>
        </div>

        <div className="bg-tile-blue px-6 py-8">
          <p className="text-sm text-muted">○○ 님, 안녕하세요</p>
          <h1 className="mt-1 text-2xl font-medium leading-snug">
            최근 확인된 대구 빈 상가 중
            <br />
            ○○ 님 조건에 가장 잘 맞는 곳이에요
          </h1>
          <p className="mt-3 text-sm text-muted">
            {industryLabel(DEFAULT_FILTERS.industry)} · {toPyeong(DEFAULT_FILTERS.areaMin)}~{toPyeong(DEFAULT_FILTERS.areaMax)}평 · 한 달 {won(DEFAULT_FILTERS.rentMax)}원 이하 · 매물 {rec.date} 기준
          </p>
        </div>

        <ol className="space-y-3 px-6 py-6">
          {list.map((l, i) => (
            <li key={l.id} className="flex items-center gap-4 rounded-xl border border-line p-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-soft text-sm font-medium">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{l.bldg || l.title}</p>
                <p className="text-sm text-muted">
                  {l.gu} {l.dong} {l.fl} · {toPyeong(l.areaM2)}평 · 보증금 {won(l.deposit)} / 월 {won(l.rent)}
                </p>
              </div>
              <span className="rounded-xl bg-ok-soft px-3 py-2 text-lg font-medium text-ok">{l.score}</span>
            </li>
          ))}
        </ol>

        <div className="px-6 pb-8 text-center">
          <Link href="/" className="inline-block rounded-full bg-brand px-6 py-3 text-sm font-medium text-brand-ink">
            추천 이유 자세히 보기
          </Link>
          <p className="mt-6 text-sm text-muted">이번 추천은 어땠나요?</p>
          <div className="mt-2 flex justify-center gap-2 text-sm">
            <span className="rounded-full border border-line px-4 py-2">👍 잘 맞아요</span>
            <span className="rounded-full border border-line px-4 py-2">👎 별로예요</span>
          </div>
          <p className="mt-2 text-xs text-faint">눌러 주신 평가는 다음 추천 점수에 반영돼요.</p>
        </div>

        <footer className="border-t border-line bg-soft px-6 py-4 text-center text-xs text-faint">
          이 메일은 추천 메일 받기를 켠 회원에게 발송돼요. 수신 거부 · 받는 주기 변경
        </footer>
      </article>
    </main>
  );
}
