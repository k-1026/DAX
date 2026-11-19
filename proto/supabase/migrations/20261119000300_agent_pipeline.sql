-- 4단계 A: 매물 표, 실행 기록, 3일 갱신 파이프라인
-- 근거: 앱 개발/01_에이전트_AI서비스_제안.md, 앱 개발/03_데이터_설계서.md
-- 되돌리기: supabase/rollback/20261119000300_agent_pipeline_rollback.sql
-- 매물 항목(listing_data)은 첫 수집 후 확정한다. 지금 쓰는 칸 이름은 임시 형식이다.

-- 1. 기준값 -------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('pipeline.max_count_change_pct', '30', '수집 건수 변화 허용 범위 (%)'),
  ('pipeline.max_missing_pct',      '10', '필수 항목 누락 허용 비율 (%)'),
  ('pipeline.long_posting_days',    '60', '장기 게시 기준 (일)'),
  ('pipeline.price_outlier_pct',    '50', '같은 동·층 중앙값보다 저렴한 기준 (%)');

-- 2. 수집 회차와 매물 -----------------------------------------------------------
create table public.ingest_batches (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,
  row_count       integer not null,
  previous_count  integer,
  change_rate     numeric,
  missing_rate    numeric,
  quality_status  text not null default 'pending'
                  check (quality_status in ('pending', 'passed', 'held', 'approved', 'rejected')),
  payload         jsonb,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  uploaded_at     timestamptz not null default now()
);

create table public.listings (
  id                uuid primary key default gen_random_uuid(),
  source            text not null,
  source_listing_id text not null,
  listing_data      jsonb not null default '{}',
  identity_key      text,
  score_inputs      jsonb,
  status            text not null default 'active'
                    check (status in ('active', 'gone', 'sold_out')),
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  last_checked_at   timestamptz not null default now(),
  gone_at           timestamptz,
  public_at         timestamptz not null default now(),
  content_hash      text not null,
  unique (source, source_listing_id)
);

create index listings_status_idx on public.listings (status);
create index listings_identity_key_idx on public.listings (identity_key);

create table public.listing_versions (
  id             bigint generated always as identity primary key,
  listing_id     uuid not null references public.listings (id) on delete cascade,
  batch_id       uuid references public.ingest_batches (id) on delete set null,
  change_type    text not null check (change_type in ('new', 'changed', 'gone', 'relisted')),
  changed_fields jsonb,
  created_at     timestamptz not null default now()
);

create index listing_versions_listing_id_idx on public.listing_versions (listing_id);

create table public.listing_flags (
  id         bigint generated always as identity primary key,
  listing_id uuid not null references public.listings (id) on delete cascade,
  signal     text not null check (
               signal in ('duplicate', 'long_posting', 'relisted', 'price_outlier', 'use_mismatch')
             ),
  reason     text not null,
  flagged_at timestamptz not null default now(),
  cleared_at timestamptz,
  reappeared_within_30d boolean,
  evaluated_at timestamptz
);

create unique index listing_flags_one_active
  on public.listing_flags (listing_id, signal)
  where cleared_at is null;

-- 3. 스코어링 빈 자리. 방식이 정해지면 값을 채운다. ----------------------------------
create table public.business_categories (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  display_order integer not null default 0,
  is_active     boolean not null default true
);

create table public.scoring_versions (
  id          bigint generated always as identity primary key,
  version     text not null unique,
  engine_name text not null,
  config      jsonb not null default '{}',
  status      text not null default 'shadow'
              check (status in ('shadow', 'active', 'retired', 'rejected')),
  reason      text,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at  timestamptz not null default now()
);

create unique index scoring_versions_one_active
  on public.scoring_versions ((status))
  where status = 'active';

create table public.listing_scores (
  listing_id       uuid not null references public.listings (id) on delete cascade,
  category_id      bigint not null references public.business_categories (id) on delete cascade,
  version_id       bigint not null references public.scoring_versions (id) on delete cascade,
  total_score      numeric,
  rank_in_category integer,
  score_detail     jsonb not null default '{}',
  primary key (listing_id, category_id, version_id)
);

-- 4. 실행 기록 ----------------------------------------------------------------
create table public.agent_runs (
  id          uuid primary key default gen_random_uuid(),
  run_type    text not null check (run_type in ('refresh', 'weekly')),
  status      text not null default 'running'
              check (status in ('running', 'succeeded', 'failed', 'held', 'rejected')),
  batch_id    uuid references public.ingest_batches (id) on delete set null,
  summary     jsonb,
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- 같은 종류의 실행은 동시에 하나만 돌린다.
create unique index agent_runs_one_running
  on public.agent_runs (run_type)
  where status = 'running';

create table public.agent_steps (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.agent_runs (id) on delete cascade,
  step_key    text not null,
  step_order  integer not null,
  status      text not null default 'pending'
              check (status in ('pending', 'running', 'succeeded', 'skipped', 'held', 'failed')),
  attempts    integer not null default 0,
  result      jsonb,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  unique (run_id, step_key)
);

create table public.agent_events (
  id         bigint generated always as identity primary key,
  step_id    uuid not null references public.agent_steps (id) on delete cascade,
  level      text not null check (level in ('info', 'warn', 'error')),
  message    text not null,
  created_at timestamptz not null default now()
);

-- 5. 권한: 일반 사용자는 이 표들을 직접 읽거나 쓸 수 없다. -----------------------------
do $grants$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ingest_batches', 'listings', 'listing_versions', 'listing_flags',
    'business_categories', 'scoring_versions', 'listing_scores',
    'agent_runs', 'agent_steps', 'agent_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format(
      'create policy "관리자만 조회" on public.%I for select to authenticated using ((select public.is_admin()))',
      table_name
    );
    if table_name <> 'ingest_batches' then
      execute format('grant select on public.%I to authenticated', table_name);
    end if;
  end loop;
end;
$grants$;

-- 수집 원본(payload)은 관리자 화면에도 내려보내지 않는다.
grant select (
  id, source, row_count, previous_count, change_rate, missing_rate,
  quality_status, reviewed_by, reviewed_at, uploaded_at
) on public.ingest_batches to authenticated;

-- 6. 보조 함수 ----------------------------------------------------------------
create function public.pipeline_num(value text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when value ~ '^-?[0-9]+([.][0-9]+)?$' then value::numeric end;
$$;

create function public.pipeline_setting(setting_key text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select (value #>> '{}')::numeric from public.app_settings where key = setting_key;
$$;

-- 같은 장소를 찾는 값. 좌표가 없으면 판단하지 않는다. 기준은 첫 수집 후 확정한다.
create function public.pipeline_identity_key(item jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when public.pipeline_num(item ->> 'lat') is null
      or public.pipeline_num(item ->> 'lng') is null then null
    else concat_ws(
      '|', item ->> 'gu', item ->> 'dong', item ->> 'floor', item ->> 'area_m2',
      round(public.pipeline_num(item ->> 'lat'), 4),
      round(public.pipeline_num(item ->> 'lng'), 4)
    )
  end;
$$;

-- 7. 실행 시작과 단계 기록 --------------------------------------------------------
create function public.pipeline_start_run(p_source text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_batch uuid;
  new_run uuid;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '매물 목록이 비어 있습니다.';
  end if;

  insert into public.ingest_batches (source, row_count, payload)
  values (p_source, jsonb_array_length(p_items), p_items)
  returning id into new_batch;

  insert into public.agent_runs (run_type, batch_id)
  values ('refresh', new_batch)
  returning id into new_run;

  insert into public.agent_steps (run_id, step_key, step_order)
  select new_run, step_key, step_order
  from unnest(array['quality_check', 'diff', 'validate', 'score'])
       with ordinality as steps (step_key, step_order);

  return new_run;
end;
$$;

create function public.pipeline_step_begin(p_run uuid, p_step text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  step_status text;
begin
  select status into step_status
  from public.agent_steps
  where run_id = p_run and step_key = p_step
  for update;

  if not found then
    raise exception '없는 단계입니다: %', p_step;
  end if;
  -- 이미 성공한 단계는 다시 실행하지 않는다.
  if step_status in ('succeeded', 'skipped') then
    return false;
  end if;

  update public.agent_runs
  set status = 'running', error = null, finished_at = null
  where id = p_run;

  update public.agent_steps
  set status = 'running', attempts = attempts + 1, started_at = now(), error = null
  where run_id = p_run and step_key = p_step;

  return true;
end;
$$;

create function public.pipeline_step_finish(
  p_run uuid,
  p_step text,
  p_status text,
  p_result jsonb default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_step uuid;
begin
  if p_status not in ('succeeded', 'skipped', 'held', 'failed', 'retry') then
    raise exception '잘못된 단계 상태입니다: %', p_status;
  end if;

  update public.agent_steps
  set status = case p_status when 'retry' then 'pending' else p_status end,
      result = p_result,
      error = p_error,
      finished_at = now()
  where run_id = p_run and step_key = p_step
  returning id into target_step;

  insert into public.agent_events (step_id, level, message)
  values (
    target_step,
    case when p_status in ('failed', 'retry') then 'error'
         when p_status = 'held' then 'warn'
         else 'info' end,
    concat_ws(': ', p_step || ' ' || p_status, p_error)
  );

  if p_status = 'failed' then
    update public.agent_runs
    set status = 'failed', error = p_error, finished_at = now()
    where id = p_run;
  elsif p_status = 'held' then
    update public.agent_runs
    set status = 'held', finished_at = now()
    where id = p_run;
  elsif p_status <> 'retry' and not exists (
    select 1 from public.agent_steps
    where run_id = p_run and status not in ('succeeded', 'skipped')
  ) then
    update public.agent_runs r
    set status = 'succeeded',
        finished_at = now(),
        summary = (
          select jsonb_object_agg(step_key, result)
          from public.agent_steps
          where run_id = p_run
        )
    where r.id = p_run;

    -- 처리가 끝난 수집 원본은 DB에 남기지 않는다.
    update public.ingest_batches b
    set payload = null
    from public.agent_runs r
    where r.id = p_run and b.id = r.batch_id;
  end if;
end;
$$;

-- 8. 수집 품질 검사 ------------------------------------------------------------
create function public.pipeline_quality_check(p_run uuid, p_required text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.ingest_batches%rowtype;
  previous integer;
  change_pct numeric;
  missing_pct numeric;
  verdict text;
begin
  select b.* into batch
  from public.ingest_batches b
  join public.agent_runs r on r.batch_id = b.id
  where r.id = p_run;

  select row_count into previous
  from public.ingest_batches
  where source = batch.source
    and id <> batch.id
    and quality_status in ('passed', 'approved')
  order by uploaded_at desc
  limit 1;

  if previous is not null and previous > 0 then
    change_pct := round(abs(batch.row_count - previous) * 100.0 / previous, 1);
  end if;

  select round(
    count(*) filter (
      where exists (
        select 1 from unnest(p_required) as field
        where coalesce(item ->> field, '') = ''
      )
    ) * 100.0 / count(*), 1
  ) into missing_pct
  from jsonb_array_elements(batch.payload) as item;

  verdict := case
    when change_pct >= public.pipeline_setting('pipeline.max_count_change_pct') then 'held'
    when missing_pct >= public.pipeline_setting('pipeline.max_missing_pct') then 'held'
    else 'passed'
  end;

  update public.ingest_batches
  set previous_count = previous,
      change_rate = change_pct,
      missing_rate = missing_pct,
      quality_status = verdict
  where id = batch.id;

  return jsonb_build_object(
    'status', verdict, 'row_count', batch.row_count, 'previous_count', previous,
    'change_pct', change_pct, 'missing_pct', missing_pct
  );
end;
$$;

-- 보류된 수집을 관리자가 승인하거나 반려한다.
create function public.pipeline_review_batch(p_batch uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run uuid;
begin
  if not public.is_admin() then
    raise exception '관리자만 처리할 수 있습니다.' using errcode = '42501';
  end if;

  update public.ingest_batches
  set quality_status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      payload = case when p_approve then payload end
  where id = p_batch and quality_status = 'held';

  if not found then
    raise exception '보류 상태인 수집만 처리할 수 있습니다.';
  end if;

  select id into target_run from public.agent_runs where batch_id = p_batch;

  if p_approve then
    update public.agent_steps
    set status = 'succeeded', finished_at = now()
    where run_id = target_run and step_key = 'quality_check';
  else
    update public.agent_runs
    set status = 'rejected', finished_at = now()
    where id = target_run;
  end if;
end;
$$;

-- 9. 변화 비교: 신규, 변경, 나감, 재등록 ---------------------------------------------
create function public.pipeline_diff(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.ingest_batches%rowtype;
  item jsonb;
  sid text;
  next_status text;
  next_hash text;
  next_key text;
  current_row public.listings%rowtype;
  new_id uuid;
  fields jsonb;
  seen text[] := '{}';
  new_count integer := 0;
  changed_count integer := 0;
  relisted_count integer := 0;
  same_count integer := 0;
  gone_count integer := 0;
begin
  select b.* into batch
  from public.ingest_batches b
  join public.agent_runs r on r.batch_id = b.id
  where r.id = p_run;

  for item in select value from jsonb_array_elements(batch.payload) loop
    sid := item ->> 'id';
    continue when coalesce(sid, '') = '' or sid = any (seen);
    seen := array_append(seen, sid);

    next_status := case when item ->> 'status' = 'sold_out' then 'sold_out' else 'active' end;
    next_hash := md5(item::text);
    next_key := public.pipeline_identity_key(item);

    select * into current_row
    from public.listings
    where source = batch.source and source_listing_id = sid
    for update;

    if not found then
      insert into public.listings (source, source_listing_id, listing_data, identity_key, status, content_hash)
      values (batch.source, sid, item, next_key, next_status, next_hash)
      returning id into new_id;

      if next_key is not null and exists (
        select 1 from public.listings
        where identity_key = next_key and status = 'gone' and id <> new_id
      ) then
        insert into public.listing_versions (listing_id, batch_id, change_type)
        values (new_id, batch.id, 'relisted');
        relisted_count := relisted_count + 1;
      else
        insert into public.listing_versions (listing_id, batch_id, change_type)
        values (new_id, batch.id, 'new');
        new_count := new_count + 1;
      end if;
    elsif current_row.status = 'gone' then
      update public.listings
      set listing_data = item, identity_key = next_key, status = next_status,
          content_hash = next_hash, gone_at = null,
          last_seen_at = now(), last_checked_at = now()
      where id = current_row.id;

      insert into public.listing_versions (listing_id, batch_id, change_type)
      values (current_row.id, batch.id, 'relisted');
      relisted_count := relisted_count + 1;
    elsif current_row.content_hash <> next_hash then
      select jsonb_object_agg(
        field,
        jsonb_build_object('before', current_row.listing_data -> field, 'after', item -> field)
      ) into fields
      from (
        select jsonb_object_keys(current_row.listing_data) as field
        union
        select jsonb_object_keys(item)
      ) as keys
      where current_row.listing_data -> field is distinct from item -> field;

      update public.listings
      set listing_data = item, identity_key = next_key, status = next_status,
          content_hash = next_hash, last_seen_at = now(), last_checked_at = now()
      where id = current_row.id;

      insert into public.listing_versions (listing_id, batch_id, change_type, changed_fields)
      values (current_row.id, batch.id, 'changed', fields);
      changed_count := changed_count + 1;
    else
      update public.listings
      set last_seen_at = now(), last_checked_at = now()
      where id = current_row.id;
      same_count := same_count + 1;
    end if;
  end loop;

  with departed as (
    update public.listings
    set status = 'gone', gone_at = now(), last_checked_at = now()
    where source = batch.source
      and status <> 'gone'
      and not (source_listing_id = any (seen))
    returning id
  ), recorded as (
    insert into public.listing_versions (listing_id, batch_id, change_type)
    select id, batch.id, 'gone' from departed
    returning 1
  )
  select count(*) into gone_count from recorded;

  return jsonb_build_object(
    'new', new_count, 'changed', changed_count, 'relisted', relisted_count,
    'unchanged', same_count, 'gone', gone_count
  );
end;
$$;

-- 10. 검증: 확인이 필요한 매물 표시. 허위라고 단정하지 않는다. ----------------------------
create function public.pipeline_validate(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  long_days numeric := public.pipeline_setting('pipeline.long_posting_days');
  outlier_pct numeric := public.pipeline_setting('pipeline.price_outlier_pct');
  counts jsonb;
begin
  create temporary table pipeline_wanted (
    listing_id uuid, signal text, reason text
  ) on commit drop;

  insert into pg_temp.pipeline_wanted
  select l.id, 'duplicate',
         format('같은 장소로 보이는 매물이 %s건 있어 확인이 필요합니다.', d.total)
  from public.listings l
  join (
    select identity_key, count(*) as total
    from public.listings
    where status = 'active' and identity_key is not null
    group by identity_key
    having count(*) > 1
  ) d on d.identity_key = l.identity_key
  where l.status = 'active';

  insert into pg_temp.pipeline_wanted
  select id, 'long_posting',
         format('게시된 지 %s일이 지나 현재 공실인지 확인이 필요합니다.', days)
  from (
    select id, current_date - case
      when listing_data ->> 'posted_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then (listing_data ->> 'posted_at')::date
      else first_seen_at::date
    end as days
    from public.listings
    where status = 'active'
  ) posted
  where days >= long_days;

  insert into pg_temp.pipeline_wanted
  select l.id, 'relisted', '같은 장소의 매물이 여러 번 다시 등록되어 확인이 필요합니다.'
  from public.listings l
  where l.status = 'active'
    and (
      select count(*)
      from public.listing_versions v
      join public.listings other on other.id = v.listing_id
      where v.change_type = 'relisted'
        and (other.id = l.id or (l.identity_key is not null and other.identity_key = l.identity_key))
    ) >= 2;

  insert into pg_temp.pipeline_wanted
  select b.id, 'price_outlier',
         format('같은 동·층 매물 중앙값보다 %s%% 저렴해 조건 확인이 필요합니다.',
                round((1 - b.unit_price / m.middle) * 100))
  from (
    select id, listing_data ->> 'dong' as dong, listing_data ->> 'floor' as floor,
           public.pipeline_num(listing_data ->> 'rent') / public.pipeline_num(listing_data ->> 'area_m2') as unit_price
    from public.listings
    where status = 'active' and public.pipeline_num(listing_data ->> 'area_m2') > 0
  ) b
  join (
    select listing_data ->> 'dong' as dong, listing_data ->> 'floor' as floor,
           percentile_cont(0.5) within group (
             order by (public.pipeline_num(listing_data ->> 'rent') / public.pipeline_num(listing_data ->> 'area_m2'))::double precision
           )::numeric as middle
    from public.listings
    where status = 'active' and public.pipeline_num(listing_data ->> 'area_m2') > 0
    group by 1, 2
    having count(*) >= 3
  ) m on m.dong = b.dong and m.floor = b.floor
  where b.unit_price <= m.middle * (1 - outlier_pct / 100);

  insert into pg_temp.pipeline_wanted
  select id, 'use_mismatch',
         format('건축물 용도가 %s(으)로 표시되어 입점 가능 여부 확인이 필요합니다.', listing_data ->> 'building_use_class')
  from public.listings
  where status = 'active'
    and listing_data ->> 'building_use_class' in ('단독주택', '공동주택');

  update public.listing_flags f
  set cleared_at = now()
  where f.cleared_at is null
    and not exists (
      select 1 from pg_temp.pipeline_wanted w
      where w.listing_id = f.listing_id and w.signal = f.signal
    );

  insert into public.listing_flags (listing_id, signal, reason)
  select listing_id, signal, reason from pg_temp.pipeline_wanted
  on conflict (listing_id, signal) where cleared_at is null
  do update set reason = excluded.reason;

  select coalesce(jsonb_object_agg(signal, total), '{}') into counts
  from (select signal, count(*) as total from pg_temp.pipeline_wanted group by signal) s;

  drop table pg_temp.pipeline_wanted;
  return counts;
end;
$$;

-- 11. 스코어링 빈 자리: 방식이 정해지면 이 함수의 내용을 교체한다. -------------------------
create function public.pipeline_score(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object('skipped', true, 'reason', '스코어링 방식 미정');
end;
$$;

-- 12. 함수 실행 권한: 서버의 서비스 키로만 실행한다. -----------------------------------
revoke all on function public.pipeline_num(text) from public, anon, authenticated;
revoke all on function public.pipeline_setting(text) from public, anon, authenticated;
revoke all on function public.pipeline_identity_key(jsonb) from public, anon, authenticated;
revoke all on function public.pipeline_start_run(text, jsonb) from public, anon, authenticated;
revoke all on function public.pipeline_step_begin(uuid, text) from public, anon, authenticated;
revoke all on function public.pipeline_step_finish(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.pipeline_quality_check(uuid, text[]) from public, anon, authenticated;
revoke all on function public.pipeline_diff(uuid) from public, anon, authenticated;
revoke all on function public.pipeline_validate(uuid) from public, anon, authenticated;
revoke all on function public.pipeline_score(uuid) from public, anon, authenticated;

grant execute on function public.pipeline_start_run(text, jsonb) to service_role;
grant execute on function public.pipeline_step_begin(uuid, text) to service_role;
grant execute on function public.pipeline_step_finish(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.pipeline_quality_check(uuid, text[]) to service_role;
grant execute on function public.pipeline_diff(uuid) to service_role;
grant execute on function public.pipeline_validate(uuid) to service_role;
grant execute on function public.pipeline_score(uuid) to service_role;

revoke all on function public.pipeline_review_batch(uuid, boolean) from public, anon;
grant execute on function public.pipeline_review_batch(uuid, boolean) to authenticated;
