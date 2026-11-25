-- 6-E-3: 마이페이지 "내 평가" 목록 (본인 평가만, 최신순)
-- 되돌리기: supabase/rollback/20261123000600_my_feedback_rollback.sql
-- 삭제는 기존 규칙("본인 평가 삭제")으로 직접 한다. 이 함수는 매물 이름을 붙여 읽기만 한다.

create function public.my_feedback_list(p_limit integer default 5, p_offset integer default 0)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.listing_feedback f where f.user_id = auth.uid()),
    'items', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select f.id, f.listing_id, f.rating, f.bad_reasons, f.review, f.created_at,
               l.listing_data ->> 'gu' as gu,
               l.listing_data ->> 'dong' as dong,
               l.listing_data ->> 'floor' as floor
        from public.listing_feedback f
        join public.listings l on l.id = f.listing_id
        where f.user_id = auth.uid()
        order by f.created_at desc
        limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
      ) x
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.my_feedback_list(integer, integer) from public, anon, authenticated;
grant execute on function public.my_feedback_list(integer, integer) to authenticated;
