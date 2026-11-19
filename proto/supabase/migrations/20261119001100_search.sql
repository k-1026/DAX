-- 6-A: 매물 검색 (등급별 범위, 비로그인 상위 3개, 비로그인 조회 제한, 상태 표시)
-- 근거: 앱 개발/00_근거_기능_매핑.md U01·U02·U05·U06, 03_데이터_설계서.md 4절
-- 되돌리기: supabase/rollback/20261119001100_search_rollback.sql
--
-- 화면은 매물 표를 직접 읽지 못한다. 이 함수만 쓴다.
-- 로그인 회원은 본인 로그인으로, 비로그인은 서버(서비스 키)가 대신 호출한다.
-- 서비스 키로 호출하면 auth.uid()가 없으므로 비로그인 범위가 적용된다.

-- 1. 기준값 -------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('guest.search_hourly_limit', '30', '비로그인 검색 횟수 (IP당 1시간)'),
  ('search.page_size',          '20', '로그인 회원 한 번에 보여 주는 매물 수'),
  ('search.badge_days',         '7',  '신규·가격 변경 표시 기간 (일)');

-- 2. 비로그인 조회 기록 (IP는 서버에서 해시로 바꿔 저장한다) ---------------------------
create table public.guest_search_hits (
  id      bigint generated always as identity primary key,
  ip_hash text not null check (char_length(ip_hash) between 16 and 128),
  hit_at  timestamptz not null default now()
);

create index guest_search_hits_ip_idx on public.guest_search_hits (ip_hash, hit_at);

alter table public.guest_search_hits enable row level security;
revoke all on public.guest_search_hits from anon, authenticated;

-- 3. 지역 목록 (필터용 구·동) ---------------------------------------------------
create function public.search_areas()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(gu, dongs order by gu), '{}'::jsonb)
  from (
    select listing_data ->> 'gu' as gu,
           jsonb_agg(distinct listing_data ->> 'dong') as dongs
    from public.listings
    where status = 'active' and listing_data ->> 'gu' is not null
    group by 1
  ) areas;
$$;

-- 4. 검색 ---------------------------------------------------------------------
-- p_filters: category_id(업종), gu[], dong[], rent_max(월세+관리비, 만원), deposit_max(만원), area_min, area_max(㎡)
-- 추천순은 선택한 업종의 사용 중인 점수 버전 점수로 정렬한다. 점수가 없으면 최근 확인순.
-- p_sort: recommended | rent | deposit | area | recent
create function public.search_listings(
  p_filters jsonb default '{}',
  p_sort text default 'recommended',
  p_offset integer default 0,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  tier text := public.current_tier();
  is_guest boolean := tier = 'guest';
  page_size integer;
  hourly_limit integer := public.pipeline_setting('guest.search_hourly_limit')::integer;
  badge_days integer := public.pipeline_setting('search.badge_days')::integer;
  active_version bigint := (select id from public.scoring_versions where status = 'active' limit 1);
  category bigint := public.pipeline_num(p_filters ->> 'category_id')::bigint;
  sort_key text := coalesce(nullif(p_sort, ''), 'recommended');
  -- 목록이 아닌 값은 조건 없음으로 본다.
  gus text[] := case when jsonb_typeof(p_filters -> 'gu') = 'array'
                     then array(select jsonb_array_elements_text(p_filters -> 'gu')) else '{}' end;
  dongs text[] := case when jsonb_typeof(p_filters -> 'dong') = 'array'
                       then array(select jsonb_array_elements_text(p_filters -> 'dong')) else '{}' end;
  rent_max numeric := public.pipeline_num(p_filters ->> 'rent_max');
  deposit_max numeric := public.pipeline_num(p_filters ->> 'deposit_max');
  area_min numeric := public.pipeline_num(p_filters ->> 'area_min');
  area_max numeric := public.pipeline_num(p_filters ->> 'area_max');
  start_at integer := greatest(coalesce(p_offset, 0), 0);
  total integer;
  items jsonb;
begin
  if sort_key not in ('recommended', 'rent', 'deposit', 'area', 'recent') then
    sort_key := 'recommended';
  end if;

  if is_guest then
    -- 비로그인: 정렬·다음 쪽 없이 추천순 상위 몇 개만. IP당 조회 횟수를 제한한다.
    page_size := public.pipeline_setting('guest.listing_limit')::integer;
    sort_key := 'recommended';
    start_at := 0;

    if p_ip_hash is null or char_length(p_ip_hash) < 16 then
      return jsonb_build_object('tier', tier, 'error', 'ip_required');
    end if;

    delete from public.guest_search_hits where hit_at < now() - interval '1 day';
    if (select count(*) from public.guest_search_hits
        where ip_hash = p_ip_hash and hit_at > now() - interval '1 hour') >= hourly_limit then
      return jsonb_build_object('tier', tier, 'rate_limited', true, 'items', '[]'::jsonb, 'total', null);
    end if;
    insert into public.guest_search_hits (ip_hash) values (p_ip_hash);
  else
    page_size := public.pipeline_setting('search.page_size')::integer;
  end if;

  with matches as (
    select l.id as listing_id, l.listing_data as data, l.first_seen_at, l.last_checked_at, l.source,
           (select s.total_score from public.listing_scores s
            where s.listing_id = l.id and s.category_id = category and s.version_id = active_version) as score
    from public.listings l
    where l.status = 'active'
      -- 24시간 선공개: 구독 회원·관리자만 공개 시각 전 매물을 본다.
      and (tier in ('subscriber', 'admin') or l.public_at <= now())
      and (cardinality(gus) = 0 or l.listing_data ->> 'gu' = any (gus))
      and (cardinality(dongs) = 0 or l.listing_data ->> 'dong' = any (dongs))
      and (rent_max is null or coalesce(public.pipeline_num(l.listing_data ->> 'rent'), 0)
                               + coalesce(public.pipeline_num(l.listing_data ->> 'maintenance_fee'), 0) <= rent_max)
      and (deposit_max is null or public.pipeline_num(l.listing_data ->> 'deposit') <= deposit_max)
      and (area_min is null or public.pipeline_num(l.listing_data ->> 'area_m2') >= area_min)
      and (area_max is null or public.pipeline_num(l.listing_data ->> 'area_m2') <= area_max)
  ), ranked as (
    select count(*) over () as match_count,
           row_number() over (
             order by
               case when sort_key = 'recommended' then m.score end desc nulls last,
               case when sort_key = 'rent' then public.pipeline_num(m.data ->> 'rent') end asc nulls last,
               case when sort_key = 'deposit' then public.pipeline_num(m.data ->> 'deposit') end asc nulls last,
               case when sort_key = 'area' then public.pipeline_num(m.data ->> 'area_m2') end desc nulls last,
               -- 점수가 없거나 같으면 최근 확인순
               m.data ->> 'confirmed_at' desc nulls last,
               m.last_checked_at desc,
               m.listing_id
           ) as position,
           m.*
    from matches m
  )
  select coalesce(max(r.match_count), 0),
         coalesce(jsonb_agg(jsonb_build_object(
             'id', r.listing_id,
             'gu', r.data ->> 'gu', 'dong', r.data ->> 'dong',
             'floor', r.data ->> 'floor', 'total_floors', r.data ->> 'total_floors',
             'area_m2', public.pipeline_num(r.data ->> 'area_m2'),
             'deposit', public.pipeline_num(r.data ->> 'deposit'),
             'rent', public.pipeline_num(r.data ->> 'rent'),
             'maintenance_fee', public.pipeline_num(r.data ->> 'maintenance_fee'),
             'property_type', r.data ->> 'property_type', 'subtype', r.data ->> 'subtype',
             'building_name', r.data ->> 'building_name',
             'current_use', r.data ->> 'current_use', 'recommended_use', r.data ->> 'recommended_use',
             'confirmed_at', r.data ->> 'confirmed_at',
             'checked_at', r.last_checked_at,
             'source', r.source,
             'score', r.score,
             'is_new', r.first_seen_at > now() - make_interval(days => badge_days),
             'price_changed', exists (
               select 1 from public.listing_versions v
               where v.listing_id = r.listing_id and v.change_type = 'changed'
                 and v.created_at > now() - make_interval(days => badge_days)
                 and v.changed_fields ?| array['rent', 'deposit', 'maintenance_fee']
             ),
             'needs_check', exists (
               select 1 from public.listing_flags f where f.listing_id = r.listing_id and f.cleared_at is null
             )
           ) order by r.position) filter (where r.position > start_at and r.position <= start_at + page_size),
           '[]'::jsonb)
  into total, items
  from ranked r;

  return jsonb_build_object(
    'tier', tier,
    'total', total,
    'offset', start_at,
    'page_size', page_size,
    'sort', sort_key,
    'has_scores', active_version is not null and category is not null,
    'items', items,
    'rate_limited', false
  );
end;
$$;

-- 5. 실행 권한 ------------------------------------------------------------------
-- 비로그인(anon)은 직접 실행할 수 없다. 서버가 IP 제한을 걸어 대신 실행한다.
revoke all on function public.search_areas() from public, anon, authenticated;
revoke all on function public.search_listings(jsonb, text, integer, text) from public, anon, authenticated;
grant execute on function public.search_areas() to authenticated, service_role;
grant execute on function public.search_listings(jsonb, text, integer, text) to authenticated, service_role;
