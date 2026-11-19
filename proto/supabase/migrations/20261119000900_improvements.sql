-- 4단계 B: 개선 제안 (품질 주의 항목·리뷰 반복 요청 → 개선 후보, 긴급 리뷰 표시)
-- 근거: 앱 개발/01_에이전트_AI서비스_제안.md A-2-2, A-2-6
-- 되돌리기: supabase/rollback/20261119000900_improvements_rollback.sql

-- 1. 기준값 -------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('improvement.window_days',          '30', '리뷰 요청을 세는 기간 (일)'),
  ('improvement.min_users',            '5',  '개선 후보 등록 최소 사용자 수'),
  ('improvement.reject_cooldown_days', '30', '반려 후 다시 올리지 않는 기간 (일)');

-- 2. 긴급 리뷰 표시 ---------------------------------------------------------------
-- 서비스 관련 표현 묶음으로 찾는다. 매물 이야기("정보 오류", "보증금 환불")는 제외한다.
create function public.improvement_urgent_kind(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_text is null then null
    when p_text ~ '결제\s*(오류|에러|실패)|결제가\s*안|결제\s*안\s*(돼|되|됨)|이중\s*결제|중복\s*결제|구독료|돈이\s*(두\s*번|빠져|나갔)|(?<!보증금 )(?<!보증금)환불'
      then 'payment'
    when p_text ~ '개인\s*정보\s*(유출|노출|도용|공개)|내\s*정보(가|를)?\s*(유출|노출|공개|다른\s*사람)|정보\s*유출|해킹'
      then 'privacy'
    when p_text ~ '(사이트|앱|어플|페이지|홈페이지|서비스|서버)\s*(가|이)?\s*(오류|에러|먹통|다운|안\s*열|안\s*돼|안\s*되|멈춰|멈춤)|접속(이)?\s*안|로그인(이)?\s*안|페이지(가)?\s*안\s*(열|떠)|화면(이)?\s*(안\s*(나와|떠|열)|하얗게)|에러\s*(코드|메시지|가\s*떠|떠요)|오류\s*메시지|[45]0[0-9]\s*에러'
      then 'outage'
  end;
$$;

alter table public.listing_feedback
  add column urgent_kind text check (urgent_kind in ('payment', 'privacy', 'outage')),
  add column urgent_notified_at timestamptz;

grant select (urgent_kind, urgent_notified_at) on public.listing_feedback to authenticated;

-- 가린 글로 판단한다 (트리거 이름 순서상 listing_feedback_prepare 다음에 실행된다).
create function public.listing_feedback_urgent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.review is distinct from old.review then
    new.urgent_kind := public.improvement_urgent_kind(new.review);
    new.urgent_notified_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.listing_feedback_urgent() from public, anon, authenticated;

create trigger listing_feedback_urgent
  before insert or update of review on public.listing_feedback
  for each row execute function public.listing_feedback_urgent();

-- 3. 개선 후보 ------------------------------------------------------------------
-- source: quality(품질 주의 항목) / review(리뷰 반복 요청) / urgent(긴급 3종)
create table public.improvement_candidates (
  id             uuid primary key default gen_random_uuid(),
  source         text not null check (source in ('quality', 'review', 'urgent')),
  agent          text,
  metric_key     text,
  group_key      text,
  title          text not null,
  detail         text,
  users_count    integer not null default 0,
  evidence_count integer not null default 0,
  streak         integer not null default 0,
  urgent         boolean not null default false,
  status         text not null default 'candidate' check (status in ('candidate', 'adopted', 'held', 'rejected')),
  reason         text,
  reviewed_by    uuid references public.profiles (id) on delete set null,
  reviewed_at    timestamptz,
  -- 가짜 묶기 결과. 실제 후보에서 뺀다.
  is_test        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 같은 문제는 열려 있는(후보·보류) 것 하나만
create unique index improvement_candidates_one_open
  on public.improvement_candidates (source, agent, metric_key, group_key, is_test) nulls not distinct
  where status in ('candidate', 'held');

create table public.improvement_evidence (
  candidate_id uuid not null references public.improvement_candidates (id) on delete cascade,
  feedback_id  uuid not null references public.listing_feedback (id) on delete cascade,
  added_at     timestamptz not null default now(),
  primary key (candidate_id, feedback_id)
);

-- 리뷰가 어느 요청 묶음에 들어갔는지 (새 리뷰만 배정)
create table public.improvement_review_groups (
  feedback_id uuid not null references public.listing_feedback (id) on delete cascade,
  provider    text not null check (char_length(provider) <= 40),
  group_key   text check (char_length(group_key) <= 80),
  label       text check (char_length(label) <= 200),
  is_test     boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (feedback_id, provider)
);

-- 리뷰 글을 고치면 묶음을 다시 정한다.
create function public.improvement_clear_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.review is distinct from old.review then
    delete from public.improvement_review_groups where feedback_id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.improvement_clear_groups() from public, anon, authenticated;

create trigger listing_feedback_clear_groups
  after update of review on public.listing_feedback
  for each row execute function public.improvement_clear_groups();

-- 긴급 리뷰는 저장 즉시 후보로 올린다(주 1회를 기다리지 않음).
create function public.improvement_add_urgent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if new.urgent_kind is null or (tg_op = 'UPDATE' and new.urgent_kind is not distinct from old.urgent_kind) then
    return null;
  end if;

  select id into target
  from public.improvement_candidates
  where source = 'urgent' and group_key = new.urgent_kind and not is_test
    and status in ('candidate', 'held');

  if target is null then
    insert into public.improvement_candidates (source, group_key, title, urgent)
    values (
      'urgent', new.urgent_kind,
      case new.urgent_kind
        when 'payment' then '결제 오류 신고'
        when 'privacy' then '개인정보 문제 신고'
        else '서비스 장애 신고'
      end,
      true
    )
    returning id into target;
  end if;

  insert into public.improvement_evidence (candidate_id, feedback_id)
  values (target, new.id)
  on conflict do nothing;

  update public.improvement_candidates c
  set evidence_count = (select count(*) from public.improvement_evidence e where e.candidate_id = c.id),
      users_count = (
        select count(distinct coalesce(f.user_id::text, f.id::text))
        from public.improvement_evidence e
        join public.listing_feedback f on f.id = e.feedback_id
        where e.candidate_id = c.id
      ),
      updated_at = now()
  where c.id = target;

  return null;
end;
$$;

revoke all on function public.improvement_add_urgent() from public, anon, authenticated;

create trigger listing_feedback_add_urgent
  after insert or update of review on public.listing_feedback
  for each row execute function public.improvement_add_urgent();

-- 4. 권한: 관리자만 조회 (근거에는 회원 번호가 없다) ------------------------------------
alter table public.improvement_candidates enable row level security;
alter table public.improvement_evidence enable row level security;
alter table public.improvement_review_groups enable row level security;
revoke all on public.improvement_candidates from anon, authenticated;
revoke all on public.improvement_evidence from anon, authenticated;
revoke all on public.improvement_review_groups from anon, authenticated;
grant select on public.improvement_candidates to authenticated;
grant select on public.improvement_evidence to authenticated;
grant select on public.improvement_review_groups to authenticated;

create policy "관리자만 개선 후보 조회"
  on public.improvement_candidates for select to authenticated
  using ((select public.is_admin()));
create policy "관리자만 후보 근거 조회"
  on public.improvement_evidence for select to authenticated
  using ((select public.is_admin()));
create policy "관리자만 리뷰 묶음 조회"
  on public.improvement_review_groups for select to authenticated
  using ((select public.is_admin()));

-- 5. 리뷰 묶기 --------------------------------------------------------------------
create function public.improvement_to_group(p_provider text, p_limit integer)
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
    where f.review is not null
      and f.created_at > now() - make_interval(days => public.pipeline_setting('improvement.window_days')::integer)
      and not exists (
        select 1 from public.improvement_review_groups g
        where g.feedback_id = f.id and g.provider = p_provider
      )
    order by f.created_at
    limit least(greatest(p_limit, 1), 100)
  ) picked;
$$;

-- p_items: [{ "id": 리뷰 번호, "group": 묶음 이름(요청이 아니면 null), "label": 묶음 설명 }]
create function public.improvement_record_groups(p_provider text, p_is_test boolean, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved integer;
begin
  insert into public.improvement_review_groups (feedback_id, provider, group_key, label, is_test)
  select f.id, p_provider, nullif(item ->> 'group', ''), item ->> 'label', p_is_test
  from jsonb_array_elements(p_items) as item
  join public.listing_feedback f on f.id = (item ->> 'id')::uuid
  on conflict (feedback_id, provider) do nothing;

  get diagnostics saved = row_count;
  return saved;
end;
$$;

-- 6. 주간 후보 정리 ----------------------------------------------------------------
create function public.improvement_weekly(p_include_test boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_days integer := public.pipeline_setting('improvement.window_days')::integer;
  min_users integer := public.pipeline_setting('improvement.min_users')::integer;
  cooldown integer := public.pipeline_setting('improvement.reject_cooldown_days')::integer;
  -- 연속 조건이 있는 지표 (A-2-1: 열람률 20% 미만 2주 연속)
  required_streak jsonb := '{"mail.open_rate": 2}';
  report record;
  warning jsonb;
  grp record;
  target uuid;
  rejected_at timestamptz;
  added integer := 0;
  updated integer := 0;
begin
  -- ① 품질 주의 항목 (가장 최근 품질 리포트)
  select * into report from public.quality_reports order by created_at desc limit 1;

  if report.id is not null then
    for warning in select * from jsonb_array_elements(report.warnings) loop
      continue when (warning ->> 'streak')::integer
        < coalesce((required_streak ->> (warning ->> 'agent' || '.' || (warning ->> 'key')))::integer, 1);

      select id into target
      from public.improvement_candidates
      where source = 'quality' and agent = warning ->> 'agent' and metric_key = warning ->> 'key'
        and status in ('candidate', 'held') and not is_test;

      if target is not null then
        update public.improvement_candidates
        set detail = warning ->> 'detail', streak = (warning ->> 'streak')::integer, updated_at = now()
        where id = target;
        updated := updated + 1;
        continue;
      end if;

      select max(reviewed_at) into rejected_at
      from public.improvement_candidates
      where source = 'quality' and agent = warning ->> 'agent' and metric_key = warning ->> 'key'
        and status = 'rejected';
      continue when rejected_at > now() - make_interval(days => cooldown);

      insert into public.improvement_candidates (source, agent, metric_key, title, detail, streak)
      values ('quality', warning ->> 'agent', warning ->> 'key',
              (warning ->> 'label') || ' 주의 (기준 ' || (warning ->> 'threshold') || ')',
              warning ->> 'detail', (warning ->> 'streak')::integer);
      added := added + 1;
    end loop;
  end if;

  -- ② 리뷰 반복 요청: 최근 30일, 서로 다른 사용자 수
  for grp in
    select g.group_key, g.is_test, max(g.label) as label
    from public.improvement_review_groups g
    where g.group_key is not null and (p_include_test or not g.is_test)
    group by g.group_key, g.is_test
  loop
    select id into target
    from public.improvement_candidates
    where source = 'review' and group_key = grp.group_key and is_test = grp.is_test
      and status in ('candidate', 'held');

    select max(reviewed_at) into rejected_at
    from public.improvement_candidates
    where source = 'review' and group_key = grp.group_key and is_test = grp.is_test and status = 'rejected';

    if target is null then
      continue when rejected_at > now() - make_interval(days => cooldown);

      -- 반려 이후의 새 근거로만 센다.
      continue when (
        select count(distinct coalesce(f.user_id::text, f.id::text))
        from public.improvement_review_groups g
        join public.listing_feedback f on f.id = g.feedback_id
        where g.group_key = grp.group_key and g.is_test = grp.is_test
          and f.created_at > greatest(now() - make_interval(days => window_days), coalesce(rejected_at, '-infinity'))
      ) < min_users;

      insert into public.improvement_candidates (source, group_key, title, is_test)
      values ('review', grp.group_key, coalesce(grp.label, grp.group_key), grp.is_test)
      returning id into target;
      added := added + 1;
    else
      updated := updated + 1;
    end if;

    -- 후보·보류 모두 근거를 계속 쌓는다.
    insert into public.improvement_evidence (candidate_id, feedback_id)
    select target, g.feedback_id
    from public.improvement_review_groups g
    join public.listing_feedback f on f.id = g.feedback_id
    where g.group_key = grp.group_key and g.is_test = grp.is_test
      and f.created_at > greatest(now() - make_interval(days => window_days), coalesce(rejected_at, '-infinity'))
    on conflict do nothing;
  end loop;

  -- 사람 수는 리뷰에서 그때그때 센다 (탈퇴 회원은 1건 = 1명)
  update public.improvement_candidates c
  set evidence_count = counts.evidence, users_count = counts.users, updated_at = now()
  from (
    select e.candidate_id, count(*) as evidence,
           count(distinct coalesce(f.user_id::text, f.id::text)) as users
    from public.improvement_evidence e
    join public.listing_feedback f on f.id = e.feedback_id
    group by e.candidate_id
  ) counts
  where c.id = counts.candidate_id and c.status in ('candidate', 'held');

  return jsonb_build_object(
    'added', added,
    'updated', updated,
    'new_this_week', (
      select count(*) from public.improvement_candidates
      where created_at > now() - interval '7 days' and not is_test
    ),
    'open', (
      select count(*) from public.improvement_candidates
      where status in ('candidate', 'held') and not is_test
    ),
    'target', '주 3~5건'
  );
end;
$$;

-- 7. 긴급 알림 (5분 모니터링이 사용) --------------------------------------------------
-- 알리지 않은 긴급 리뷰의 번호와 종류만 돌려준다. 글은 돌려주지 않는다.
create function public.improvement_urgent_unnotified()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', urgent_kind) order by created_at), '[]'::jsonb)
  from public.listing_feedback
  where urgent_kind is not null and urgent_notified_at is null;
$$;

create function public.improvement_mark_urgent_notified(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.listing_feedback set urgent_notified_at = now()
  where id = any (p_ids) and urgent_notified_at is null;
$$;

-- 8. 주간 실행에 개선 제안 단계를 붙인다 ---------------------------------------------
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
  from unnest(array[
    'feedback_classify', 'feedback_second_check', 'feedback_report', 'quality_eval',
    'improvement_group', 'improvement_candidates'
  ]) with ordinality as steps (step_key, step_order);

  return new_run;
end;
$$;

-- 9. 함수 실행 권한 ---------------------------------------------------------------
revoke all on function public.improvement_urgent_kind(text) from public, anon, authenticated;
revoke all on function public.improvement_to_group(text, integer) from public, anon, authenticated;
revoke all on function public.improvement_record_groups(text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.improvement_weekly(boolean) from public, anon, authenticated;
revoke all on function public.improvement_urgent_unnotified() from public, anon, authenticated;
revoke all on function public.improvement_mark_urgent_notified(uuid[]) from public, anon, authenticated;

grant execute on function public.improvement_to_group(text, integer) to service_role;
grant execute on function public.improvement_record_groups(text, boolean, jsonb) to service_role;
grant execute on function public.improvement_weekly(boolean) to service_role;
grant execute on function public.improvement_urgent_unnotified() to service_role;
grant execute on function public.improvement_mark_urgent_notified(uuid[]) to service_role;
