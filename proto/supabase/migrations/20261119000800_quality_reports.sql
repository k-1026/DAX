-- 4단계 B: 품질 평가 (주 1회, 에이전트별 지표·주의 항목·지난주 대비)
-- 근거: 앱 개발/01_에이전트_AI서비스_제안.md A-2-1, A-2-2, A-2-5
-- 되돌리기: supabase/rollback/20261119000800_quality_reports_rollback.sql

-- 1. 기준값 (A-2-1 출발값. 갱신 누락·누락률·메일 성공률·분류 일치율은 기존 기준값을 함께 쓴다)
insert into public.app_settings (key, value, description) values
  ('quality.rate_min_samples',     '20',  '비율 지표 판단 보류 기준 (표본 수)'),
  ('quality.held_streak',          '2',   '품질 검사 보류 연속 횟수 주의 기준'),
  ('quality.reappear_ratio_min',   '1.5', '의심 표시 매물 재등장 비율 / 미표시 매물 재등장 비율 최소값'),
  ('quality.signal_share_max_pct', '30',  '한 검증 신호가 표시된 매물 비율 주의 기준 (%)'),
  ('quality.unsubscribe_growth',   '2',   '수신 거부 수 전주 대비 주의 배수'),
  ('quality.detect_max_minutes',   '10',  '장애 감지까지 걸린 시간 주의 기준 (분)'),
  ('quality.reject_streak',        '2',   '보정안 연속 반려 주의 기준'),
  ('quality.report_retention_days', '365', '품질 리포트 보관 기간 (일)');

-- 2. 주간 품질 리포트 ------------------------------------------------------------
create table public.quality_reports (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid references public.agent_runs (id) on delete set null,
  metrics            jsonb not null,
  warnings           jsonb not null,
  summary            text not null,
  before_collection  boolean not null,
  created_at         timestamptz not null default now()
);

create index quality_reports_created_at_idx on public.quality_reports (created_at desc);

alter table public.quality_reports enable row level security;
revoke all on public.quality_reports from anon, authenticated;
grant select on public.quality_reports to authenticated;

create policy "관리자만 품질 리포트 조회"
  on public.quality_reports for select to authenticated
  using ((select public.is_admin()));

-- 3. 지표 한 줄 만들기 ------------------------------------------------------------
-- status: ok(정상) / warn(주의) / pending(판단 보류) / unmeasured(측정 전) / info(참고)
-- 비율 지표(rate)는 표본이 기준보다 적으면 판단 보류로 바꾼다.
create function public.quality_metric(
  p_agent text,
  p_key text,
  p_label text,
  p_kind text,
  p_value numeric,
  p_unit text,
  p_threshold text,
  p_status text,
  p_detail text,
  p_samples integer default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'agent', p_agent, 'key', p_key, 'label', p_label, 'kind', p_kind,
    'value', p_value, 'unit', p_unit, 'threshold', p_threshold, 'samples', p_samples,
    'status', case
                when p_kind = 'rate' and p_status in ('ok', 'warn')
                     and coalesce(p_samples, 0) < public.pipeline_setting('quality.rate_min_samples')
                  then 'pending'
                else p_status
              end,
    'detail', case
                when p_kind = 'rate' and p_status in ('ok', 'warn')
                     and coalesce(p_samples, 0) < public.pipeline_setting('quality.rate_min_samples')
                  then format('표본 %s건으로 판단 보류 (기준 %s건). %s',
                              coalesce(p_samples, 0), public.pipeline_setting('quality.rate_min_samples'), p_detail)
                else p_detail
              end
  );
$$;

-- 4. 주간 품질 평가 ---------------------------------------------------------------
create function public.quality_weekly_report(p_run uuid, p_include_test boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  week_start timestamptz := now() - interval '7 days';
  collected boolean := exists (
    select 1 from public.agent_runs where run_type = 'refresh' and status = 'succeeded'
  );
  any_runs boolean := exists (select 1 from public.agent_runs where run_type = 'refresh');
  previous jsonb := coalesce(
    (select metrics from public.quality_reports order by created_at desc limit 1), '[]'::jsonb
  );
  metrics jsonb := '[]'::jsonb;
  merged jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  item jsonb;
  prev jsonb;
  num numeric;
  num2 numeric;
  cnt integer;
  cnt2 integer;
  rec record;
  status_list text[];
  limit_value numeric;
  summary_text text;
  new_report uuid;
  check_first jsonb := public.feedback_check_summary('first', p_include_test);
  check_second jsonb := public.feedback_check_summary('second', p_include_test);
begin
  -- 수집 ------------------------------------------------------------------
  limit_value := public.pipeline_setting('monitor.refresh_max_hours');
  if not collected then
    metrics := metrics || public.quality_metric('collect', 'refresh_gap', '3일 주기 준수 (갱신 누락)', 'count',
      null, '회', limit_value || '시간 넘으면 누락', 'unmeasured', '실제 수집 전입니다.');
  else
    with successes as (
      select finished_at from public.agent_runs where run_type = 'refresh' and status = 'succeeded'
    ), gaps as (
      select finished_at, lag(finished_at) over (order by finished_at) as before
      from successes
    )
    select count(*) into cnt
    from gaps
    where before is not null and finished_at > week_start
      and extract(epoch from finished_at - before) / 3600 > limit_value;
    if (select extract(epoch from now() - max(finished_at)) / 3600
        from public.agent_runs where run_type = 'refresh' and status = 'succeeded') > limit_value then
      cnt := cnt + 1;
    end if;
    metrics := metrics || public.quality_metric('collect', 'refresh_gap', '3일 주기 준수 (갱신 누락)', 'count',
      cnt, '회', '1회 이상이면 주의 (' || limit_value || '시간 기준)',
      case when cnt >= 1 then 'warn' else 'ok' end, format('최근 7일 갱신 누락 %s회', cnt));
  end if;

  limit_value := public.pipeline_setting('quality.held_streak');
  if not any_runs then
    metrics := metrics || public.quality_metric('collect', 'held_streak', '품질 검사 보류 연속', 'count',
      null, '회', limit_value || '회 연속이면 주의', 'unmeasured', '실제 수집 전입니다.');
  else
    cnt := 0;
    for rec in
      select status from public.agent_runs where run_type = 'refresh' order by started_at desc limit 20
    loop
      exit when rec.status <> 'held';
      cnt := cnt + 1;
    end loop;
    metrics := metrics || public.quality_metric('collect', 'held_streak', '품질 검사 보류 연속', 'count',
      cnt, '회', limit_value || '회 연속이면 주의', case when cnt >= limit_value then 'warn' else 'ok' end,
      format('최근 갱신부터 연속 보류 %s회 (실행 순서 기준)', cnt));
  end if;

  limit_value := public.pipeline_setting('pipeline.max_missing_pct');
  select max((s.result ->> 'missing_pct')::numeric), coalesce(sum((s.result ->> 'row_count')::integer), 0),
         max((s.result ->> 'change_pct')::numeric)
  into num, cnt, num2
  from public.agent_steps s
  join public.agent_runs r on r.id = s.run_id
  where r.run_type = 'refresh' and s.step_key = 'quality_check'
    and s.result ? 'missing_pct' and r.started_at > week_start;
  metrics := metrics || public.quality_metric('collect', 'missing_pct', '필수 항목 누락률 (최대)', 'rate',
    num, '%', limit_value || '% 이상이면 주의',
    case when num is null then case when any_runs then 'pending' else 'unmeasured' end
         when num >= limit_value then 'warn' else 'ok' end,
    case when num is null then case when any_runs then '이번 주 수집 없음' else '실제 수집 전입니다.' end
         else format('최근 7일 수집 %s건', cnt) end,
    cnt);
  metrics := metrics || public.quality_metric('collect', 'count_change', '직전 대비 건수 변화 (최대)', 'info',
    num2, '%', '참고 (30% 이상이면 품질 검사가 보류)', case when num2 is null then 'unmeasured' else 'info' end,
    case when num2 is null then '비교할 수집 없음' else '최근 7일 최대 변화' end);

  -- 검증: 표시 후 30일이 지난 표시를 평가한다 -----------------------------------------
  update public.listing_flags f
  set reappeared_within_30d = exists (
        select 1 from public.listing_versions v
        where v.listing_id = f.listing_id and v.change_type = 'relisted'
          and v.created_at > f.flagged_at and v.created_at <= f.flagged_at + interval '30 days'
      ) or exists (
        select 1 from public.listings l
        join public.listings other on other.identity_key = l.identity_key and other.id <> l.id
        where l.id = f.listing_id and l.identity_key is not null
          and other.first_seen_at > f.flagged_at and other.first_seen_at <= f.flagged_at + interval '30 days'
      ),
      evaluated_at = now()
  where f.evaluated_at is null and f.flagged_at <= now() - interval '30 days';

  limit_value := public.pipeline_setting('quality.reappear_ratio_min');
  with cohort as (
    -- '반복 재등록' 신호만으로 표시된 매물은 뺀다.
    select listing_id, bool_or(reappeared_within_30d) as reappeared
    from public.listing_flags
    where evaluated_at is not null
      and flagged_at > now() - interval '37 days' and flagged_at <= now() - interval '30 days'
    group by listing_id
    having bool_or(signal <> 'relisted')
  ), unflagged as (
    select l.id, (
      exists (
        select 1 from public.listing_versions v
        where v.listing_id = l.id and v.change_type = 'relisted'
          and v.created_at > l.first_seen_at and v.created_at <= l.first_seen_at + interval '30 days'
      ) or exists (
        select 1 from public.listings other
        where l.identity_key is not null and other.identity_key = l.identity_key and other.id <> l.id
          and other.first_seen_at > l.first_seen_at and other.first_seen_at <= l.first_seen_at + interval '30 days'
      )
    ) as reappeared
    from public.listings l
    where l.first_seen_at > now() - interval '37 days' and l.first_seen_at <= now() - interval '30 days'
      and not exists (select 1 from public.listing_flags f where f.listing_id = l.id)
  )
  select
    (select count(*) from cohort),
    (select round(avg(case when reappeared then 100 else 0 end), 1) from cohort),
    (select round(avg(case when reappeared then 100 else 0 end), 1) from unflagged)
  into cnt, num, num2;

  metrics := metrics || public.quality_metric('verify', 'reappear_ratio', '의심 표시 매물 재등장 비율 (미표시 대비)', 'rate',
    case when coalesce(num2, 0) > 0 then round(num / num2, 2) end, '배', limit_value || '배 미만이면 주의',
    case when cnt = 0 then case when collected then 'pending' else 'unmeasured' end
         when coalesce(num2, 0) = 0 then case when num > 0 then 'ok' else 'pending' end
         when num / num2 < limit_value then 'warn' else 'ok' end,
    case when cnt = 0 then case when collected then '표시 후 30일이 지난 매물이 없습니다.' else '실제 수집 전입니다.' end
         else format('표시 매물 재등장 %s%%, 미표시 매물 재등장 %s%%', num, coalesce(num2, 0)) end,
    cnt);

  limit_value := public.pipeline_setting('quality.signal_share_max_pct');
  select count(*) into cnt from public.listings where status = 'active';
  select signal, round(count(distinct f.listing_id) * 100.0 / nullif(cnt, 0), 1) as share
  into rec
  from public.listing_flags f
  join public.listings l on l.id = f.listing_id and l.status = 'active'
  where f.cleared_at is null
  group by signal
  order by share desc
  limit 1;
  metrics := metrics || public.quality_metric('verify', 'signal_share', '한 신호가 표시된 매물 비율 (최대)', 'rate',
    coalesce(rec.share, 0), '%', limit_value || '% 이상이면 주의',
    case when cnt = 0 then 'unmeasured' when coalesce(rec.share, 0) >= limit_value then 'warn' else 'ok' end,
    case when cnt = 0 then '실제 수집 전입니다.'
         when rec.signal is null then '표시된 매물 없음'
         else format('가장 많은 신호: %s', rec.signal) end,
    cnt);

  -- 스코어링: 아직 측정 전 ----------------------------------------------------------
  metrics := metrics
    || public.quality_metric('scoring', 'golden', '정답지 재채점', 'count', null, null,
         '가중치 변경 없이 결과가 달라지면 주의', 'unmeasured', '스코어링 확정 전 (정답지 비어 있음)')
    || public.quality_metric('scoring', 'good_by_sort', 'good 비율 (추천순 vs 월세순)', 'rate', null, '%',
         '추천순이 월세순 이하이면 주의', 'unmeasured', '정렬 방식 값은 검색 화면(6단계)에서 확정')
    || public.quality_metric('scoring', 'zero_results', '결과 0건 비율', 'rate', null, '%',
         '20% 이상이면 주의', 'unmeasured', '검색 기록은 검색 화면(6단계)부터 쌓임');

  -- 메일 -------------------------------------------------------------------
  limit_value := public.pipeline_setting('monitor.mail_success_min_pct');
  select count(*) filter (where status = 'sent'), count(*)
  into cnt2, cnt
  from public.email_sends
  where status in ('sent', 'failed') and created_at > week_start;
  num := case when cnt > 0 then round(cnt2 * 100.0 / cnt, 1) end;
  metrics := metrics || public.quality_metric('mail', 'success_rate', '발송 성공률', 'rate',
    num, '%', limit_value || '% 미만이면 주의',
    case when cnt = 0 then 'pending' when num < limit_value then 'warn' else 'ok' end,
    case when cnt = 0 then '이번 주 발송 없음' else format('최근 7일 %s통 중 %s통 성공', cnt, cnt2) end,
    cnt);
  metrics := metrics
    || public.quality_metric('mail', 'open_rate', '열람률', 'rate', null, '%', '20% 미만 2주 연속이면 주의',
         'unmeasured', '열람 추적 연결 전 (출시 전 발신 도메인 인증 때). 메일 앱 자동 열람으로 부풀 수 있음')
    || public.quality_metric('mail', 'click_rate', '클릭률', 'rate', null, '%', '열람 추적 연결 후 정함',
         'unmeasured', '열람 추적 연결 전');

  limit_value := public.pipeline_setting('quality.unsubscribe_growth');
  select count(*) into cnt
  from public.user_consents
  where consent_type = 'email' and withdrawn_at > week_start;
  select (m ->> 'value')::numeric into num
  from jsonb_array_elements(previous) m
  where m ->> 'agent' = 'mail' and m ->> 'key' = 'unsubscribes';
  metrics := metrics || public.quality_metric('mail', 'unsubscribes', '수신 거부 수', 'count',
    cnt, '명', '전주 대비 ' || limit_value || '배 이상이면 주의',
    case when coalesce(num, 0) > 0 and cnt >= num * limit_value then 'warn' else 'ok' end,
    case when num is null then format('최근 7일 %s명 (지난주 비교 없음)', cnt)
         else format('최근 7일 %s명, 지난주 %s명', cnt, num) end);

  -- 모니터링: 처음 실패부터 경보까지 걸린 시간 ---------------------------------------------
  limit_value := public.pipeline_setting('quality.detect_max_minutes');
  select count(*), round(max(extract(epoch from opened.checked_at - (
           select min(h.checked_at) from public.health_checks h
           where h.check_key = opened.check_key and not h.ok and h.id <= opened.id
             and h.id > coalesce((
               select max(okrow.id) from public.health_checks okrow
               where okrow.check_key = opened.check_key and okrow.ok and okrow.id < opened.id
             ), 0)
         )) / 60), 1)
  into cnt, num
  from public.health_checks opened
  where opened.alert = 'opened' and opened.checked_at > week_start;
  metrics := metrics || public.quality_metric('monitor', 'detect_minutes', '장애 감지까지 걸린 시간 (최대)', 'count',
    num, '분', limit_value || '분 넘으면 주의',
    case when cnt = 0 then 'ok' when num > limit_value then 'warn' else 'ok' end,
    case when cnt = 0 then '이번 주 경보 없음' else format('이번 주 경보 %s건', cnt) end);
  metrics := metrics || public.quality_metric('monitor', 'false_alarm', '잘못된 경보 비율', 'rate', null, '%',
    '30% 이상이면 주의', 'unmeasured', '관리자가 잘못된 경보를 표시하는 화면(8단계) 전');

  -- 피드백 분석 ----------------------------------------------------------------
  foreach item in array array[
    jsonb_build_object('key', 'first_agreement', 'label', 'AI 분류 일치율 (1차 자동 채점)', 'check', check_first),
    jsonb_build_object('key', 'second_agreement', 'label', 'AI 분류 일치율 (2차 재검수)', 'check', check_second)
  ] loop
    metrics := metrics || public.quality_metric('feedback', item ->> 'key', item ->> 'label', 'rate',
      (item #>> '{check,rate}')::numeric, '%', (item #>> '{check,pass_pct}') || '% 미만이면 주의',
      case item #>> '{check,status}' when 'fail' then 'warn' when 'pass' then 'ok' else 'pending' end,
      format('최근 7일 %s건 중 %s건 일치', item #>> '{check,total}', item #>> '{check,matched}'),
      (item #>> '{check,total}')::integer);
  end loop;

  limit_value := public.pipeline_setting('quality.reject_streak');
  cnt := 0;
  for rec in
    select status from public.weight_proposals
    where status in ('approved', 'rejected')
    order by reviewed_at desc nulls last
    limit 20
  loop
    exit when rec.status <> 'rejected';
    cnt := cnt + 1;
  end loop;
  metrics := metrics || public.quality_metric('feedback', 'reject_streak', '보정안 연속 반려', 'count',
    cnt, '회', limit_value || '회 연속이면 주의', case when cnt >= limit_value then 'warn' else 'ok' end,
    format('최근 검토부터 연속 반려 %s회', cnt));

  select count(*) filter (where status = 'approved'), count(*)
  into cnt2, cnt
  from public.weight_proposals
  where status in ('approved', 'rejected');
  metrics := metrics || public.quality_metric('feedback', 'approval_rate', '보정안 승인율 (누적)', 'info',
    case when cnt > 0 then round(cnt2 * 100.0 / cnt, 1) end, '%', '참고',
    case when cnt = 0 then 'unmeasured' else 'info' end,
    case when cnt = 0 then '검토한 보정안 없음' else format('%s건 중 %s건 승인', cnt, cnt2) end);
  metrics := metrics || public.quality_metric('feedback', 'good_after_approval', '승인 후 good 비율 변화', 'rate',
    null, '%p', '하락하면 주의', 'unmeasured', '보정안 승인 화면(8단계) 전');

  -- 지난주 대비, 연속 주의 횟수 (판단 보류·측정 전인 주는 연속을 끊는다) ----------------------
  for item in select * from jsonb_array_elements(metrics) loop
    select m into prev
    from jsonb_array_elements(previous) m
    where m ->> 'agent' = item ->> 'agent' and m ->> 'key' = item ->> 'key';

    item := item || jsonb_build_object(
      'previous', prev -> 'value',
      'change', case when jsonb_typeof(item -> 'value') = 'number' and jsonb_typeof(prev -> 'value') = 'number'
                     then to_jsonb((item ->> 'value')::numeric - (prev ->> 'value')::numeric) end,
      'streak', case when item ->> 'status' = 'warn' then coalesce((prev ->> 'streak')::integer, 0) + 1 else 0 end
    );
    merged := merged || item;
    if item ->> 'status' = 'warn' then
      warnings := warnings || item;
    end if;
  end loop;

  -- 정해진 문장으로 요약 (AI 키 연결 후 AI 요약으로 바꾼다)
  select string_agg(format('%s %s%s(%s)', w ->> 'label', coalesce(w ->> 'value', '-'), coalesce(w ->> 'unit', ''),
                           w ->> 'threshold'), ', ')
  into summary_text
  from jsonb_array_elements(warnings) w;
  summary_text := case when collected then '' else '실제 수집 전. ' end
    || case when jsonb_array_length(warnings) = 0 then '주의 항목 없음'
            else format('주의 %s건: %s', jsonb_array_length(warnings), summary_text) end;

  insert into public.quality_reports (run_id, metrics, warnings, summary, before_collection)
  values (p_run, merged, warnings, summary_text, not collected)
  returning id into new_report;

  delete from public.quality_reports
  where created_at < now() - make_interval(days => public.pipeline_setting('quality.report_retention_days')::integer);

  return jsonb_build_object(
    'report_id', new_report, 'summary', summary_text, 'before_collection', not collected,
    'warnings', jsonb_array_length(warnings), 'metrics', jsonb_array_length(merged)
  );
end;
$$;

-- 5. 주간 실행에 품질 평가 단계를 붙인다 ---------------------------------------------
create or replace function public.weekly_start_run()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_run uuid;
begin
  insert into public.agent_runs (run_type)
  values ('weekly')
  returning id into new_run;

  insert into public.agent_steps (run_id, step_key, step_order)
  select new_run, step_key, step_order
  from unnest(array['feedback_classify', 'feedback_second_check', 'feedback_report', 'quality_eval'])
       with ordinality as steps (step_key, step_order);

  return new_run;
end;
$$;

-- 6. 함수 실행 권한 ---------------------------------------------------------------
revoke all on function public.quality_metric(text, text, text, text, numeric, text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.quality_weekly_report(uuid, boolean) from public, anon, authenticated;
grant execute on function public.quality_weekly_report(uuid, boolean) to service_role;
