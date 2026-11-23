-- 6-B: 매물 상세, 싫어요 이유 1개, 문제 신고(비로그인 포함)
-- 근거: 앱 개발/대화로그.md 턴 128~134, 00_근거_기능_매핑.md U03·U04·U12·U13·U14, 01 문서 A-2-6
-- 되돌리기: supabase/rollback/20261123000100_listing_detail_rollback.sql

-- 1. 기준값 -------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('guest.report_daily_limit', '3',  '비로그인 문제 신고 횟수 (IP당 하루)'),
  ('listing.stale_days',       '30', '중개사 확인 후 이 일수가 지나면 "오래된 정보" 표시');

-- 2. 싫어요 이유는 1개만 (다른 이유는 리뷰 글로 받는다) -----------------------------
alter table public.listing_feedback
  add constraint listing_feedback_one_reason check (cardinality(bad_reasons) <= 1);

-- 3. 매물 상세 ------------------------------------------------------------------
-- 회원은 본인 로그인으로, 비로그인은 서버(서비스 키)가 확인 표시를 검사한 뒤 대신 호출한다.
-- 비로그인에게는 원문 링크를 주지 않는다.
create function public.listing_detail(p_listing uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tier text := public.current_tier();
  item public.listings%rowtype;
  data jsonb;
  mine jsonb;
begin
  select * into item from public.listings where id = p_listing;
  if item.id is null then
    return jsonb_build_object('found', false);
  end if;
  -- 선공개 매물은 구독 회원·관리자만
  if item.public_at > now() and tier not in ('subscriber', 'admin') then
    return jsonb_build_object('found', false);
  end if;
  -- 비로그인은 게시 중인 매물만
  if tier = 'guest' and item.status <> 'active' then
    return jsonb_build_object('found', false);
  end if;

  data := item.listing_data;

  if tier <> 'guest' then
    select jsonb_build_object('rating', f.rating, 'bad_reasons', f.bad_reasons, 'review', f.review,
                              'masked_count', f.masked_count, 'updated_at', f.updated_at)
    into mine
    from public.listing_feedback f
    where f.listing_id = item.id and f.user_id = (select auth.uid()) and f.category_id is null;
  end if;

  return jsonb_build_object(
    'found', true,
    'tier', tier,
    'id', item.id,
    'status', item.status,
    'source', item.source,
    'checked_at', item.last_checked_at,
    'first_seen_at', item.first_seen_at,
    'gone_at', item.gone_at,
    'stale_days', public.pipeline_setting('listing.stale_days'),
    'data', jsonb_build_object(
      'gu', data ->> 'gu', 'dong', data ->> 'dong', 'floor', data ->> 'floor',
      'total_floors', data ->> 'total_floors',
      'area_m2', public.pipeline_num(data ->> 'area_m2'),
      'supply_area_m2', public.pipeline_num(data ->> 'supply_area_m2'),
      'deposit', public.pipeline_num(data ->> 'deposit'),
      'rent', public.pipeline_num(data ->> 'rent'),
      'maintenance_fee', public.pipeline_num(data ->> 'maintenance_fee'),
      'property_type', data ->> 'property_type', 'subtype', data ->> 'subtype',
      'building_name', data ->> 'building_name',
      'current_use', data ->> 'current_use', 'recommended_use', data ->> 'recommended_use',
      'approval_date', data ->> 'approval_date', 'posted_at', data ->> 'posted_at',
      'confirmed_at', data ->> 'confirmed_at', 'features', data ->> 'features',
      'station_distance_m', public.pipeline_num(data ->> 'station_distance_m'),
      'bus_stop_distance_m', public.pipeline_num(data ->> 'bus_stop_distance_m'),
      -- 원문 링크는 로그인 회원에게만
      'url', case when tier = 'guest' then null else data ->> 'url' end
    ),
    'flags', (
      select coalesce(jsonb_agg(jsonb_build_object('signal', f.signal, 'reason', f.reason) order by f.flagged_at), '[]'::jsonb)
      from public.listing_flags f
      where f.listing_id = item.id and f.cleared_at is null
    ),
    'my_feedback', mine
  );
end;
$$;

revoke all on function public.listing_detail(uuid) from public, anon, authenticated;
grant execute on function public.listing_detail(uuid) to authenticated, service_role;

-- 4. 문제 신고 ------------------------------------------------------------------
-- 이용자가 직접 신고한 매물 정보 오류도 "확인 필요"로 표시한다.
alter table public.listing_flags drop constraint listing_flags_signal_check;
alter table public.listing_flags add constraint listing_flags_signal_check
  check (signal in ('duplicate', 'long_posting', 'relisted', 'price_outlier', 'use_mismatch', 'reported'));

create table public.problem_reports (
  id                 uuid primary key default gen_random_uuid(),
  -- 비로그인 신고는 회원 번호 없이 IP 해시만 남긴다. 탈퇴하면 회원 번호를 지운다.
  user_id            uuid references public.profiles (id) on delete set null,
  ip_hash            text check (char_length(ip_hash) between 16 and 128),
  is_guest           boolean not null,
  kind               text not null check (kind in ('payment', 'privacy', 'outage', 'listing_error', 'other')),
  listing_id         uuid references public.listings (id) on delete set null,
  body               text check (char_length(body) <= 600),
  masked_count       integer not null default 0,
  urgent             boolean not null default false,
  urgent_notified_at timestamptz,
  status             text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at         timestamptz not null default now()
);

create index problem_reports_ip_idx on public.problem_reports (ip_hash, created_at);
create index problem_reports_urgent_idx on public.problem_reports (created_at) where urgent and urgent_notified_at is null;

alter table public.problem_reports enable row level security;
revoke all on public.problem_reports from anon, authenticated;
grant select (id, is_guest, kind, listing_id, body, masked_count, urgent, urgent_notified_at, status, created_at)
  on public.problem_reports to authenticated;

create policy "관리자만 신고 조회"
  on public.problem_reports for select to authenticated
  using ((select public.is_admin()));

-- 신고 받기: 글은 저장할 때 개인정보를 가리고, 비로그인은 IP당 하루 횟수와 글자 수를 제한한다.
create function public.submit_problem_report(
  p_kind text,
  p_body text,
  p_listing uuid default null,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  is_guest boolean := (select auth.uid()) is null;
  v_body text := nullif(btrim(p_body), '');
  max_len integer;
  masked jsonb;
  new_id uuid;
  is_urgent boolean := p_kind in ('payment', 'privacy', 'outage');
begin
  if p_kind not in ('payment', 'privacy', 'outage', 'listing_error', 'other') then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;
  max_len := case when is_guest then 300 else 500 end;
  if v_body is null then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  if char_length(v_body) > max_len then
    return jsonb_build_object('ok', false, 'error', 'too_long', 'max', max_len);
  end if;
  if p_listing is not null and not exists (select 1 from public.listings where id = p_listing) then
    return jsonb_build_object('ok', false, 'error', 'listing');
  end if;

  if is_guest then
    if p_ip_hash is null or char_length(p_ip_hash) < 16 then
      return jsonb_build_object('ok', false, 'error', 'ip_required');
    end if;
    if (select count(*) from public.problem_reports
        where ip_hash = p_ip_hash and created_at > now() - interval '1 day')
       >= public.pipeline_setting('guest.report_daily_limit') then
      return jsonb_build_object('ok', false, 'error', 'rate_limited');
    end if;
  end if;

  masked := public.mask_personal_text(v_body);

  insert into public.problem_reports (user_id, ip_hash, is_guest, kind, listing_id, body, masked_count, urgent)
  values (v_user, case when is_guest then p_ip_hash end, is_guest, p_kind, p_listing,
          masked ->> 'text', (masked ->> 'count')::integer, is_urgent)
  returning id into new_id;

  if p_kind = 'listing_error' and p_listing is not null then
    insert into public.listing_flags (listing_id, signal, reason)
    values (p_listing, 'reported', '이용자가 매물 정보가 실제와 다르다고 신고해 확인이 필요합니다.')
    on conflict (listing_id, signal) where cleared_at is null do nothing;
  end if;

  return jsonb_build_object('ok', true, 'id', new_id, 'urgent', is_urgent);
end;
$$;

revoke all on function public.submit_problem_report(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_problem_report(text, text, uuid, text) to authenticated, service_role;

-- 5. 긴급 알림에 문제 신고도 포함한다 (5분 모니터링이 사용) ----------------------------
create or replace function public.improvement_urgent_unnotified()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind) order by created_at), '[]'::jsonb)
  from (
    select id, urgent_kind as kind, created_at
    from public.listing_feedback
    where urgent_kind is not null and urgent_notified_at is null
    union all
    select id, kind, created_at
    from public.problem_reports
    where urgent and urgent_notified_at is null
  ) pending;
$$;

create or replace function public.improvement_mark_urgent_notified(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.listing_feedback set urgent_notified_at = now()
  where id = any (p_ids) and urgent_notified_at is null;
  update public.problem_reports set urgent_notified_at = now()
  where id = any (p_ids) and urgent_notified_at is null;
$$;
