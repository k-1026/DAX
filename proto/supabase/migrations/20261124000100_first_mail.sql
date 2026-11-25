-- 7단계 첫 추천 메일(M01): 선호 조건을 저장하면 "첫 메일 대기" 표시 → 예약 실행이 1회만 발송
-- 근거: 00_근거_기능_매핑.md M01·M04, 04_회원_동의_권한_규칙.md 8절(광고성 메일 규칙), 대화로그 7단계 정리
-- 되돌리기: supabase/rollback/20261124000100_first_mail_rollback.sql
-- "상위 5곳"은 점수가 연결되기 전까지 최근 확인순이다(5단계에서 점수순으로 바꾼다).

alter table public.user_preferences add column first_mail_requested_at timestamptz;

-- 선호 조건 저장: 기존 동작에 "첫 메일 대기" 표시를 더한다(아직 첫 메일을 받지 않았고 조건이 있을 때만).
create or replace function public.set_my_preferences(p_filters jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean jsonb := '{}'::jsonb;
  key text;
  val numeric;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'login_required');
  end if;
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  foreach key in array array['gu', 'dong'] loop
    if jsonb_typeof(p_filters -> key) = 'array' then
      clean := clean || jsonb_build_object(key, coalesce((
        select jsonb_agg(v) from (
          select distinct t.v from jsonb_array_elements_text(p_filters -> key) as t(v)
          where char_length(t.v) between 1 and 20 limit 50) s(v)
      ), '[]'::jsonb));
    end if;
  end loop;

  foreach key in array array['rent_max', 'deposit_max', 'area_min', 'area_max'] loop
    if jsonb_typeof(p_filters -> key) = 'number' then
      val := (p_filters ->> key)::numeric;
      if val >= 0 and val < 1000000 then
        clean := clean || jsonb_build_object(key, val);
      end if;
    end if;
  end loop;

  -- 지역이 빈 목록이면 조건 없음으로 본다.
  if clean ? 'gu' and jsonb_array_length(clean -> 'gu') = 0 then clean := clean - 'gu'; end if;
  if clean ? 'dong' and jsonb_array_length(clean -> 'dong') = 0 then clean := clean - 'dong'; end if;

  insert into public.user_preferences (user_id, filters, updated_at, first_mail_requested_at)
  values (uid, clean, now(), case when clean <> '{}'::jsonb then now() end)
  on conflict (user_id) do update
    set filters = excluded.filters,
        updated_at = now(),
        first_mail_requested_at = case
          when public.user_preferences.first_mail_sent_at is null and excluded.filters <> '{}'::jsonb
            then coalesce(public.user_preferences.first_mail_requested_at, now())
          else public.user_preferences.first_mail_requested_at
        end;

  return jsonb_build_object('ok', true, 'filters', clean);
end;
$$;

revoke all on function public.set_my_preferences(jsonb) from public, anon, authenticated;
grant execute on function public.set_my_preferences(jsonb) to authenticated;

-- 첫 추천 메일을 받을 회원과 추천 상위 5곳 (예약 실행용, 서버만 호출)
create function public.mail_first_collect()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recipients as (
    select p.id as user_id, p.contact_email as to_address, pref.filters
    from public.profiles p
    join public.user_preferences pref on pref.user_id = p.id
    where p.deleted_at is null
      and p.contact_email is not null
      and pref.first_mail_requested_at is not null
      and pref.first_mail_sent_at is null
      and pref.filters <> '{}'::jsonb
      and exists (
        select 1 from public.user_consents c
        where c.user_id = p.id and c.consent_type = 'email' and c.withdrawn_at is null
      )
    order by pref.first_mail_requested_at
    limit 50
  ), built as (
    select r.*,
      (select count(*)::integer from public.listings l
        where l.status = 'active' and l.public_at <= now()
          and public.mail_listing_matches(r.filters, l.listing_data)) as total,
      (select coalesce(jsonb_agg(picked.card), '[]'::jsonb) from (
        select jsonb_build_object('listing_id', l.id, 'data', l.listing_data) as card
        from public.listings l
        where l.status = 'active' and l.public_at <= now()
          and public.mail_listing_matches(r.filters, l.listing_data)
        order by l.listing_data ->> 'confirmed_at' desc nulls last, l.last_checked_at desc, l.id
        limit 5
      ) picked) as items
    from recipients r
  )
  -- 맞는 매물이 0곳이면 보내지 않고 대기한다(나중에 맞는 매물이 생기면 그때 보낸다).
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', b.user_id, 'to', b.to_address, 'filters', b.filters, 'total', b.total, 'items', b.items
  )), '[]'::jsonb)
  from built b where b.total > 0;
$$;

-- 첫 메일 보낼 자격을 한 번만 가져간다(동시에 불러도 한 번만 true).
create function public.mail_first_claim(p_user uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.user_preferences
    set first_mail_sent_at = now()
    where user_id = p_user and first_mail_sent_at is null and first_mail_requested_at is not null
    returning 1
  )
  select exists (select 1 from claimed);
$$;

-- 마이페이지 "메일 미리보기": 내 선호 조건으로 첫 추천 메일에 들어갈 매물 상위 5곳 (보내지 않는다)
create function public.my_first_mail_preview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'filters', coalesce(pref.filters, '{}'::jsonb),
    'sent_at', pref.first_mail_sent_at,
    'total', (select count(*)::integer from public.listings l
              where pref.filters <> '{}'::jsonb and l.status = 'active' and l.public_at <= now()
                and public.mail_listing_matches(pref.filters, l.listing_data)),
    'items', (select coalesce(jsonb_agg(picked.card), '[]'::jsonb) from (
               select jsonb_build_object('listing_id', l.id, 'data', l.listing_data) as card
               from public.listings l
               where pref.filters <> '{}'::jsonb and l.status = 'active' and l.public_at <= now()
                 and public.mail_listing_matches(pref.filters, l.listing_data)
               order by l.listing_data ->> 'confirmed_at' desc nulls last, l.last_checked_at desc, l.id
               limit 5) picked)
  )
  from (select 1) x
  left join public.user_preferences pref on pref.user_id = auth.uid();
$$;

revoke all on function public.mail_first_collect() from public, anon, authenticated;
revoke all on function public.mail_first_claim(uuid) from public, anon, authenticated;
revoke all on function public.my_first_mail_preview() from public, anon, authenticated;
grant execute on function public.mail_first_collect() to service_role;
grant execute on function public.mail_first_claim(uuid) to service_role;
grant execute on function public.my_first_mail_preview() to authenticated;
