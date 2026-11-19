-- 4단계 B: 피드백 분석 (주 1회, AI 분류 확인, 사유 분포 리포트, 가중치 보정안 자리)
-- 근거: 앱 개발/01_에이전트_AI서비스_제안.md A-2-2, A-2-4
-- 되돌리기: supabase/rollback/20261119000700_feedback_analysis_rollback.sql

-- 1. 기준값 -------------------------------------------------------------------
-- 보정안을 내는 기준 비율은 스코어링 확정 때 정한다(비워 둠). 비어 있으면 리포트만 만든다.
insert into public.app_settings (key, value, description) values
  ('feedback.min_bad_samples',       '10',   '보정안 최소 표본: 사유를 고른 bad 평가 수 (회원 증가 후 20)'),
  ('feedback.min_users',             '3',    '보정안 최소 사용자 수 (회원 증가 후 5)'),
  ('feedback.max_per_user',          '4',    '한 사람 평가 최대 반영 수 (회원 증가 후 8)'),
  ('feedback.small_sample_below',    '20',   '이보다 적은 표본의 보정안에 "표본 적음" 표시'),
  ('feedback.proposal_min_reason_pct', 'null', '보정안을 내는 기준 비율 (%) — 스코어링 확정 때 정함'),
  ('feedback.check_min_samples',     '20',   'AI 분류 확인 판단 보류 기준 (건)'),
  ('feedback.check_pass_pct',        '80',   'AI 분류 일치율 통과 기준 (%)'),
  ('feedback.second_check_weekly',   '20',   '2차 AI 재검수 주간 표본 수');

-- 2. AI 분류 확인 기록 ------------------------------------------------------------
-- first: AI 분류 vs 회원이 고른 사유 / second: AI 2개의 분류 비교
create table public.feedback_classifications (
  id            bigint generated always as identity primary key,
  feedback_id   uuid not null references public.listing_feedback (id) on delete cascade,
  stage         text not null check (stage in ('first', 'second')),
  provider      text not null check (char_length(provider) <= 40),
  model         text check (char_length(model) <= 100),
  ai_reason     text not null check (ai_reason in ('rent_terms', 'space', 'location', 'entry', 'info_error', 'other')),
  compared_with text check (compared_with in ('rent_terms', 'space', 'location', 'entry', 'info_error', 'other')),
  matched       boolean,
  -- 가짜 분류기 결과. 통계에서 뺀다.
  is_test       boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (feedback_id, stage, provider)
);

create index feedback_classifications_recent_idx on public.feedback_classifications (stage, created_at);

-- 리뷰 글을 고치면 이전 분류를 지워 다시 분류하게 한다.
create function public.feedback_clear_classifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.review is distinct from old.review then
    delete from public.feedback_classifications where feedback_id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.feedback_clear_classifications() from public, anon, authenticated;

create trigger listing_feedback_clear_classifications
  after update of review on public.listing_feedback
  for each row execute function public.feedback_clear_classifications();

-- 3. 가중치 보정안 ---------------------------------------------------------------
-- adjustment(조정 크기)는 스코어링 확정 전까지 비워 둔다.
create table public.weight_proposals (
  id                 uuid primary key default gen_random_uuid(),
  category_id        bigint not null references public.business_categories (id) on delete cascade,
  scoring_version_id bigint references public.scoring_versions (id) on delete set null,
  target_group       text not null check (target_group in ('cost', 'space', 'location', 'fit')),
  adjustment         jsonb not null default '{}',
  evidence           jsonb not null,
  small_sample       boolean not null default false,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by        uuid references public.profiles (id) on delete set null,
  reviewed_at        timestamptz,
  review_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 업종·점수 버전마다 승인 대기 보정안은 1개
create unique index weight_proposals_one_pending
  on public.weight_proposals (category_id, scoring_version_id) nulls not distinct
  where status = 'pending';

alter table public.feedback_classifications enable row level security;
alter table public.weight_proposals enable row level security;
revoke all on public.feedback_classifications from anon, authenticated;
revoke all on public.weight_proposals from anon, authenticated;
grant select on public.feedback_classifications to authenticated;
grant select on public.weight_proposals to authenticated;

create policy "관리자만 분류 확인 조회"
  on public.feedback_classifications for select to authenticated
  using ((select public.is_admin()));

create policy "관리자만 보정안 조회"
  on public.weight_proposals for select to authenticated
  using ((select public.is_admin()));

-- 4. 주간 실행 시작 --------------------------------------------------------------
create function public.weekly_start_run()
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
  from unnest(array['feedback_classify', 'feedback_second_check', 'feedback_report'])
       with ordinality as steps (step_key, step_order);

  return new_run;
end;
$$;

-- 5. AI로 보낼 리뷰 고르기 --------------------------------------------------------
-- 가린 리뷰 글과 번호만 돌려준다. 회원 번호와 회원이 고른 사유는 보내지 않는다.
create function public.feedback_to_classify(p_provider text, p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'text', review)), '[]'::jsonb)
  from (
    select f.id, f.review
    from public.listing_feedback f
    where f.rating = 'bad'
      and f.review is not null
      and cardinality(f.bad_reasons) = 1
      and not exists (
        select 1 from public.feedback_classifications c
        where c.feedback_id = f.id and c.stage = 'first' and c.provider = p_provider
      )
    order by f.created_at
    limit least(greatest(p_limit, 1), 100)
  ) picked;
$$;

-- 2차 재검수: 사유를 고르지 않은 최근 7일 리뷰에서 무작위로 고른다.
create function public.feedback_second_sample(p_provider text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'text', review)), '[]'::jsonb)
  from (
    select f.id, f.review
    from public.listing_feedback f
    where f.rating = 'bad'
      and f.review is not null
      and cardinality(f.bad_reasons) = 0
      and f.created_at > now() - interval '7 days'
      and not exists (
        select 1 from public.feedback_classifications c
        where c.feedback_id = f.id and c.stage = 'second' and c.provider = p_provider
      )
    order by random()
    limit public.pipeline_setting('feedback.second_check_weekly')::integer
  ) picked;
$$;

-- 6. 분류 결과 기록: 비교는 코드(DB)가 한다 ------------------------------------------
-- p_items: [{ "id": 리뷰 번호, "reason": AI 분류, "other_reason": 두 번째 AI 분류(2차만) }]
create function public.feedback_record(
  p_stage text,
  p_provider text,
  p_model text,
  p_is_test boolean,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved integer;
begin
  if p_stage not in ('first', 'second') then
    raise exception '잘못된 단계입니다: %', p_stage;
  end if;

  insert into public.feedback_classifications
    (feedback_id, stage, provider, model, ai_reason, compared_with, matched, is_test)
  select f.id, p_stage, p_provider, p_model, item ->> 'reason',
         case when p_stage = 'first' then f.bad_reasons[1] else item ->> 'other_reason' end,
         case when p_stage = 'first' then f.bad_reasons[1] = item ->> 'reason'
              else item ->> 'other_reason' = item ->> 'reason' end,
         p_is_test
  from jsonb_array_elements(p_items) as item
  join public.listing_feedback f on f.id = (item ->> 'id')::uuid
  where (p_stage = 'first' and cardinality(f.bad_reasons) = 1)
     or (p_stage = 'second' and item ->> 'other_reason' is not null)
  on conflict (feedback_id, stage, provider) do nothing;

  get diagnostics saved = row_count;
  return saved;
end;
$$;

-- 7. 주간 리포트와 보정안 ---------------------------------------------------------
create function public.feedback_check_summary(p_stage text, p_include_test boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  total integer;
  matched_count integer;
  rate numeric;
  min_samples integer := public.pipeline_setting('feedback.check_min_samples')::integer;
  pass_pct numeric := public.pipeline_setting('feedback.check_pass_pct');
  verdict text;
  examples jsonb := '[]'::jsonb;
begin
  select count(*), count(*) filter (where matched)
  into total, matched_count
  from public.feedback_classifications
  where stage = p_stage
    and created_at > now() - interval '7 days'
    and (p_include_test or not is_test);

  rate := case when total = 0 then null else round(matched_count * 100.0 / total, 1) end;
  verdict := case when total < min_samples then 'pending'
                  when rate >= pass_pct then 'pass'
                  else 'fail' end;

  -- 통과하지 못했을 때만 틀린 사례 5건의 번호를 남긴다. 글은 관리자 화면에서 그때그때 불러온다(사본을 남기지 않음).
  if verdict = 'fail' then
    select coalesce(jsonb_agg(row_to_json(wrong)), '[]'::jsonb) into examples
    from (
      select c.feedback_id, c.compared_with, c.ai_reason
      from public.feedback_classifications c
      where c.stage = p_stage and not c.matched
        and c.created_at > now() - interval '7 days'
        and (p_include_test or not c.is_test)
      order by c.created_at desc
      limit 5
    ) wrong;
  end if;

  return jsonb_build_object(
    'total', total, 'matched', matched_count, 'rate', rate,
    'status', verdict, 'min_samples', min_samples, 'pass_pct', pass_pct,
    'wrong_examples', examples
  );
end;
$$;

create function public.feedback_weekly_report(p_include_test boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_id bigint := (select id from public.scoring_versions where status = 'active' limit 1);
  min_bad integer := public.pipeline_setting('feedback.min_bad_samples')::integer;
  min_users integer := public.pipeline_setting('feedback.min_users')::integer;
  per_user integer := public.pipeline_setting('feedback.max_per_user')::integer;
  small_below integer := public.pipeline_setting('feedback.small_sample_below')::integer;
  threshold numeric := public.pipeline_setting('feedback.proposal_min_reason_pct');
  category record;
  window_start timestamptz;
  stats record;
  reasons jsonb;
  groups jsonb;
  top_group text;
  top_count integer;
  top_pct numeric;
  ready boolean;
  proposal_id uuid;
  proof jsonb;
  categories jsonb := '[]'::jsonb;
  proposals jsonb := '[]'::jsonb;
  first_check jsonb := public.feedback_check_summary('first', p_include_test);
  second_check jsonb := public.feedback_check_summary('second', p_include_test);
begin
  for category in select id, name from public.business_categories order by display_order, id loop
    -- 반려된 보정안이 있으면 반려 이후의 평가로만 다시 센다.
    select coalesce(max(reviewed_at), '-infinity'::timestamptz) into window_start
    from public.weight_proposals
    where category_id = category.id
      and scoring_version_id is not distinct from version_id
      and status = 'rejected';

    with in_version as (
      select f.* from public.listing_feedback f
      where f.category_id = category.id
        and f.scoring_version_id is not distinct from version_id
    ), samples as (
      select * from (
        select f.*, row_number() over (
          partition by coalesce(f.user_id::text, f.id::text) order by f.created_at desc
        ) as person_rank
        from in_version f
        where f.rating = 'bad' and cardinality(f.bad_reasons) > 0 and f.created_at > window_start
      ) ranked
      where person_rank <= per_user
    )
    select
      (select count(*) from in_version) as total,
      (select count(*) from in_version where rating = 'good') as good,
      (select count(*) from in_version where rating = 'bad') as bad,
      (select count(*) from samples) as sample_count,
      (select count(distinct coalesce(user_id::text, id::text)) from samples) as user_count,
      (select count(*) from public.listing_feedback f
        where f.category_id = category.id and f.created_at > now() - interval '30 days') as monthly,
      (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
        from (select unnest(bad_reasons) as reason, count(*) as n from samples group by 1) r) as reason_counts
    into stats;

    reasons := stats.reason_counts;
    groups := jsonb_build_object(
      'cost', coalesce((reasons ->> 'rent_terms')::integer, 0),
      'space', coalesce((reasons ->> 'space')::integer, 0),
      'location', coalesce((reasons ->> 'location')::integer, 0),
      'fit', coalesce((reasons ->> 'entry')::integer, 0)
    );

    select key, value::integer into top_group, top_count
    from jsonb_each_text(groups)
    order by value::integer desc, key
    limit 1;

    top_pct := case when stats.sample_count = 0 then null
                    else round(top_count * 100.0 / stats.sample_count, 1) end;
    ready := stats.sample_count >= min_bad and stats.user_count >= min_users;

    proof := jsonb_build_object(
      'samples', stats.sample_count, 'users', stats.user_count,
      'top_group', top_group, 'top_pct', top_pct,
      'reason_counts', reasons, 'group_counts', groups,
      'good_ratio', case when stats.total = 0 then null
                         else round(stats.good * 100.0 / stats.total, 1) end
    );

    proposal_id := null;
    if ready and threshold is not null and top_count > 0 and top_pct >= threshold then
      update public.weight_proposals
      set evidence = proof,
          target_group = top_group,
          small_sample = stats.sample_count < small_below,
          updated_at = now()
      where category_id = category.id
        and scoring_version_id is not distinct from version_id
        and status = 'pending'
      returning id into proposal_id;

      if proposal_id is null then
        insert into public.weight_proposals
          (category_id, scoring_version_id, target_group, evidence, small_sample)
        values (category.id, version_id, top_group, proof, stats.sample_count < small_below)
        returning id into proposal_id;
      end if;

      proposals := proposals || jsonb_build_object(
        'id', proposal_id, 'category', category.name, 'target_group', top_group
      );
    end if;

    categories := categories || jsonb_build_object(
      'category_id', category.id,
      'category', category.name,
      'total', stats.total,
      'good', stats.good,
      'bad', stats.bad,
      'good_ratio', proof -> 'good_ratio',
      'monthly', stats.monthly,
      'reason_counts', reasons,
      'group_counts', groups,
      'info_error', coalesce((reasons ->> 'info_error')::integer, 0),
      'other', coalesce((reasons ->> 'other')::integer, 0),
      'progress', jsonb_build_object(
        'samples', stats.sample_count, 'min_samples', min_bad,
        'users', stats.user_count, 'min_users', min_users
      ),
      'ready', ready,
      'proposal_id', proposal_id
    );
  end loop;

  return jsonb_build_object(
    'scoring_version_id', version_id,
    'threshold_set', threshold is not null,
    'categories', categories,
    'uncategorized', (
      select jsonb_build_object('total', count(*), 'good', count(*) filter (where rating = 'good'))
      from public.listing_feedback
      where category_id is null and scoring_version_id is not distinct from version_id
    ),
    'checks', jsonb_build_object('first', first_check, 'second', second_check),
    'proposals', proposals,
    'alert', first_check ->> 'status' = 'fail' or second_check ->> 'status' = 'fail'
  );
end;
$$;

-- 8. 함수 실행 권한: 서버의 서비스 키로만 실행한다. ------------------------------------
revoke all on function public.weekly_start_run() from public, anon, authenticated;
revoke all on function public.feedback_to_classify(text, integer) from public, anon, authenticated;
revoke all on function public.feedback_second_sample(text) from public, anon, authenticated;
revoke all on function public.feedback_record(text, text, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.feedback_check_summary(text, boolean) from public, anon, authenticated;
revoke all on function public.feedback_weekly_report(boolean) from public, anon, authenticated;

grant execute on function public.weekly_start_run() to service_role;
grant execute on function public.feedback_to_classify(text, integer) to service_role;
grant execute on function public.feedback_second_sample(text) to service_role;
grant execute on function public.feedback_record(text, text, text, boolean, jsonb) to service_role;
grant execute on function public.feedback_weekly_report(boolean) to service_role;
