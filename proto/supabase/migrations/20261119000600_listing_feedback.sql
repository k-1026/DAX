-- 4단계 B: 평가·리뷰 표와 리뷰 개인정보 가리기
-- 근거: 앱 개발/04_회원_동의_권한_규칙.md 9절, 앱 개발/03_데이터_설계서.md listing_feedback
-- 되돌리기: supabase/rollback/20261119000600_listing_feedback_rollback.sql

-- 1. 개인정보 가리기 -------------------------------------------------------------
-- 순서가 중요하다: 주민등록번호 → 이메일 → 전화번호 → 카드·계좌번호 → 동·호수 → 이름
-- 원문은 돌려주지 않는다. 결과 글과 가린 개수만 돌려준다.
create function public.mask_personal_text(p_text text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  rules text[] := array[
    -- 주민등록번호·외국인등록번호 (생년월일 6자리 - 7자리)
    '(?<![0-9])[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])\s?-?\s?[1-8][0-9]{6}(?![0-9])', '(주민등록번호)',
    -- 이메일
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '(이메일)',
    -- 휴대폰·지역번호·인터넷 전화
    '(?<![0-9])(01[016789]|02|0[3-6][1-5]|070|050[0-9]?)[-. )]?[0-9]{3,4}[-. ]?[0-9]{4}(?![0-9])', '(전화번호)',
    -- 카드·계좌번호: 하이픈을 빼고 10자리 이상 이어진 숫자 (띄어 쓴 가격은 건드리지 않는다)
    '(?<![0-9])[0-9](-?[0-9]){9,18}(?![0-9])', '(카드·계좌번호)',
    -- 숫자 동+호수 (주거지일 가능성이 큼). 도로명·지번·층은 남긴다.
    '(?<![0-9])[0-9]{1,4}\s?동\s?[0-9]{1,5}\s?호(?!선)', '(동·호수)',
    -- 성+이름+호칭: 이름만 가리고 호칭은 남긴다
    '(?<![가-힣])(?!(이름|주인|우리|이번|정말|진짜|조금|동네|지금|이전|전임|담당|현재|공인|부동|모든|여러|어느|소개|건물|주변|근처|임대|매물|가게|상가|동성|전화|문의|친절|정직|성실|장사|임차|임장)[^가-힣]?)[김이박최정강조윤장임한오서신권황안송류유홍전고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경사부가복태목형피두감음빈동온호범좌갈][가-힣]{1,2}(?<![한는던의을를과와게에도])(?=\s?(실장|사장|대표|소장|부장|과장|팀장|이사|중개사|원장|선생))', '(이름)'
  ];
  result text := p_text;
  total integer := 0;
  i integer := 1;
begin
  if p_text is null then
    return jsonb_build_object('text', null, 'count', 0);
  end if;

  while i < array_length(rules, 1) loop
    total := total + regexp_count(result, rules[i]);
    result := regexp_replace(result, rules[i], rules[i + 1], 'g');
    i := i + 2;
  end loop;

  return jsonb_build_object('text', result, 'count', total);
end;
$$;

-- 2. 평가·리뷰 -----------------------------------------------------------------
create table public.listing_feedback (
  id                 uuid primary key default gen_random_uuid(),
  -- 탈퇴하면 회원 번호를 지우고 통계용으로만 남긴다.
  user_id            uuid default auth.uid() references public.profiles (id) on delete set null,
  listing_id         uuid not null references public.listings (id) on delete cascade,
  category_id        bigint references public.business_categories (id) on delete set null,
  scoring_version_id bigint references public.scoring_versions (id) on delete set null,
  sort_mode          text check (char_length(sort_mode) <= 40),
  rating             text not null check (rating in ('good', 'bad')),
  -- bad 사유: 임대료·조건, 공간 상태, 입지·상권, 입점 어려움, 정보 오류, 기타
  bad_reasons        text[] not null default '{}' check (
                       bad_reasons <@ array['rent_terms', 'space', 'location', 'entry', 'info_error', 'other']
                     ),
  review             text check (char_length(review) <= 600),
  masked_count       integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (rating = 'bad' or cardinality(bad_reasons) = 0)
);

-- 같은 회원은 매물·업종마다 평가 1개
create unique index listing_feedback_one_per_user
  on public.listing_feedback (user_id, listing_id, category_id) nulls not distinct
  where user_id is not null;

create index listing_feedback_listing_idx on public.listing_feedback (listing_id);

-- 저장할 때 리뷰 글의 개인정보를 가린다. 원문은 남지 않는다.
create function public.listing_feedback_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  masked jsonb;
begin
  if tg_op = 'INSERT' then
    new.scoring_version_id := (select id from public.scoring_versions where status = 'active' limit 1);
    new.created_at := now();
  end if;
  new.updated_at := now();

  if tg_op = 'UPDATE' and new.review is not distinct from old.review then
    new.masked_count := old.masked_count;
    return new;
  end if;

  new.review := nullif(btrim(new.review), '');
  if new.review is null then
    new.masked_count := 0;
    return new;
  end if;

  if char_length(new.review) > 500 then
    raise exception '리뷰는 500자까지 쓸 수 있습니다.' using errcode = '22001';
  end if;

  masked := public.mask_personal_text(new.review);
  new.review := masked ->> 'text';
  new.masked_count := (masked ->> 'count')::integer;
  return new;
end;
$$;

revoke all on function public.listing_feedback_prepare() from public, anon, authenticated;

create trigger listing_feedback_prepare
  before insert or update on public.listing_feedback
  for each row execute function public.listing_feedback_prepare();

-- 3. 권한 ---------------------------------------------------------------------
-- 회원 번호(user_id)는 누구에게도 보여 주지 않는다. 관리자도 가린 글·업종·사유만 본다.
alter table public.listing_feedback enable row level security;
revoke all on public.listing_feedback from anon, authenticated;

grant select (id, listing_id, category_id, scoring_version_id, sort_mode, rating, bad_reasons,
              review, masked_count, created_at, updated_at)
  on public.listing_feedback to authenticated;
grant insert (listing_id, category_id, sort_mode, rating, bad_reasons, review)
  on public.listing_feedback to authenticated;
grant update (sort_mode, rating, bad_reasons, review)
  on public.listing_feedback to authenticated;
grant delete on public.listing_feedback to authenticated;

create policy "본인 평가 조회"
  on public.listing_feedback for select to authenticated
  using (user_id = (select auth.uid()));

create policy "관리자 평가 조회"
  on public.listing_feedback for select to authenticated
  using ((select public.is_admin()));

create policy "본인 평가 작성"
  on public.listing_feedback for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "본인 평가 수정"
  on public.listing_feedback for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "본인 평가 삭제"
  on public.listing_feedback for delete to authenticated
  using (user_id = (select auth.uid()));

-- 가리기 함수는 서버만 직접 실행한다 (AI-1·AI-4 입력을 보낼 때 사용 예정).
revoke all on function public.mask_personal_text(text) from public, anon, authenticated;
grant execute on function public.mask_personal_text(text) to service_role;
