-- 담은 매물 메모 (구독 회원 혜택, 2026-11-26 결정). saved_listings.memo 칸은 이미 있다.
-- saved_state가 memo를 함께 돌려주고, saved_memo_set으로 구독·관리자만 쓴다. 구독이 끝나도 쓴 메모는 읽을 수 있다.
-- 되돌리기: supabase/rollback/20261126000200_saved_memo_rollback.sql

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
             jsonb_build_object('list_id',s.list_id,'saved_at',s.saved_at,'memo',s.memo) order by s.saved_at desc,s.listing_id),'[]'::jsonb)
             from public.saved_listings s join public.saved_lists l on l.id=s.list_id where l.user_id=viewer),
    'total',(select count(distinct s.listing_id) from public.saved_listings s
             join public.saved_lists l on l.id=s.list_id where l.user_id=viewer)
  );
end;
$$;

create function public.saved_memo_set(p_list uuid, p_listing uuid, p_memo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := (select auth.uid());
  memo_text text := nullif(btrim(coalesce(p_memo,'')),'');
begin
  if viewer is null then return jsonb_build_object('ok',false,'error','login_required'); end if;
  if public.current_tier() not in ('subscriber','admin') then
    return jsonb_build_object('ok',false,'error','subscriber_only');
  end if;
  if char_length(coalesce(memo_text,'')) > 300 then return jsonb_build_object('ok',false,'error','memo_length'); end if;
  update public.saved_listings s set memo = memo_text
   where s.list_id = p_list and s.listing_id = p_listing
     and exists(select 1 from public.saved_lists l where l.id = s.list_id and l.user_id = viewer);
  if not found then return jsonb_build_object('ok',false,'error','memo_not_saved'); end if;
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.saved_memo_set(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.saved_memo_set(uuid,uuid,text) to authenticated;
