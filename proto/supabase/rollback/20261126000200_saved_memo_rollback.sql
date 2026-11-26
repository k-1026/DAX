-- 20261126000200_saved_memo 되돌리기: 메모 함수 삭제, saved_state를 memo 없는 원래 모양으로. 메모 글 자체는 지우지 않는다.
drop function if exists public.saved_memo_set(uuid,uuid,text);

create or replace function public.saved_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer uuid := (select auth.uid());
  access jsonb := public.my_access();
begin
  if viewer is null or not exists(select 1 from public.profiles where id=viewer and deleted_at is null) then
    return jsonb_build_object('ok',false,'error','login_required');
  end if;
  return jsonb_build_object(
    'ok',true,'tier',access->'tier','saved_limit',access->'saved_limit','compare_limit',access->'compare_limit',
    'lists',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by created_at,id),'[]'::jsonb)
             from public.saved_lists where user_id=viewer),
    'items',(select coalesce(jsonb_agg(public.saved_item(s.listing_id) ||
             jsonb_build_object('list_id',s.list_id,'saved_at',s.saved_at) order by s.saved_at desc,s.listing_id),'[]'::jsonb)
             from public.saved_listings s join public.saved_lists l on l.id=s.list_id where l.user_id=viewer),
    'total',(select count(distinct s.listing_id) from public.saved_listings s
             join public.saved_lists l on l.id=s.list_id where l.user_id=viewer)
  );
end;
$$;
