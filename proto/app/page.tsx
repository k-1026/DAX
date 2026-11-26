// 첫 화면 = 매물 검색 (6-A: U01 필터, U02 목록·정렬, U05 상태 표시, U06 로그인 벽, U23 글자 크기)
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Avatar } from "@/app/_components/avatar";
import { FontSizeControl } from "@/app/_components/font-size-control";
import { date, ListingCardView, won } from "@/app/_components/listing-card";
import { ListingMap, type MapPin } from "@/app/_components/listing-map";
import { Panel } from "@/app/_components/panel";
import { SiteLogo } from "@/app/_components/site-logo";
import { AreaRange, LimitSlider } from "@/app/_components/range-fields";
import { RegionList } from "@/app/_components/region-list";
import { SentenceSearch } from "@/app/_components/sentence-search";
import { SummaryChips } from "@/app/_components/summary-chips";
import { AskBar } from "@/app/_components/ask-bar";
import { PrefNote } from "@/app/_components/pref-note";
import { AiSummary } from "@/app/_components/typed-text";
import { GongsilChat } from "@/app/_components/gongsil-chat";
import { PanelLayout, Slot } from "@/app/_components/panel-layout";
import { RecommendLoading } from "@/app/_components/recommend-loading";
import { conditionLine, summaryText } from "@/lib/ai/summary-text";
import { getSearchSummary } from "@/lib/search/summary";
import { getAiStatus } from "@/lib/ai/usage";
import { ShareButton } from "@/app/_components/share-button";
import { SavedProvider } from "@/app/_components/saved-provider";
import { SavedStudio } from "@/app/_components/saved-studio";
import { getSavedState } from "@/lib/saved/server";
import { daysSince } from "@/lib/listing/detail";
import {
  getAreas,
  FLOOR_OPTIONS,
  getMapPoints,
  type ListingCard,
  parseSearchParams,
  searchListings,
  SORTS,
  type SearchFilters,
  type SortKey,
} from "@/lib/search/listings";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

async function UserStatus() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;

  // 로그인 상태는 요청할 때마다 확인한다.
  await connection();

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) {
    return (
      <Link
        href="/login"
        className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-ink"
      >
        로그인 / 회원가입
      </Link>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", claims.sub)
    .maybeSingle();
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    profile?.display_name ??
    (meta.name as string) ??
    (meta.full_name as string) ??
    claims.email ??
    "회원";

  return (
    <div className="flex items-center gap-3 text-sm">
      <Link href="/mypage" aria-label="마이페이지로 이동" title="마이페이지">
        <Avatar url={profile?.avatar_url} name={name} size={36} />
      </Link>
      <span className="hidden sm:inline">{name} 님</span>
      <Link href="/mypage" className="underline">
        마이페이지
      </Link>
      <form action={signOut}>
        <button type="submit" className="text-zinc-600 underline dark:text-zinc-400">
          로그아웃
        </button>
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";

function SearchForm({
  areas,
  filters,
  sort,
  canSort,
  alwaysOpen = false,
  bare = false,
  prefHref,
}: {
  prefHref?: string;
  bare?: boolean;
  areas: Record<string, string[]>;
  filters: SearchFilters;
  sort: SortKey;
  canSort: boolean;
  alwaysOpen?: boolean;
}) {
  const active =
    (filters.gu.length > 0 ? 1 : 0) +
    (filters.dong.length > 0 ? 1 : 0) +
    (filters.floors.length > 0 ? 1 : 0) +
    [filters.rent_max, filters.deposit_max, filters.area_min, filters.area_max].filter((v) => v !== undefined).length;
  // 넓은 화면(왼쪽 칸)에서는 늘 펼친다. 좁은 화면은 처음엔 펼치고, 검색한 뒤에는 결과가 바로 보이게 접는다.
  const open = alwaysOpen || (active === 0 && sort === "recommended");
  return (
    <details open={bare || open} className={bare ? "group [&>summary]:hidden" : "group card"}>
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium">
        <span>
          검색 조건{active > 0 && <span className="ml-1 text-blue-700 dark:text-blue-300">({active}개 적용)</span>}
        </span>
        <span className="text-zinc-500 group-open:hidden">펼치기</span>
        <span className="hidden text-zinc-500 group-open:inline">접기</span>
      </summary>
    <form id={bare ? "search-form" : undefined} action="/" method="get" className={`flex flex-col gap-4 ${bare ? "" : "border-t border-zinc-200 p-4 dark:border-zinc-800"}`}>
      <div className="flex flex-col gap-1.5 text-sm">
        <span>업종</span>
        <p className="rounded-xl border border-dashed border-line bg-soft px-3 py-3 text-xs text-muted">
          미확정 · 업종 목록은 5단계에서 정해져요.
        </p>
      </div>


      <AreaRange min={filters.area_min} max={filters.area_max} />
      <LimitSlider name="deposit_max" label="보증금 상한" kind="deposit" value={filters.deposit_max} />
      <LimitSlider name="rent_max" label="월세+관리비 상한" kind="rent" value={filters.rent_max} />
      <p className="-mt-2 text-xs text-muted">
        슬라이더를 끝까지 밀면 제한 없음이에요. 관리비가 적혀 있지 않은 매물은 관리비를 0으로 계산해요.
      </p>

      <div className="flex flex-col gap-1.5 text-sm">
        <span>무엇을 가장 중요하게 볼까요?</span>
        <p className="rounded-xl border border-dashed border-line bg-soft px-3 py-3 text-xs text-muted">
          미확정 · 점수 기준이 정해지면 열려요.
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm">층</legend>
        <div className="flex flex-wrap gap-2">
          {FLOOR_OPTIONS.map((option) => (
            <label key={option.key} className="cursor-pointer rounded-full border border-line px-3.5 py-1.5 text-sm has-[:checked]:border-transparent has-[:checked]:bg-accent-soft has-[:checked]:text-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
              <input type="checkbox" name="floors" value={option.key} defaultChecked={filters.floors.includes(option.key)} className="sr-only" />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <RegionList areas={Object.keys(areas)} selected={filters.gu} />
        <details className="text-sm" open={filters.dong.length > 0}>
          <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">동 고르기</summary>
          <div className="mt-2 flex flex-col gap-3">
            {Object.entries(areas).map(([gu, dongs]) => (
              <div key={gu}>
                <p className="mb-1 font-medium">{gu}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {dongs.map((dong) => (
                    <label key={`${gu}-${dong}`} className="flex items-center gap-1">
                      <input type="checkbox" name="dong" value={dong} defaultChecked={filters.dong.includes(dong)} />
                      {dong}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span>정렬</span>
        <select name="sort" defaultValue={sort} disabled={!canSort} className={inputClass}>
          {SORTS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        {!canSort && <span className="text-xs text-zinc-500">정렬은 로그인하면 바꿀 수 있습니다.</span>}
      </label>

      {!bare && (
        <>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 rounded-full bg-brand py-2.5 text-sm font-medium text-brand-ink">
              검색
            </button>
            <Link href="/" className="rounded-full border border-line px-4 py-2.5 text-sm">
              초기화
            </Link>
          </div>
          {prefHref && (
            <Link href={prefHref} className="text-center text-sm underline">
              내 선호 조건으로 검색
            </Link>
          )}
        </>
      )}
    </form>
    </details>
  );
}

function pageLink(params: Record<string, string | string[] | undefined>, offset: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "offset" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) if (item !== "") query.append(key, item);
  }
  if (offset > 0) query.set("offset", String(offset));
  const text = query.toString();
  return text ? `/?${text}` : "/";
}

// 01 문서 기준값 listing.stale_days(30일)와 같게 맞춘다.
const STALE_DAYS = 30;

function buildPins(items: ListingCard[], points: { id: string; lat: number; lng: number }[], offset: number): MapPin[] {
  const byId = new Map(points.map((point) => [point.id, point]));
  return items.flatMap((card, index) => {
    const point = byId.get(card.id);
    if (!point) return [];
    const days = daysSince(card.confirmed_at);
    const floor = card.floor ? ` ${card.floor}` : "";
    return [
      {
        n: offset + index + 1,
        id: card.id,
        href: `/listings/${card.id}${card.detail_token ? `?t=${card.detail_token}` : ""}`,
        lat: point.lat,
        lng: point.lng,
        title: `${card.gu} ${card.dong}${floor}`,
        price: `보증금 ${won(card.deposit)} / 월세 ${won(card.rent)} (만원)`,
        info: `전용 ${card.area_m2 ?? "-"}㎡ · 관리비 ${card.maintenance_fee === null ? "미기재" : `${won(card.maintenance_fee)}만원`}`,
        freshness:
          days === null
            ? `중개사 확인일 없음 · ${date(card.checked_at)} 수집`
            : `중개사 확인 ${days}일 전${days > STALE_DAYS ? " · 오래된 정보" : ""}`,
        stale: days !== null && days > STALE_DAYS,
      },
    ];
  });
}

async function SearchSection({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  // 검색 결과는 요청할 때마다 만든다(로그인 확인에 현재 시각을 쓰기 때문).
  await connection();
  const params = await searchParams;
  const { filters, sort, offset } = parseSearchParams(params);
  const [result, areas, savedState] = await Promise.all([searchListings(filters, sort, offset), getAreas(), getSavedState()]);
  const guest = result.tier === "guest";
  const points = result.items.length > 0 ? await getMapPoints(result.items.map((card) => card.id), guest) : [];
  // 회원이면 이 쪽 매물에 내가 남긴 좋아요·싫어요를 함께 읽는다.
  const myRatings = new Map<string, "good" | "bad">();
  if (!guest && result.items.length > 0) {
    const supabase = await createClient();
    const { data: mine } = await supabase
      .from("listing_feedback")
      .select("listing_id, rating")
      .in("listing_id", result.items.map((card) => card.id))
      .is("category_id", null);
    for (const row of mine ?? []) myRatings.set(row.listing_id, row.rating as "good" | "bad");
  }
  const pins = points ? buildPins(result.items, points, result.offset) : null;
  const pointById = new Map((points ?? []).map((point) => [point.id, point]));
  // 회원이 선호 조건을 저장해 뒀으면 "내 선호 조건으로 검색" 링크를 만든다.
  let prefHref: string | undefined;
  if (!guest) {
    const supabase = await createClient();
    const { data: prefs } = await supabase.rpc("my_preferences");
    const saved = (prefs ?? {}) as Record<string, unknown>;
    const query = new URLSearchParams();
    for (const gu of Array.isArray(saved.gu) ? saved.gu : []) query.append("gu", String(gu));
    for (const key of ["rent_max", "deposit_max", "area_min", "area_max"]) {
      if (typeof saved[key] === "number") query.set(key, String(saved[key]));
    }
    if (query.size > 0) prefHref = `/?${query.toString()}`;
  }
  const aiStatus = await getAiStatus();
  const { summary } = await getSearchSummary(filters);
  const searchString = (() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "offset" || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) if (item !== "") query.append(key, item);
    }
    return query.toString();
  })();
  const headingLine = conditionLine(filters);
  const aiBox = <SentenceSearch summary={aiStatus} />;
  const formProps = { areas, filters, sort: result.sort ?? sort, canSort: !guest, prefHref };

  return (
    <SavedProvider state={savedState}>
    <PanelLayout>
      <div className="flex flex-col gap-4 lg:hidden">
        {aiBox}
        <SearchForm {...formProps} />
      </div>
      <Slot side="left" label="조건" mobileHidden>
      <Panel
        title="조건"
        label="검색 조건"
        className="hidden lg:flex"
        footer={
          <div className="flex flex-col gap-2">
            <button type="submit" form="search-form" className="inline-flex items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-medium text-brand-ink">
              이 조건으로 추천 받기
            </button>
            <div className="flex items-center justify-center gap-4 text-xs">
              <Link href="/" className="underline">초기화</Link>
              {prefHref && <Link href={prefHref} className="underline">내 선호 조건으로 검색</Link>}
            </div>
            <p className="text-center text-[11px] text-faint">네이버 부동산 실제 매물 · 3일마다 갱신 예정</p>
            <p className="flex justify-center gap-3 text-[11px] text-faint">
              <Link href="/terms" className="underline">이용약관</Link>
              <Link href="/privacy" className="font-medium underline">개인정보 처리방침</Link>
              <Link href="/report" className="underline">문제 신고</Link>
            </p>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          {aiBox}
          <SearchForm {...formProps} alwaysOpen bare />
          <PrefNote />
        </div>
      </Panel>
      </Slot>

      <Slot side="center">
      <Panel title="추천" right={<span className="text-xs text-muted">조건에 맞는 매물 {(result.total ?? 0).toLocaleString("ko-KR")}곳</span>} footer={<AskBar total={result.total ?? 0} enabled={Boolean(summary && summary.total > 0)} />}>
      {result.error ? (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          매물을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : result.rate_limited ? (
        <div role="alert" className="flex flex-col gap-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p>짧은 시간에 검색이 많아 잠시 멈췄습니다. 1시간 뒤에 다시 시도하거나 로그인해 주세요.</p>
          <Link href="/login" className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-white">
            로그인하기
          </Link>
        </div>
      ) : (
        <section aria-label="검색 결과" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-tile-blue text-accent" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 21V5h10v16 M14 9h6v12 M8 9h2 M8 13h2 M8 17h2 M17 13h.01 M17 17h.01 M3 21h18" />
                </svg>
              </span>
              <div className="min-w-0">
                <h3 className="text-lg font-medium">조건에 맞는 대구 공실</h3>
                <p className="truncate text-xs text-muted">
                  {headingLine || "조건을 정하면 더 좁혀 보여 드려요"}
                </p>
              </div>
            </div>
            {summary && <AiSummary text={summaryText(summary)} />}
          </div>
          {!result.has_scores && result.sort === "recommended" && (
            <p className="text-xs text-muted">점수가 준비되기 전까지 최근 확인순으로 보여 드립니다.</p>
          )}

          {result.items.length > 0 &&
            (pins === null ? (
              <p className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                지도를 불러오지 못했습니다. 아래 목록에서 매물을 볼 수 있어요.
              </p>
            ) : (
              <ListingMap pins={pins} missing={result.items.length - pins.length} />
            ))}

          {guest && (result.total ?? 0) > result.items.length && (
            <p className="-mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              나머지 매물은 로그인하면 지도에서 볼 수 있어요.
              <Link href="/login" className="underline">
                로그인하기
              </Link>
            </p>
          )}

          {summary && summary.total > 0 && <SummaryChips search={searchString} guest={guest} remaining={aiStatus.remaining} />}

          {result.items.length === 0 ? (
            <p className="rounded-lg bg-zinc-50 p-6 text-center text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              조건에 맞는 매물이 없습니다. 지역을 넓히거나 금액 조건을 조금 올려 보세요.
            </p>
          ) : (
            result.items.map((card, index) => (
              <div key={card.id} className="card-in" style={{ animationDelay: `${Math.min(index, 12) * 90 + 300}ms` }}>
                <ListingCardView
                  card={card}
                  showScore={!guest}
                  n={result.offset + index + 1}
                  myRating={myRatings.get(card.id) ?? null}
                  point={pointById.get(card.id) ?? null}
                />
              </div>
            ))
          )}

          {guest && (result.total ?? 0) > result.items.length && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
              <p className="font-medium">
                나머지 {((result.total ?? 0) - result.items.length).toLocaleString("ko-KR")}곳은 로그인하면 볼 수 있어요
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                로그인하면 정렬, 전체 지도, 담기, 비교, 점수 근거도 쓸 수 있습니다. 가입은 무료입니다.
              </p>
              <Link href="/login" className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                무료로 로그인하기
              </Link>
            </div>
          )}

          {!guest && (result.total ?? 0) > result.page_size && (
            <nav aria-label="쪽 이동" className="flex items-center justify-between text-sm">
              {result.offset > 0 ? (
                <Link href={pageLink(params, Math.max(result.offset - result.page_size, 0))} className="underline">
                  ← 이전
                </Link>
              ) : (
                <span />
              )}
              <span className="text-zinc-500">
                {result.offset + 1}–{Math.min(result.offset + result.page_size, result.total ?? 0)} /{" "}
                {(result.total ?? 0).toLocaleString("ko-KR")}
              </span>
              {result.offset + result.page_size < (result.total ?? 0) ? (
                <Link href={pageLink(params, result.offset + result.page_size)} className="underline">
                  다음 →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </section>
      )}
      <p className="mt-4 text-xs leading-relaxed text-faint">
        매물 정보는 네이버 부동산에 중개사가 올린 내용을 수집한 것으로, 실제와 다를 수 있습니다. 공실 여부와 조건은 계약 전에 원문과 현장에서 꼭 확인하세요.
      </p>
      </Panel>
      </Slot>
      <Slot side="right" label="스튜디오">
      <Panel title="스튜디오" label="담기·비교 스튜디오">
        <SavedStudio candidates={result.items.map((card) => ({ id: card.id, title: card.building_name || `${card.gu} ${card.dong}`, place: `${card.gu} ${card.dong}${card.floor ? ` ${card.floor}` : ""}`, rent: card.rent, fee: card.maintenance_fee }))} />
      </Panel>
      </Slot>
    </PanelLayout>
    </SavedProvider>
  );
}

export default function Home(props: PageProps<"/">) {
  return (
    <main data-fullscreen className="flex w-full flex-1 flex-col gap-3 px-4 py-3 lg:h-dvh lg:flex-none lg:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <SiteLogo />
        <div className="flex flex-wrap items-center gap-3">
          <ShareButton />
          <FontSizeControl />
          <Suspense fallback={null}>
            <UserStatus />
          </Suspense>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <Suspense fallback={<RecommendLoading />}>
          <SearchSection searchParams={props.searchParams} />
        </Suspense>
      </div>
      <GongsilChat />
    </main>
  );
}
