-- 공실이(AI 상담견) 대화도 AI 사용 횟수에 넣는다: 기능 이름 'ai4_assistant' 추가
-- 근거: 대화로그 턴 206(결과를 찾을 때 1회 차감, 매물이 0곳이면 차감 안 함)
-- 되돌리기: supabase/rollback/20261124000200_ai_assistant_feature_rollback.sql

-- 기능 이름 허용 목록에 'ai4_assistant'를 더한다(기존 이름은 그대로).
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.ai_usage'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%ai1_search_text%'
  loop
    execute format('alter table public.ai_usage drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('ai1_search_text', 'ai2_explain', 'ai3_compare', 'ai4_assistant'));

-- 1회 차감: 허용 기능 목록만 바뀐다(나머지는 20261123000800과 같다).
create or replace function public.ai_use(p_feature text, p_guest_hash text default null)
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
  if p_feature not in ('ai1_search_text', 'ai2_explain', 'ai3_compare', 'ai4_assistant') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_feature');
  end if;

  perform pg_advisory_xact_lock(hashtext(coalesce(uid::text, p_guest_hash, 'none')));

  status := public.ai_status(p_guest_hash);
  if status ? 'error' then
    return jsonb_build_object('ok', false, 'reason', status ->> 'error');
  end if;
  remaining := (status ->> 'remaining')::integer;

  if tier = 'guest' then
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

revoke all on function public.ai_use(text, text) from public, anon, authenticated;
grant execute on function public.ai_use(text, text) to authenticated, service_role;
