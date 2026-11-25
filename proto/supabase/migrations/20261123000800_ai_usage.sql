-- 6-F AI-1: AI 사용 기록과 횟수 확인·차감 (문장으로 찾기)
-- 근거: 01 문서 B절 비용 관리(비로그인 전체 3회 / 로그인 하루 10회 / 구독 하루 30회), 03 문서 ai_usage, 04 문서 등급 규칙
-- 되돌리기: supabase/rollback/20261123000800_ai_usage_rollback.sql
-- 이 단계의 AI는 규칙 기반 시험용이라 제공사·모델·토큰 칸은 비워 둔다(나중에 실제 AI 연결 시 채움).

create table public.ai_usage (
  id            bigint generated always as identity primary key,
  -- 탈퇴하면 회원 번호를 지우고 통계용으로만 남긴다.
  user_id       uuid references public.profiles (id) on delete set null,
  -- 비로그인: 접속지를 변환한 값(원래 값은 알 수 없음)
  guest_hash    text check (guest_hash is null or char_length(guest_hash) between 16 and 128),
  feature       text not null check (feature in ('ai1_search_text', 'ai2_explain', 'ai3_compare')),
  -- 한국 시간 날짜
  used_on       date not null default ((now() at time zone 'Asia/Seoul')::date),
  counted       boolean not null default true,
  provider      text,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  cost_krw      numeric,
  created_at    timestamptz not null default now()
);

create index ai_usage_user_day_idx on public.ai_usage (user_id, used_on);
create index ai_usage_guest_idx on public.ai_usage (guest_hash, used_on);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- 남은 횟수 확인 (차감 없음). 비로그인은 서버(서비스 키)가 접속지 값을 넣어 대신 부른다.
create function public.ai_status(p_guest_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tier text := public.current_tier();
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Seoul')::date;
  lim integer;
  used integer;
  period text;
begin
  if tier = 'admin' then
    return jsonb_build_object('tier', tier, 'limit', null, 'used', 0, 'remaining', null, 'period', 'day');
  elsif tier = 'guest' then
    if p_guest_hash is null or char_length(p_guest_hash) < 16 then
      return jsonb_build_object('tier', tier, 'error', 'guest_required');
    end if;
    lim := public.pipeline_setting('guest.ai_total_limit')::integer;
    period := 'total';
    select count(*) into used from public.ai_usage where guest_hash = p_guest_hash and counted;
  else
    lim := case when tier = 'subscriber'
                then public.pipeline_setting('subscriber.ai_daily_limit')::integer
                else public.pipeline_setting('member.ai_daily_limit')::integer end;
    period := 'day';
    select count(*) into used from public.ai_usage where user_id = uid and used_on = today and counted;
  end if;
  return jsonb_build_object('tier', tier, 'limit', lim, 'used', used,
                            'remaining', greatest(lim - used, 0), 'period', period);
end;
$$;

-- 1회 차감. 한도를 넘으면 기록하지 않고 ok=false.
create function public.ai_use(p_feature text, p_guest_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  tier text := public.current_tier();
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Seoul')::date;
  status jsonb;
  remaining integer;
begin
  if p_feature not in ('ai1_search_text', 'ai2_explain', 'ai3_compare') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_feature');
  end if;
  -- 같은 사람이 동시에 눌러도 한도를 넘지 않게 한 줄씩 처리한다.
  perform pg_advisory_xact_lock(hashtext(coalesce(uid::text, p_guest_hash, 'none')));

  status := public.ai_status(p_guest_hash);
  if status ? 'error' then
    return jsonb_build_object('ok', false, 'reason', status ->> 'error');
  end if;
  remaining := (status ->> 'remaining')::integer;

  if tier = 'guest' then
    -- 비로그인 전체 하루 상한(우회 대비)
    if (select count(*) from public.ai_usage where user_id is null and guest_hash is not null and used_on = today)
       >= public.pipeline_setting('guest.ai_daily_cap')::integer then
      return jsonb_build_object('ok', false, 'reason', 'daily_cap') || (status - 'tier');
    end if;
  end if;

  if remaining is not null and remaining <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'limit') || (status - 'tier');
  end if;

  insert into public.ai_usage (user_id, guest_hash, feature)
  values (case when tier = 'guest' then null else uid end,
          case when tier = 'guest' then p_guest_hash else null end,
          p_feature);

  return jsonb_build_object('ok', true) || public.ai_status(p_guest_hash) - 'tier';
end;
$$;

revoke all on function public.ai_status(text) from public, anon, authenticated;
revoke all on function public.ai_use(text, text) from public, anon, authenticated;
-- 회원은 본인 로그인으로, 비로그인은 서버(서비스 키)가 대신 부른다.
grant execute on function public.ai_status(text) to authenticated, service_role;
grant execute on function public.ai_use(text, text) to authenticated, service_role;
