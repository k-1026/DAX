// 매물 상세 내용 — 상세 페이지와 상세 창(목록에서 누를 때) 둘 다 쓴다. (6-B: U03 점수 근거 자리, U04 신뢰 표시, U12 문의 전 확인 질문, U13 원문 링크, U14 평가)
import Link from "next/link";
import { connection } from "next/server";
import { CopyButton } from "@/app/_components/copy-button";
import { date, meaningful, sourceLabel, won } from "@/app/_components/listing-card";
import { daysSince, getListingDetail, type ListingDetail } from "@/lib/listing/detail";
import { buildQuestions } from "@/lib/listing/questions";
import { FeedbackForm } from "./feedback-form";
import { SavedProvider } from "@/app/_components/saved-provider";
import { SavedButton, SavedListSelector } from "@/app/_components/saved-button";
import { getSavedState } from "@/lib/saved/server";
import { getMapPoints } from "@/lib/search/listings";
import { PlaceLinks } from "@/app/_components/place-links";
import { ACTION_BUTTON } from "@/app/_components/action-styles";
import { DetailMemo } from "@/app/_components/detail-memo";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-24 shrink-0 text-zinc-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-3 card p-4">
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

function OutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6" />
    </svg>
  );
}

function DetailView({ item, point }: { item: ListingDetail; point: { lat: number; lng: number } | null }) {
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
  const questionText = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const cautions = [
    ...item.flags.map((flag) => flag.reason),
    ...(d.maintenance_fee === null ? ["관리비가 적혀 있지 않아요. 실제 관리비를 꼭 물어보세요."] : []),
    ...(stale ? [`중개사 확인이 ${confirmedDays}일 전이라 오래된 정보일 수 있어요.`] : []),
  ];
  const source = guest ? (
    <Link href="/login" className={ACTION_BUTTON}><OutIcon />로그인하고 원문 보기</Link>
  ) : d.url ? (
    <a href={d.url} target="_blank" rel="noopener noreferrer" className={ACTION_BUTTON} title="네이버 부동산 원문이 새 창으로 열려요"><OutIcon />네이버 원문</a>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {item.status !== "active" && (
        <p role="alert" className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
          게시가 끝난 매물입니다{item.gone_at && ` (${date(item.gone_at)} 확인)`}. 거래가 완료됐거나 중개사가 게시를 내렸습니다.
        </p>
      )}

      {/* 머리: 신뢰 배지 → 위치 → 가격 4칸 → 행동 버튼 줄 */}
      <header className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(d.subtype ?? d.property_type) && <span className="rounded-full bg-soft px-3 py-1 text-muted">{d.subtype ?? d.property_type}</span>}
          <span className={`rounded-full px-3 py-1 ${stale ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-ok-soft text-ok"}`}>
            {confirmedDays === null ? "중개사 확인일 없음" : `중개사 확인 ${confirmedDays}일 전`}
          </span>
          {cautions.length > 0 && (
            <a href="#cautions" className="rounded-full bg-amber-50 px-3 py-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">확인할 점 {cautions.length}개</a>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-medium">
            {d.gu} {d.dong}
            {floor && <span className="font-normal"> · {floor}</span>}
          </h1>
          {d.building_name && <p className="text-sm text-muted">{d.building_name}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-2xl bg-soft p-4 sm:grid-cols-4">
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
        <div className="flex flex-wrap items-center gap-2">
          <SavedButton listingId={item.id} variant="primary" />
          <PlaceLinks lat={point?.lat} lng={point?.lng} gu={d.gu} dong={d.dong} building={d.building_name} variant="buttons" />
          {source}
        </div>
        <SavedListSelector />
        <DetailMemo listingId={item.id} />
      </header>

      {cautions.length > 0 && (
        <Section title={`확인할 점 ${cautions.length}개`} id="cautions">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {cautions.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <p className="text-xs text-zinc-500">
            자동으로 찾은 확인 사항이며, 허위 매물이라는 뜻은 아닙니다. 사실과 다르면{" "}
            <Link href={`/report?kind=listing_error&listing=${item.id}`} className="underline">알려 주세요</Link>.
          </p>
        </Section>
      )}

      <Section title="위치">
        <dl className="divide-y divide-zinc-100 dark:divide-zinc-900">
          <Row label="주소">대구 {d.gu} {d.dong}{d.building_name && ` · ${d.building_name}`}</Row>
          <Row label="가까운 역">{d.station_distance_m !== null ? `약 ${won(d.station_distance_m)}m` : "정보 없음"}</Row>
          <Row label="가까운 정류장">{d.bus_stop_distance_m !== null ? `약 ${won(d.bus_stop_distance_m)}m` : "정보 없음"}</Row>
        </dl>
        <div className="flex flex-wrap gap-2">
          <PlaceLinks lat={point?.lat} lng={point?.lng} gu={d.gu} dong={d.dong} building={d.building_name} variant="buttons" />
        </div>
      </Section>

      <Section title="매물 정보">
        <dl className="divide-y divide-zinc-100 dark:divide-zinc-900">
          <Row label="전용면적">
            {d.area_m2 ?? "-"}㎡{pyeong !== null && ` (약 ${pyeong}평)`}
            {d.supply_area_m2 !== null && d.supply_area_m2 !== d.area_m2 && ` · 공급 ${d.supply_area_m2}㎡`}
          </Row>
          {d.current_use && <Row label="현재 용도">{d.current_use}</Row>}
          {recommended && <Row label="추천 용도">{recommended}</Row>}
          {d.approval_date && <Row label="사용승인일">{d.approval_date}</Row>}
          {meaningful(d.features) && <Row label="특징">{d.features}</Row>}
        </dl>
      </Section>

      <Section title="문의 준비">
        {guest ? (
          <LoginPrompt what="중개사에게 물어볼 질문과 원문 링크는" />
        ) : (
          <>
            <p className="text-xs text-muted">중개사에게 연락하기 전에 이 질문을 확인해 보세요.</p>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
              {questions.map((question) => <li key={question}>{question}</li>)}
            </ol>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={questionText} label="질문 모두 복사" className={ACTION_BUTTON} />
              {source}
              {!d.url && <span className="self-center text-xs text-muted">원문 링크가 없어요.</span>}
            </div>
          </>
        )}
      </Section>

      <Section title="점수 근거">
        <p className="text-sm text-zinc-500">미확정 · 점수 기준이 정해지면 업종별 점수와 근거가 이곳에 표시돼요.</p>
      </Section>

      <Section title="이 매물 평가하기">
        {guest ? (
          <LoginPrompt what="평가와 리뷰는" />
        ) : (
          <FeedbackForm
            listingId={item.id}
            initial={
              item.my_feedback
                ? { rating: item.my_feedback.rating, reason: item.my_feedback.bad_reasons[0] ?? null, review: item.my_feedback.review }
                : null
            }
          />
        )}
      </Section>

      <div className="flex flex-col gap-1 text-center text-xs text-zinc-500">
        <p>
          출처: {sourceLabel(item.source)} · {date(item.checked_at)} 수집
          {d.confirmed_at && ` · 중개사 확인일 ${date(d.confirmed_at)}`}
        </p>
        <p>중개사가 올린 정보를 수집한 것으로 실제와 다를 수 있어요. 공실 여부와 조건은 계약 전에 원문과 현장에서 꼭 확인하세요.</p>
        <p>
          사이트 오류나 결제·개인정보 문제가 있나요? <Link href={`/report?listing=${item.id}`} className="underline">문제 신고</Link>
        </p>
      </div>

      {/* 아래 고정 행동 줄: 스크롤해도 늘 보인다 */}
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel/95 p-3 shadow-lg backdrop-blur">
        <SavedButton listingId={item.id} variant="primary" />
        {!guest && <CopyButton text={questionText} label="질문 복사" className={ACTION_BUTTON} />}
        {source}
        <Link href="/#saved-studio" className="ml-auto text-sm underline">담은 매물 보기 →</Link>
      </div>
    </div>
  );
}

export async function DetailSection({ id, token }: { id: string; token?: string }) {
  await connection();
  const [result, savedState] = await Promise.all([getListingDetail(id, token), getSavedState()]);

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
  const points = await getMapPoints([result.id], result.tier === "guest");
  return <SavedProvider state={savedState}><DetailView item={result} point={points?.[0] ?? null} /></SavedProvider>;
}

