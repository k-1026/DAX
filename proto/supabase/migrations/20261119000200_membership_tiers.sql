-- 3단계: 등급별 권한 (구독 상태, 한도 설정값, 등급 판단)
-- 근거: 앱 개발/03_데이터_설계서.md 3절 D·G묶음, 4절 등급별 접근 권한
-- 되돌리기: supabase/rollback/20261119000200_membership_tiers_rollback.sql

-- 1. 구독 상태 ----------------------------------------------------------------
-- 결제 기능을 만들 때 서버만 이 표를 변경한다. 사용자는 조회만 할 수 있다.
create table public.subscriptions (
  id                   bigint generated always as identity primary key,
  user_id              uuid not null references public.profiles (id) on delete cascade,
  status               text not null
                       check (status in ('active', 'past_due', 'canceled', 'expired')),
  current_period_start timestamptz not null,
  current_period_end   timestamptz not null,
  grace_until          timestamptz,
  canceled_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

-- 이용 중인 구독은 회원당 1건만 둔다.
create unique index subscriptions_one_live_per_user
  on public.subscriptions (user_id)
  where status in ('active', 'past_due');

create index subscriptions_user_id_idx on public.subscriptions (user_id);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

create policy "본인 또는 관리자만 구독 상태 조회"
  on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- 2. 한도 설정값 --------------------------------------------------------------
-- 값이 null이면 제한 없음이다.
create table public.app_settings (
  key         text primary key,
  value       jsonb not null check (
                jsonb_typeof(value) = 'null'
                or (jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric >= 0)
              ),
  description text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create table public.app_setting_changes (
  id         bigint generated always as identity primary key,
  key        text not null references public.app_settings (key) on delete cascade,
  old_value  jsonb not null,
  new_value  jsonb not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);

insert into public.app_settings (key, value, description) values
  ('guest.listing_limit',           '3',    '비로그인 공개 매물 수'),
  ('guest.ai_total_limit',          '3',    '비로그인 AI 이용 횟수 (브라우저당 전체)'),
  ('guest.ai_daily_cap',            '300',  '비로그인 AI 전체 일일 상한'),
  ('member.saved_limit',            '3',    '로그인 회원 담기 한도'),
  ('member.compare_limit',          '2',    '로그인 회원 비교 한도'),
  ('member.ai_daily_limit',         '10',   '로그인 회원 AI 하루 이용 횟수'),
  ('subscriber.saved_limit',        'null', '구독 회원 담기 한도'),
  ('subscriber.compare_limit',      '5',    '구독 회원 비교 한도'),
  ('subscriber.ai_daily_limit',     '30',   '구독 회원 AI 하루 이용 횟수'),
  ('subscriber.mail_monthly_limit', '10',   '구독 회원 추천 메일 월 상한'),
  ('payment.grace_hours',           '24',   '결제 실패 후 유예 시간');

-- 값을 바꾸면 누가, 언제, 무엇을 바꿨는지 자동으로 남긴다.
create function public.record_setting_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.updated_by = (select auth.uid());
  insert into public.app_setting_changes (key, old_value, new_value, changed_by)
  values (old.key, old.value, new.value, (select auth.uid()));
  return new;
end;
$$;

revoke all on function public.record_setting_change() from public, anon, authenticated;

create trigger app_settings_record_change
  before update on public.app_settings
  for each row execute function public.record_setting_change();

alter table public.app_settings enable row level security;
alter table public.app_setting_changes enable row level security;

revoke all on public.app_settings from anon, authenticated;
revoke all on public.app_setting_changes from anon, authenticated;
grant select on public.app_settings to authenticated;
grant update (value) on public.app_settings to authenticated;
grant select on public.app_setting_changes to authenticated;

create policy "관리자만 설정값 조회"
  on public.app_settings for select to authenticated
  using ((select public.is_admin()));

create policy "관리자만 설정값 변경"
  on public.app_settings for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "관리자만 설정 변경 기록 조회"
  on public.app_setting_changes for select to authenticated
  using ((select public.is_admin()));

-- 3. 등급 판단 ----------------------------------------------------------------
-- guest: 비로그인 / member: 로그인 / subscriber: 구독 / admin: 관리자
create function public.current_tier()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then 'guest'
    when public.is_admin() then 'admin'
    when exists (
      select 1
      from public.subscriptions s
      where s.user_id = (select auth.uid())
        and (
          (s.status in ('active', 'canceled') and s.current_period_end > now())
          or (s.status = 'past_due' and s.grace_until > now())
        )
    ) then 'subscriber'
    else 'member'
  end;
$$;

revoke all on function public.current_tier() from public;
grant execute on function public.current_tier() to anon, authenticated;

-- 현재 사용자의 등급과 한도를 돌려준다. 다른 등급의 값은 돌려주지 않는다.
create function public.my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tier text := public.current_tier();
  settings jsonb;
begin
  select jsonb_object_agg(key, value) into settings from public.app_settings;

  return case tier
    when 'guest' then jsonb_build_object(
      'tier', tier, 'listing_limit', settings -> 'guest.listing_limit',
      'saved_limit', 0, 'compare_limit', 0,
      'ai_limit', settings -> 'guest.ai_total_limit', 'ai_period', 'total',
      'early_access', false
    )
    when 'member' then jsonb_build_object(
      'tier', tier, 'listing_limit', null,
      'saved_limit', settings -> 'member.saved_limit',
      'compare_limit', settings -> 'member.compare_limit',
      'ai_limit', settings -> 'member.ai_daily_limit', 'ai_period', 'day',
      'early_access', false
    )
    when 'subscriber' then jsonb_build_object(
      'tier', tier, 'listing_limit', null,
      'saved_limit', settings -> 'subscriber.saved_limit',
      'compare_limit', settings -> 'subscriber.compare_limit',
      'ai_limit', settings -> 'subscriber.ai_daily_limit', 'ai_period', 'day',
      'early_access', true
    )
    else jsonb_build_object(
      'tier', tier, 'listing_limit', null,
      'saved_limit', null,
      'compare_limit', settings -> 'subscriber.compare_limit',
      'ai_limit', null, 'ai_period', 'day',
      'early_access', true
    )
  end;
end;
$$;

revoke all on function public.my_access() from public;
grant execute on function public.my_access() to anon, authenticated;
