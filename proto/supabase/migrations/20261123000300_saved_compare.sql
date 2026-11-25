-- 6-D: 계정별 담기·목록·비교. 모든 쓰기는 본인 인증과 한도를 검사하는 RPC만 허용한다.
-- 기존 saved_lists / saved_listings와 my_access()를 사용한다.
-- 되돌리기: supabase/rollback/20261123000300_saved_compare_rollback.sql

-- 내부 표시 함수. 선공개 권한이 사라지면 매물 내용은 반환하지 않는다.
create function public.saved_item(p_listing uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when l.public_at > now() and public.current_tier() not in ('subscriber','admin')
      then jsonb_build_object('listing_id',l.id,'available',false)
    else jsonb_build_object(
      'listing_id',l.id,'available',true,'status',l.status,'source',l.source,
      'checked_at',l.last_checked_at,
      'data',jsonb_build_object(
        'gu',l.listing_data->>'gu','dong',l.listing_data->>'dong',
        'building_name',l.listing_data->>'building_name',
        'address',coalesce(nullif(l.listing_data->>'address',''),nullif(l.listing_data->>'road_address','')),
        'floor',l.listing_data->>'floor','area_m2',public.pipeline_num(l.listing_data->>'area_m2'),
        'deposit',public.pipeline_num(l.listing_data->>'deposit'),
        'rent',public.pipeline_num(l.listing_data->>'rent'),
        'maintenance_fee',public.pipeline_num(l.listing_data->>'maintenance_fee'),
        'confirmed_at',l.listing_data->>'confirmed_at'
      ),
      'needs_check',exists(select 1 from public.listing_flags f where f.listing_id=l.id and f.cleared_at is null)
    ) end
  from public.listings l where l.id=p_listing;
$$;
revoke all on function public.saved_item(uuid) from public, anon, authenticated;

create function public.saved_state()
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

create function public.saved_list_create(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := (select auth.uid());
  tier text := public.current_tier();
  new_id uuid;
begin
  if viewer is null then return jsonb_build_object('ok',false,'error','login_required'); end if;
  -- 같은 회원 행을 잠가 여러 창에서 동시에 저장해도 한도를 넘지 않게 한다.
  perform 1 from public.profiles where id=viewer and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'error','login_required'); end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 50 then
    return jsonb_build_object('ok',false,'error','name');
  end if;
  if tier='member' and exists(select 1 from public.saved_lists where user_id=viewer) then
    return jsonb_build_object('ok',false,'error','list_limit');
  end if;
  insert into public.saved_lists(user_id,name) values(viewer,btrim(p_name)) returning id into new_id;
  return jsonb_build_object('ok',true,'id',new_id);
end;
$$;

create function public.saved_set(p_listing uuid,p_saved boolean,p_list uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := (select auth.uid());
  access jsonb := public.my_access();
  target uuid := p_list;
  cap integer := (access->>'saved_limit')::integer;
  already_saved boolean;
begin
  if viewer is null then return jsonb_build_object('ok',false,'error','login_required'); end if;
  perform 1 from public.profiles where id=viewer and deleted_at is null for update;
  if not found then return jsonb_build_object('ok',false,'error','login_required'); end if;
  if p_saved is null then return jsonb_build_object('ok',false,'error','invalid'); end if;
  if target is not null and not exists(select 1 from public.saved_lists where id=target and user_id=viewer) then
    return jsonb_build_object('ok',false,'error','not_found');
  end if;
  if target is null then
    select id into target from public.saved_lists where user_id=viewer order by created_at,id limit 1;
  end if;

  -- 해제는 게시 종료·구독 만료·한도 초과 상태에서도 가능하다.
  if not p_saved then
    delete from public.saved_listings where list_id=target and listing_id=p_listing;
    return jsonb_build_object('ok',true);
  end if;
  if not exists(select 1 from public.listings where id=p_listing and status='active'
       and (public_at<=now() or access->>'tier' in ('subscriber','admin'))) then
    return jsonb_build_object('ok',false,'error','not_available');
  end if;
  if exists(select 1 from public.saved_listings where list_id=target and listing_id=p_listing) then
    return jsonb_build_object('ok',true);
  end if;
  -- 구독 만료 후 남은 두 번째 목록에는 추가 저장하지 않는다(해제는 가능).
  if access->>'tier'='member' and target is distinct from
       (select id from public.saved_lists where user_id=viewer order by created_at,id limit 1) then
    return jsonb_build_object('ok',false,'error','list_limit');
  end if;
  select exists(select 1 from public.saved_listings s join public.saved_lists l on l.id=s.list_id
     where l.user_id=viewer and s.listing_id=p_listing) into already_saved;
  if not already_saved and cap is not null and
     (select count(distinct s.listing_id) from public.saved_listings s join public.saved_lists l on l.id=s.list_id
       where l.user_id=viewer)>=cap then
    return jsonb_build_object('ok',false,'error','saved_limit');
  end if;
  if target is null then
    insert into public.saved_lists(user_id) values(viewer) returning id into target;
  end if;
  insert into public.saved_listings(list_id,listing_id) values(target,p_listing) on conflict do nothing;
  return jsonb_build_object('ok',true,'list_id',target);
end;
$$;

create function public.saved_compare(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer uuid := (select auth.uid());
  access jsonb := public.my_access();
  ids uuid[] := array(select distinct x from unnest(p_ids) x where x is not null);
  cap integer := (access->>'compare_limit')::integer;
begin
  if viewer is null or not exists(select 1 from public.profiles where id=viewer and deleted_at is null) then
    return jsonb_build_object('ok',false,'error','login_required');
  end if;
  if cardinality(ids)<2 then return jsonb_build_object('ok',false,'error','choose_two'); end if;
  if cap is null or cardinality(ids)>cap then return jsonb_build_object('ok',false,'error','compare_limit'); end if;
  if exists(select 1 from unnest(ids) as selected(listing_id) where not exists(
    select 1 from public.saved_listings s join public.saved_lists l on l.id=s.list_id
      where s.listing_id=selected.listing_id and l.user_id=viewer)) then
    return jsonb_build_object('ok',false,'error','not_saved');
  end if;
  if exists(select 1 from public.listings where id=any(ids) and public_at>now()
      and access->>'tier' not in ('subscriber','admin')) then
    return jsonb_build_object('ok',false,'error','not_available');
  end if;
  return jsonb_build_object('ok',true,'items',
    (select jsonb_agg(public.saved_item(id) order by n) from unnest(p_ids) with ordinality as selected(id,n)
       where n=array_position(p_ids,id)));
end;
$$;

revoke all on function public.saved_state() from public,anon,authenticated;
revoke all on function public.saved_list_create(text) from public,anon,authenticated;
revoke all on function public.saved_set(uuid,boolean,uuid) from public,anon,authenticated;
revoke all on function public.saved_compare(uuid[]) from public,anon,authenticated;
grant execute on function public.saved_state() to authenticated;
grant execute on function public.saved_list_create(text) to authenticated;
grant execute on function public.saved_set(uuid,boolean,uuid) to authenticated;
grant execute on function public.saved_compare(uuid[]) to authenticated;
