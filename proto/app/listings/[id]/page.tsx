// 매물 상세 (6-B: U03 점수 근거 자리, U04 신뢰 표시, U12 문의 전 확인 질문, U13 원문 링크, U14 평가)
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CopyButton } from "@/app/_components/copy-button";
import { SiteLogo } from "@/app/_components/site-logo";
import { date, meaningful, sourceLabel, won } from "@/app/_components/listing-card";
import { daysSince, getListingDetail, type ListingDetail } from "@/lib/listing/detail";
import { buildQuestions } from "@/lib/listing/questions";
import { FeedbackForm } from "./feedback-form";
import { SavedProvider } from "@/app/_components/saved-provider";
import { SavedButton, SavedListSelector } from "@/app/_components/saved-button";
import { getSavedState } from "@/lib/saved/server";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-24 shrink-0 text-zinc-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 card p-4">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}

function LoginPrompt({ what }: { what: string }) {
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      {what} 로그인하면 볼 수 있어요.{" "}
      <Link href="/login" className="font-medium underline">
        무료로 로그인하기
      </Link>
    </p>
  );
}

function DetailView({ item }: { item: ListingDetail }) {
  const d = item.data;
  const guest = item.tier === "guest";
  const confirmedDays = daysSince(d.confirmed_at);
  const stale = confirmedDays !== null && confirmedDays > item.stale_days;
  const pyeong = d.area_m2 === null ? null : Math.round((d.area_m2 / 3.3058) * 10) / 10;
  const floor = [d.floor, d.total_floors && `/${d.total_floors}`].filter(Boolean).join("");
  const recommended = meaningful(d.recommended_use);
  const questions = buildQuestions({
    floor: d.floor,
    maintenanceFee: d.maintenance_fee,
    confirmedDaysAgo: confirmedDays,
    staleDays: item.stale_days,
    signals: item.flags.map((flag) => flag.signal),
  });

  return (
    <div className="flex flex-col gap-4">
      {item.status !== "active" && (
        <p role="alert" className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
          게시가 끝난 매물입니다{item.gone_at && ` (${date(item.gone_at)} 확인)`}. 거래가 완료됐거나 중개사가 게시를 내렸습니다.
        </p>
      )}

      <header className="card flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          {(d.subtype ?? d.property_type) && (
            <span className="self-start rounded-full bg-soft px-3 py-1 text-xs text-muted">{d.subtype ?? d.property_type}</span>
          )}
          <h1 className="text-xl font-medium">
            {d.gu} {d.dong}
            {floor && <span className="font-normal"> · {floor}</span>}
          </h1>
          {d.building_name && <p className="text-sm text-muted">{d.building_name}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
          {[
            ["넓이", d.area_m2 === null ? "-" : `${pyeong}평 (${d.area_m2}㎡)`],
            ["보증금", d.deposit === null ? "-" : `${won(d.deposit)}만원`],
            ["월세", d.rent === null ? "-" : `${won(d.rent)}만원`],
            ["관리비", d.maintenance_fee === null ? "안 적힘" : `${won(d.maintenance_fee)}만원`],
          ].map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-faint">{label}</dt>
              <dd className="break-words text-base font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <SavedListSelector />
          <SavedButton listingId={item.id} />
          <Link href="/#saved-studio" className="text-sm underline">담은 매물·비교 보기</Link>
        </div>
      </header>

      <Section title="신뢰 정보">
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className={`rounded px-2 py-0.5 ${stale ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-zinc-100 dark:bg-zinc-800"}`}>
            {confirmedDays === null ? "중개사 확인일 없음" : `중개사 확인 ${confirmedDays}일 전`}
            {stale && " · 오래된 정보"}
          </span>
          {d.maintenance_fee === null && (
            <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">관리비 미기재</span>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          출처: {sourceLabel(item.source)} · {date(item.checked_at)} 수집
          {d.confirmed_at && ` · 중개사 확인일 ${date(d.confirmed_at)}`}
        </p>
        <p className="text-xs leading-relaxed text-zinc-500">
          중개사가 올린 정보를 수집한 것으로 실제와 다를 수 있습니다. 공실 여부와 조건은 계약 전에 원문과 현장에서 꼭 확인하세요.
        </p>
      </Section>

      {item.flags.length > 0 && (
        <Section title="확인이 필요한 점">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {item.flags.map((flag) => (
              <li key={flag.signal}>{flag.reason}</li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">
            자동으로 찾은 확인 사항이며, 허위 매물이라는 뜻은 아닙니다. 사실과 다르면{" "}
            <Link href={`/report?kind=listing_error&listing=${item.id}`} className="underline">
              알려 주세요
            </Link>
            .
          </p>
        </Section>
      )}

      <Section title="매물 정보">
        <dl className="divide-y divide-zinc-100 dark:divide-zinc-900">
          <Row label="전용면적">
            {d.area_m2 ?? "-"}㎡{pyeong !== null && ` (약 ${pyeong}평)`}
            {d.supply_area_m2 !== null && d.supply_area_m2 !== d.area_m2 && ` · 공급 ${d.supply_area_m2}㎡`}
          </Row>
          {d.current_use && <Row label="현재 용도">{d.current_use}</Row>}
          {recommended && <Row label="추천 용도">{recommended}</Row>}
          {d.approval_date && <Row label="사용승인일">{d.approval_date}</Row>}
          {d.station_distance_m !== null && <Row label="가까운 역">약 {won(d.station_distance_m)}m</Row>}
          {d.bus_stop_distance_m !== null && <Row label="가까운 정류장">약 {won(d.bus_stop_distance_m)}m</Row>}
          {meaningful(d.features) && <Row label="특징">{d.features}</Row>}
        </dl>
      </Section>

      <Section title="점수 근거">
        <p className="text-sm text-zinc-500">미확정 · 점수 기준이 정해지면 업종별 점수와 근거가 이곳에 표시돼요.</p>
      </Section>

      <Section title="중개사에게 물어볼 질문">
        {guest ? (
          <LoginPrompt what="중개사에게 물어볼 질문은" />
        ) : (
          <>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
              {questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ol>
            <div>
              <CopyButton text={questions.map((q, i) => `${i + 1}. ${q}`).join("\n")} label="질문 모두 복사" />
            </div>
          </>
        )}
      </Section>

      <Section title="원문 보기">
        {guest ? (
          <LoginPrompt what="네이버 부동산 원문 링크는" />
        ) : d.url ? (
          <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline">
            네이버 부동산에서 원문 보기 (새 창)
          </a>
        ) : (
          <p className="text-sm text-zinc-500">원문 링크가 없습니다.</p>
        )}
      </Section>

      <Section title="이 매물 평가하기">
        {guest ? (
          <LoginPrompt what="평가와 리뷰는" />
        ) : (
          <FeedbackForm
            listingId={item.id}
            initial={
              item.my_feedback
                ? {
                    rating: item.my_feedback.rating,
                    reason: item.my_feedback.bad_reasons[0] ?? null,
                    review: item.my_feedback.review,
                  }
                : null
            }
          />
        )}
      </Section>

      <p className="text-center text-xs text-zinc-500">
        사이트 오류나 결제·개인정보 문제가 있나요?{" "}
        <Link href={`/report?listing=${item.id}`} className="underline">
          문제 신고
        </Link>
      </p>
    </div>
  );
}

async function DetailSection({ params, searchParams }: PageProps<"/listings/[id]">) {
  await connection();
  const { id } = await params;
  const { t } = await searchParams;
  const [result, savedState] = await Promise.all([getListingDetail(id, typeof t === "string" ? t : undefined), getSavedState()]);

  if (!result.found) {
    if (result.reason === "login_required") {
      return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <p className="font-medium">이 매물의 자세한 정보는 로그인하면 볼 수 있어요</p>
          <Link href="/login" className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            무료로 로그인하기
          </Link>
        </div>
      );
    }
    return (
      <p className="rounded-lg bg-zinc-50 p-6 text-center text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        {result.reason === "error" ? "매물을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." : "매물을 찾을 수 없습니다."}
      </p>
    );
  }
  return <SavedProvider state={savedState}><DetailView item={result} /></SavedProvider>;
}

export default function ListingPage(props: PageProps<"/listings/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <SiteLogo />
        <Link href="/" className="rounded-full border border-line bg-panel px-3.5 py-2 text-sm hover:bg-soft">
          ← 검색으로
        </Link>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">매물을 불러오는 중…</p>}>
        <DetailSection {...props} />
      </Suspense>
    </main>
  );
}
