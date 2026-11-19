-- 6단계 준비: 수집일 기록, 매물 특징 글의 전화번호 가리기
-- 근거: 앱 개발/대화로그.md 턴 115~118 (11월 5일 자료는 수집일로 표시, 특징 글 전화번호 가림)
-- 되돌리기: supabase/rollback/20261119001000_collection_rollback.sql

-- 1. 수집 회차에 실제 수집 시각을 남긴다. 업로드 시각과 다를 수 있다(예: 11월 5일 수집 자료를 오늘 올림).
alter table public.ingest_batches add column collected_at timestamptz not null default now();

-- 2. 수집 시작: 수집 시각을 받고, 특징 글(features)의 전화번호·이메일을 가린 뒤 저장한다.
drop function public.pipeline_start_run(text, jsonb);

create function public.pipeline_start_run(p_source text, p_items jsonb, p_collected_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_batch uuid;
  new_run uuid;
  collected timestamptz := coalesce(p_collected_at, now());
  cleaned jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '매물 목록이 비어 있습니다.';
  end if;
  if collected > now() + interval '1 hour' or collected < now() - interval '30 days' then
    raise exception '수집 시각이 올바르지 않습니다(30일 이내여야 합니다).';
  end if;

  select jsonb_agg(
    case when jsonb_typeof(item -> 'features') = 'string'
         then jsonb_set(item, '{features}', to_jsonb(public.mask_personal_text(item ->> 'features') ->> 'text'))
         else item end
  ) into cleaned
  from jsonb_array_elements(p_items) as item;

  insert into public.ingest_batches (source, row_count, payload, collected_at)
  values (p_source, jsonb_array_length(cleaned), cleaned, collected)
  returning id into new_batch;

  insert into public.agent_runs (run_type, batch_id)
  values ('refresh', new_batch)
  returning id into new_run;

  insert into public.agent_steps (run_id, step_key, step_order)
  select new_run, step_key, step_order
  from unnest(array['quality_check', 'diff', 'validate', 'score', 'mail'])
       with ordinality as steps (step_key, step_order);

  return new_run;
end;
$$;

revoke all on function public.pipeline_start_run(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.pipeline_start_run(text, jsonb, timestamptz) to service_role;

-- 3. 변화 비교: 확인 시각을 업로드 시각이 아니라 수집 시각으로 기록한다.
create or replace function public.pipeline_diff(p_run uuid)
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
      insert into public.listings (source, source_listing_id, listing_data, identity_key, status, content_hash,
                                   first_seen_at, last_seen_at, last_checked_at)
      values (batch.source, sid, item, next_key, next_status, next_hash,
              batch.collected_at, batch.collected_at, batch.collected_at)
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
          last_seen_at = batch.collected_at, last_checked_at = batch.collected_at
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
          content_hash = next_hash, last_seen_at = batch.collected_at, last_checked_at = batch.collected_at
      where id = current_row.id;

      insert into public.listing_versions (listing_id, batch_id, change_type, changed_fields)
      values (current_row.id, batch.id, 'changed', fields);
      changed_count := changed_count + 1;
    else
      update public.listings
      set last_seen_at = batch.collected_at, last_checked_at = batch.collected_at
      where id = current_row.id;
      same_count := same_count + 1;
    end if;
  end loop;

  with departed as (
    update public.listings
    set status = 'gone', gone_at = batch.collected_at, last_checked_at = batch.collected_at
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
