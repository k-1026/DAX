// 첫 화면 = 매물 검색 (6-A: U01 필터, U02 목록·정렬, U05 상태 표시, U06 로그인 벽, U23 글자 크기)
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FontSizeControl } from "@/app/_components/font-size-control";
import { ListingCardView } from "@/app/_components/listing-card";
import {
  getAreas,
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
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        로그인 / 회원가입
      </Link>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
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
      <span>{name} 님</span>
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

function NumberField({ name, label, value, unit }: { name: string; label: string; value?: number; unit: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input type="number" name={name} min={0} inputMode="numeric" defaultValue={value} className={inputClass} />
        <span className="shrink-0 text-zinc-500">{unit}</span>
      </span>
    </label>
  );
}

function SearchForm({
  areas,
  filters,
  sort,
  canSort,
}: {
  areas: Record<string, string[]>;
  filters: SearchFilters;
  sort: SortKey;
  canSort: boolean;
}) {
  const active =
    (filters.gu.length > 0 ? 1 : 0) +
    (filters.dong.length > 0 ? 1 : 0) +
    [filters.rent_max, filters.deposit_max, filters.area_min, filters.area_max].filter((v) => v !== undefined).length;
  // 처음 방문하면 조건을 펼쳐 보여 주고, 검색한 뒤에는 결과가 바로 보이게 접는다.
  const open = active === 0 && sort === "recommended";
  return (
    <details open={open} className="group rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium">
        <span>
          검색 조건{active > 0 && <span className="ml-1 text-blue-700 dark:text-blue-300">({active}개 적용)</span>}
        </span>
        <span className="text-zinc-500 group-open:hidden">펼치기</span>
        <span className="hidden text-zinc-500 group-open:inline">접기</span>
      </summary>
    <form action="/" method="get" className="flex flex-col gap-4 border-t border-zinc-200 p-4 dark:border-zinc-800">
      <label className="flex flex-col gap-1 text-sm">
        <span>업종</span>
        <select disabled className={`${inputClass} text-zinc-500`}>
          <option>업종 선택은 준비 중입니다</option>
        </select>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm">지역 (여러 곳 선택 가능)</legend>
        <div className="flex flex-wrap gap-2">
          {Object.keys(areas).map((gu) => (
            <label key={gu} className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
              <input type="checkbox" name="gu" value={gu} defaultChecked={filters.gu.includes(gu)} />
              {gu}
            </label>
          ))}
        </div>
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
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <NumberField name="rent_max" label="월 임대료 상한" value={filters.rent_max} unit="만원" />
        <NumberField name="deposit_max" label="보증금 상한" value={filters.deposit_max} unit="만원" />
        <NumberField name="area_min" label="전용면적 최소" value={filters.area_min} unit="㎡" />
        <NumberField name="area_max" label="전용면적 최대" value={filters.area_max} unit="㎡" />
      </div>
      <p className="-mt-2 text-xs text-zinc-500">
        월 임대료 = 월세 + 관리비. 관리비가 적혀 있지 않은 매물은 관리비를 0으로 계산합니다.
      </p>

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

      <div className="flex gap-2">
        <button type="submit" className="flex-1 rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          검색
        </button>
        <Link href="/" className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm dark:border-zinc-700">
          초기화
        </Link>
      </div>
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

async function SearchSection({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  // 검색 결과는 요청할 때마다 만든다(로그인 확인에 현재 시각을 쓰기 때문).
  await connection();
  const params = await searchParams;
  const { filters, sort, offset } = parseSearchParams(params);
  const [result, areas] = await Promise.all([searchListings(filters, sort, offset), getAreas()]);
  const guest = result.tier === "guest";

  return (
    <div className="flex flex-col gap-5">
      <SearchForm areas={areas} filters={filters} sort={result.sort ?? sort} canSort={!guest} />

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
        <section aria-label="검색 결과" className="flex flex-col gap-3">
          <p className="text-sm">
            조건에 맞는 매물 <b>{(result.total ?? 0).toLocaleString("ko-KR")}곳</b>
            {!result.has_scores && result.sort === "recommended" && (
              <span className="text-zinc-500"> · 점수가 준비되기 전까지 최근 확인순으로 보여 드립니다</span>
            )}
          </p>

          {result.items.length === 0 ? (
            <p className="rounded-lg bg-zinc-50 p-6 text-center text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              조건에 맞는 매물이 없습니다. 지역을 넓히거나 금액 조건을 조금 올려 보세요.
            </p>
          ) : (
            result.items.map((card) => <ListingCardView key={card.id} card={card} showScore={!guest} />)
          )}

          {guest && (result.total ?? 0) > result.items.length && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
              <p className="font-semibold">
                나머지 {((result.total ?? 0) - result.items.length).toLocaleString("ko-KR")}곳은 로그인하면 볼 수 있어요
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                로그인하면 정렬, 지도, 담기, 비교, 점수 근거도 쓸 수 있습니다. 가입은 무료입니다.
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
    </div>
  );
}

export default function Home(props: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">대구 공실 매칭</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">업종에 맞는 대구 상가 공실 찾기</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FontSizeControl />
          <Suspense fallback={null}>
            <UserStatus />
          </Suspense>
        </div>
      </header>

      <Suspense fallback={<p className="text-sm text-zinc-500">매물을 불러오는 중…</p>}>
        <SearchSection searchParams={props.searchParams} />
      </Suspense>

      <p className="text-xs leading-relaxed text-zinc-500">
        매물 정보는 네이버 부동산에 중개사가 올린 내용을 수집한 것으로, 실제와 다를 수 있습니다. 공실 여부와 조건은
        계약 전에 원문과 현장에서 꼭 확인하세요.
      </p>
    </main>
  );
}
