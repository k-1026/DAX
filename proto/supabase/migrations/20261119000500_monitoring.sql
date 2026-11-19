-- 4단계 B: 모니터링 (5분 점검, 경보 판단, 점검 기록)
-- 근거: 앱 개발/01_에이전트_AI서비스_제안.md A-2-3
-- 되돌리기: supabase/rollback/20261119000500_monitoring_rollback.sql

-- 1. 기준값 -------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('monitor.fail_streak',          '2',  '경보를 보내는 연속 실패 횟수'),
  ('monitor.slow_ms',              '3000', '느린 응답 기준 (밀리초)'),
  ('monitor.refresh_max_hours',    '78', '마지막 갱신 성공 후 경보까지 시간'),
  ('monitor.mail_success_min_pct', '95', '최근 24시간 메일 성공률 하한 (%)'),
  ('monitor.retention_days',       '30', '점검 기록 보관 기간 (일)'),
  ('monitor.weekly_max_days',      '8',  '주간 실행이 성공하지 않은 채 경보까지 일수');

-- 2. 점검 기록 -----------------------------------------------------------------
-- alert: 이 점검에서 경보 메일을 보냈으면 'opened', 복구 메일을 보냈으면 'resolved'
create table public.health_checks (
  id          bigint generated always as identity primary key,
  check_key   text not null check (
                check_key in ('site', 'site_slow', 'db', 'refresh_overdue', 'refresh_stuck', 'mail_failures', 'weekly_stuck')
              ),
  ok          boolean not null,
  response_ms integer,
  detail      text not null,
  error       text,
  alert       text check (alert in ('opened', 'resolved')),
  checked_at  timestamptz not null default now()
);

create index health_checks_key_idx on public.health_checks (check_key, id desc);
create index health_checks_checked_at_idx on public.health_checks (checked_at);

alter table public.health_checks enable row level security;
revoke all on public.health_checks from anon, authenticated;
grant select on public.health_checks to authenticated;

create policy "관리자만 점검 기록 조회"
  on public.health_checks for select to authenticated
  using ((select public.is_admin()));

-- 3. DB 안에서 확인하는 점검 ------------------------------------------------------
-- 회원 정보는 읽지 않고 건수와 상태만 돌려준다.
create function public.monitor_db_checks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  max_hours numeric := public.pipeline_setting('monitor.refresh_max_hours');
  min_pct numeric := public.pipeline_setting('monitor.mail_success_min_pct');
  last_success timestamptz;
  hours numeric;
  latest record;
  step_error text;
  sent_count integer;
  failed_count integer;
  last_mail_error text;
  weekly_days numeric := public.pipeline_setting('monitor.weekly_max_days');
  latest_weekly record;
  last_weekly_success timestamptz;
  checks jsonb := '[]'::jsonb;
begin
  -- 3일 갱신 누락
  select max(finished_at) into last_success
  from public.agent_runs
  where run_type = 'refresh' and status = 'succeeded';

  if last_success is null then
    checks := checks || jsonb_build_object(
      'key', 'refresh_overdue', 'ok', true, 'detail', '아직 성공한 갱신이 없습니다.'
    );
  else
    hours := floor(extract(epoch from now() - last_success) / 3600);
    checks := checks || jsonb_build_object(
      'key', 'refresh_overdue',
      'ok', hours < max_hours,
      'detail', format('마지막 갱신 성공 후 %s시간 지남 (기준 %s시간)', hours, max_hours)
    );
  end if;

  -- 최근 갱신이 실패하거나 보류된 채 멈춤
  select id, status into latest
  from public.agent_runs
  where run_type = 'refresh'
  order by started_at desc
  limit 1;

  if latest.id is null or latest.status not in ('failed', 'held') then
    checks := checks || jsonb_build_object(
      'key', 'refresh_stuck', 'ok', true,
      'detail', coalesce('최근 갱신 상태: ' || latest.status, '아직 갱신 기록이 없습니다.')
    );
  else
    select s.step_key || ' 단계: ' || coalesce(s.error, '오류 내용 없음') into step_error
    from public.agent_steps s
    where s.run_id = latest.id and s.status in ('failed', 'held')
    order by s.step_order
    limit 1;

    checks := checks || jsonb_build_object(
      'key', 'refresh_stuck',
      'ok', false,
      'detail', case latest.status
                  when 'failed' then '최근 갱신이 실패한 채 멈춰 있습니다.'
                  else '최근 갱신이 관리자 승인을 기다리고 있습니다(보류).'
                end,
      'error', step_error
    );
  end if;

  -- 최근 24시간 메일 발송 성공률
  select count(*) filter (where status = 'sent'), count(*) filter (where status = 'failed')
  into sent_count, failed_count
  from public.email_sends
  where status in ('sent', 'failed')
    and created_at > now() - interval '24 hours';

  select error into last_mail_error
  from public.email_sends
  where status = 'failed' and created_at > now() - interval '24 hours'
  order by created_at desc
  limit 1;

  checks := checks || jsonb_build_object(
    'key', 'mail_failures',
    'ok', failed_count = 0 or sent_count * 100.0 / (sent_count + failed_count) >= min_pct,
    'detail', format(
      '최근 24시간 메일 %s통 중 실패 %s통 (성공률 %s%%, 기준 %s%%)',
      sent_count + failed_count, failed_count,
      case when sent_count + failed_count = 0 then 100
           else floor(sent_count * 100.0 / (sent_count + failed_count)) end,
      min_pct
    ),
    'error', last_mail_error
  );

  -- 주간 실행: 최근 실행이 실패했거나, 성공한 지 오래됨 (실행 자체가 멈춘 경우도 잡는다)
  select id, status, error into latest_weekly
  from public.agent_runs
  where run_type = 'weekly'
  order by started_at desc
  limit 1;

  select max(finished_at) into last_weekly_success
  from public.agent_runs
  where run_type = 'weekly' and status = 'succeeded';

  if latest_weekly.id is null then
    checks := checks || jsonb_build_object(
      'key', 'weekly_stuck', 'ok', true, 'detail', '아직 주간 실행 기록이 없습니다.'
    );
  elsif latest_weekly.status = 'failed' then
    checks := checks || jsonb_build_object(
      'key', 'weekly_stuck', 'ok', false,
      'detail', '최근 주간 실행이 실패했습니다.',
      'error', (
        select s.step_key || ' 단계: ' || coalesce(s.error, '오류 내용 없음')
        from public.agent_steps s
        where s.run_id = latest_weekly.id and s.status = 'failed'
        order by s.step_order
        limit 1
      )
    );
  elsif coalesce(last_weekly_success, (
          select min(started_at) from public.agent_runs where run_type = 'weekly'
        )) < now() - make_interval(days => weekly_days::integer) then
    checks := checks || jsonb_build_object(
      'key', 'weekly_stuck', 'ok', false,
      'detail', format('주간 실행이 %s일 넘게 성공하지 않았습니다.', weekly_days)
    );
  else
    checks := checks || jsonb_build_object(
      'key', 'weekly_stuck', 'ok', true,
      'detail', '최근 주간 실행 상태: ' || latest_weekly.status
    );
  end if;

  return jsonb_build_object('checks', checks, 'slow_ms', public.pipeline_setting('monitor.slow_ms'));
end;
$$;

-- 4. 점검 결과 기록과 경보 판단 ---------------------------------------------------
-- 같은 점검이 연속으로 실패하면 'opened'를, 경보 중에 정상이 되면 'resolved'를 한 번만 돌려준다.
create function public.monitor_record(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  streak integer := public.pipeline_setting('monitor.fail_streak')::integer;
  item jsonb;
  key text;
  latest record;
  recent_failures integer;
  recent_total integer;
  is_open boolean;
  opened_at timestamptz;
  notices jsonb := '[]'::jsonb;
begin
  -- 점검이 겹쳐 실행되어도 경보가 두 번 나가지 않게 한다.
  perform pg_advisory_xact_lock(hashtext('monitor_record'));

  for item in select * from jsonb_array_elements(p_results) loop
    insert into public.health_checks (check_key, ok, response_ms, detail, error)
    values (
      item ->> 'key',
      (item ->> 'ok')::boolean,
      (item ->> 'response_ms')::integer,
      coalesce(item ->> 'detail', ''),
      left(item ->> 'error', 500)
    );
  end loop;

  for key in select distinct entry ->> 'key' from jsonb_array_elements(p_results) as entry loop
    select id, ok, detail, error into latest
    from public.health_checks h
    where h.check_key = key
    order by id desc
    limit 1;

    select count(*) filter (where not ok), count(*)
    into recent_failures, recent_total
    from (
      select ok from public.health_checks h
      where h.check_key = key
      order by id desc
      limit streak
    ) recent;

    select h.alert = 'opened', h.checked_at into is_open, opened_at
    from public.health_checks h
    where h.check_key = key and h.alert is not null
    order by id desc
    limit 1;

    if coalesce(is_open, false) is false and recent_total = streak and recent_failures = streak then
      update public.health_checks set alert = 'opened' where id = latest.id;
      notices := notices || jsonb_build_object(
        'type', 'opened', 'id', latest.id, 'key', key,
        'detail', latest.detail, 'error', latest.error, 'failures', streak
      );
    elsif is_open and latest.ok then
      update public.health_checks set alert = 'resolved' where id = latest.id;
      notices := notices || jsonb_build_object(
        'type', 'resolved', 'id', latest.id, 'key', key,
        'detail', latest.detail, 'opened_at', opened_at
      );
    end if;
  end loop;

  delete from public.health_checks
  where checked_at < now() - make_interval(days => public.pipeline_setting('monitor.retention_days')::integer);

  return notices;
end;
$$;

-- 경보 메일 발송에 실패하면 표시를 지워 다음 점검에서 다시 보낸다.
create function public.monitor_undo_alert(p_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.health_checks set alert = null where id = p_id;
$$;

-- 5. 함수 실행 권한: 서버의 서비스 키로만 실행한다. ------------------------------------
revoke all on function public.monitor_db_checks() from public, anon, authenticated;
revoke all on function public.monitor_record(jsonb) from public, anon, authenticated;
revoke all on function public.monitor_undo_alert(bigint) from public, anon, authenticated;

grant execute on function public.monitor_db_checks() to service_role;
grant execute on function public.monitor_record(jsonb) to service_role;
grant execute on function public.monitor_undo_alert(bigint) to service_role;
