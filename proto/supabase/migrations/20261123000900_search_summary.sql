-- 추천 패널 위쪽 "분석 요약": 조건에 맞는 전체 매물의 집계 (읽기 전용)
-- 근거: 대화로그 턴 178 이후 "AI 분석 요약·질문 칩", 10_발표데모_분석.md
-- 되돌리기: supabase/rollback/20261123000900_search_summary_rollback.sql
-- 조건을 거는 방식은 search_listings와 같다. 비로그인에게는 개별 매물 정보(가장 싼 곳 등)를 주지 않고 숫자만 준다.
-- 비로그인은 서버(서비스 키)가 대신 부른다.

create or replace function public.search_summary(p_filters jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tier text := public.current_tier();
  is_guest boolean := tier = 'guest';
  badge_days integer := public.pipeline_setting('search.badge_days')::integer;
  gus text[] := case when jsonb_typeof(p_filters -> 'gu') = 'array'
                     then array(select jsonb_array_elements_text(p_filters -> 'gu')) else '{}' end;
  dongs text[] := case when jsonb_typeof(p_filters -> 'dong') = 'array'
                       then array(select jsonb_array_elements_text(p_filters -> 'dong')) else '{}' end;
  floors text[] := case when jsonb_typeof(p_filters -> 'floors') = 'array'
                        then array(select jsonb_array_elements_text(p_filters -> 'floors')) else '{}' end;
  rent_max numeric := public.pipeline_num(p_filters ->> 'rent_max');
  deposit_max numeric := public.pipeline_num(p_filters ->> 'deposit_max');
  area_min numeric := public.pipeline_num(p_filters ->> 'area_min');
  area_max numeric := public.pipeline_num(p_filters ->> 'area_max');
  result jsonb;
begin
  with m as (
    select l.id, l.first_seen_at,
           l.listing_data ->> 'gu' as gu, l.listing_data ->> 'dong' as dong, l.listing_data ->> 'floor' as floor,
           public.pipeline_num(l.listing_data ->> 'rent') as rent,
           coalesce(public.pipeline_num(l.listing_data ->> 'rent'), 0)
             + coalesce(public.pipeline_num(l.listing_data ->> 'maintenance_fee'), 0) as monthly,
           public.pipeline_num(l.listing_data ->> 'deposit') as deposit,
           public.pipeline_num(l.listing_data ->> 'area_m2') as area
    from public.listings l
    where l.status = 'active'
      and (tier in ('subscriber', 'admin') or l.public_at <= now())
      and (cardinality(gus) = 0 or l.listing_data ->> 'gu' = any (gus))
      and (cardinality(dongs) = 0 or l.listing_data ->> 'dong' = any (dongs))
      and (rent_max is null or coalesce(public.pipeline_num(l.listing_data ->> 'rent'), 0)
                               + coalesce(public.pipeline_num(l.listing_data ->> 'maintenance_fee'), 0) <= rent_max)
      and (deposit_max is null or public.pipeline_num(l.listing_data ->> 'deposit') <= deposit_max)
      and (area_min is null or public.pipeline_num(l.listing_data ->> 'area_m2') >= area_min)
      and (area_max is null or public.pipeline_num(l.listing_data ->> 'area_m2') <= area_max)
      and (cardinality(floors) = 0
           or ('ground1' = any (floors) and l.listing_data ->> 'floor' = '1층')
           or ('upper' = any (floors) and l.listing_data ->> 'floor' ~ '^[0-9]+층$'
               and substring(l.listing_data ->> 'floor' from '^[0-9]+')::integer >= 2)
           or ('basement' = any (floors) and l.listing_data ->> 'floor' like '지하%'))
  ), fresh as (
    select * from m where first_seen_at > now() - make_interval(days => badge_days)
  )
  select jsonb_build_object(
    'total', (select count(*) from m),
    'by_gu', coalesce((select jsonb_agg(jsonb_build_object('name', g.gu, 'count', g.n))
                       from (select gu, count(*) n from m where gu is not null group by gu order by n desc, gu limit 3) g), '[]'::jsonb),
    'by_dong', coalesce((select jsonb_agg(jsonb_build_object('name', d.gu || ' ' || d.dong, 'count', d.n))
                         from (select gu, dong, count(*) n from m where dong is not null group by gu, dong order by n desc, gu, dong limit 3) d), '[]'::jsonb),
    'monthly_p25', (select percentile_cont(0.25) within group (order by monthly) from m),
    'monthly_median', (select percentile_cont(0.5) within group (order by monthly) from m),
    'monthly_p75', (select percentile_cont(0.75) within group (order by monthly) from m),
    'new_count', (select count(*) from fresh),
    -- 개별 매물은 로그인 회원에게만 알려 준다(비로그인은 null).
    'cheapest', case when is_guest then null else
      (select to_jsonb(c) from (select id, gu, dong, floor, rent, monthly, deposit, area from m where rent is not null order by monthly asc, id limit 1) c) end,
    'widest', case when is_guest then null else
      (select to_jsonb(w) from (select id, gu, dong, floor, rent, monthly, deposit, area from m where area is not null order by area desc, id limit 1) w) end,
    'newest', case when is_guest then null else
      (select to_jsonb(n) from (select id, gu, dong, floor, rent, monthly, deposit, area from fresh order by first_seen_at desc, id limit 1) n) end
  ) into result;

  return result;
end;
$$;

revoke all on function public.search_summary(jsonb) from public, anon, authenticated;
grant execute on function public.search_summary(jsonb) to authenticated, service_role;
