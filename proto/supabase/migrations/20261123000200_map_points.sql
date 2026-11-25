-- 6-C: 지도에 찍을 매물 좌표 (회원: 한 쪽 전체, 비로그인: 목록에 보인 3곳)
-- 근거: 앱 개발/대화로그.md 턴 139~147, 00_근거_기능_매핑.md U07
-- 되돌리기: supabase/rollback/20261123000200_map_points_rollback.sql

-- 검색 결과 한 쪽(최대 50곳)의 좌표만 돌려준다. 비로그인에게는 주지 않는다.
-- 좌표가 없는 매물은 빠진다(화면에서 "목록에서 볼 수 있어요" 안내).
create function public.listing_map_points(p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tier text := public.current_tier();
begin
  if tier = 'guest' or p_ids is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id,
             'lat', public.pipeline_num(l.listing_data ->> 'lat'),
             'lng', public.pipeline_num(l.listing_data ->> 'lng')))
    from public.listings l
    where l.id = any (p_ids[1:50])
      and l.status = 'active'
      and (tier in ('subscriber', 'admin') or l.public_at <= now())
      and public.pipeline_num(l.listing_data ->> 'lat') between 33 and 39
      and public.pipeline_num(l.listing_data ->> 'lng') between 124 and 132
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.listing_map_points(uuid[]) from public, anon, authenticated;
grant execute on function public.listing_map_points(uuid[]) to authenticated, service_role;

-- 비로그인: 목록에 보여 준 곳(guest.listing_limit, 3곳)까지만 좌표를 준다.
-- 비로그인은 직접 실행할 수 없고, 서버(서비스 키)가 검색 결과의 매물 id로만 대신 호출한다.
create function public.guest_map_points(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id,
           'lat', public.pipeline_num(l.listing_data ->> 'lat'),
           'lng', public.pipeline_num(l.listing_data ->> 'lng'))), '[]'::jsonb)
  from public.listings l
  where l.id = any (p_ids[1:public.pipeline_setting('guest.listing_limit')::integer])
    and l.status = 'active'
    and l.public_at <= now()
    and public.pipeline_num(l.listing_data ->> 'lat') between 33 and 39
    and public.pipeline_num(l.listing_data ->> 'lng') between 124 and 132;
$$;

revoke all on function public.guest_map_points(uuid[]) from public, anon, authenticated;
grant execute on function public.guest_map_points(uuid[]) to service_role;
