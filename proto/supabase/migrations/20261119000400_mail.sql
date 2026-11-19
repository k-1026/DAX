-- 4단계 B: 선호 조건, 담기, 묶음 메일, 광고성 메일 규칙
-- 근거: 앱 개발/04_회원_동의_권한_규칙.md 8절, 앱 개발/00_근거_기능_매핑.md 3절
-- 되돌리기: supabase/rollback/20261119000400_mail_rollback.sql

-- 1. 선호 조건과 담기. 화면을 만들기 전까지 사용자는 조회만 할 수 있다. ---------------------
create table public.user_preferences (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  filters            jsonb not null default '{}',
  weight_adjustments jsonb,
  first_mail_sent_at timestamptz,
  updated_at         timestamptz not null default now()
);

create table public.saved_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null default '기본 목록',
  created_at timestamptz not null default now()
);

create index saved_lists_user_id_idx on public.saved_lists (user_id);

create table public.saved_listings (
  list_id    uuid not null references public.saved_lists (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  memo       text,
  saved_at   timestamptz not null default now(),
  primary key (list_id, listing_id)
);

-- 2. 메일 발송 기록 -------------------------------------------------------------
alter table public.user_consents add column last_reminded_at timestamptz;

create table public.email_sends (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles (id) on delete set null,
  kind            text not null check (
                    kind in ('first_recommendation', 'subscriber_batch', 'unsubscribe_result', 'consent_reminder')
                  ),
  run_id          uuid references public.agent_runs (id) on delete set null,
  to_address      text,
  subject         text not null,
  status          text not null check (
                    status in ('queued', 'deferred', 'preview', 'sent', 'failed', 'suppressed')
                  ),
  scheduled_for   timestamptz,
  payload         jsonb,
  resend_id       text,
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- 갱신 1회당 회원별 메일은 1통만 보낸다.
create unique index email_sends_one_per_run
  on public.email_sends (user_id, kind, run_id)
  where run_id is not null;

create index email_sends_user_month_idx on public.email_sends (user_id, kind, created_at);
create index email_sends_deferred_idx on public.email_sends (scheduled_for) where status = 'deferred';

create table public.email_send_items (
  send_id    uuid not null references public.email_sends (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  section    text not null check (section in ('new', 'changed', 'sold')),
  primary key (send_id, listing_id, section)
);

-- 탈퇴하면 발송 기록에서 받는 사람 주소와 메일 내용을 지운다.
create function public.clear_mail_address()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.email_sends
  set to_address = null,
      payload = null,
      status = case when status = 'deferred' then 'suppressed' else status end
  where user_id = old.id;
  return old;
end;
$$;

revoke all on function public.clear_mail_address() from public, anon, authenticated;

create trigger profiles_clear_mail_address
  before delete on public.profiles
  for each row execute function public.clear_mail_address();

-- 3. 권한 ---------------------------------------------------------------------
alter table public.user_preferences enable row level security;
alter table public.saved_lists enable row level security;
alter table public.saved_listings enable row level security;
alter table public.email_sends enable row level security;
alter table public.email_send_items enable row level security;

revoke all on public.user_preferences from anon, authenticated;
revoke all on public.saved_lists from anon, authenticated;
revoke all on public.saved_listings from anon, authenticated;
revoke all on public.email_sends from anon, authenticated;
revoke all on public.email_send_items from anon, authenticated;

grant select on public.user_preferences to authenticated;
grant select on public.saved_lists to authenticated;
grant select on public.saved_listings to authenticated;
grant select (id, user_id, kind, run_id, subject, status, scheduled_for, resend_id, error, sent_at, created_at)
  on public.email_sends to authenticated;
grant select on public.email_send_items to authenticated;

create policy "본인 선호 조건만 조회"
  on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create policy "본인 담기 목록만 조회"
  on public.saved_lists for select to authenticated
  using (user_id = (select auth.uid()));

create policy "본인 담은 매물만 조회"
  on public.saved_listings for select to authenticated
  using (exists (
    select 1 from public.saved_lists l
    where l.id = list_id and l.user_id = (select auth.uid())
  ));

create policy "관리자만 발송 기록 조회"
  on public.email_sends for select to authenticated
  using ((select public.is_admin()));

create policy "관리자만 발송 매물 조회"
  on public.email_send_items for select to authenticated
  using ((select public.is_admin()));

-- 4. 파이프라인에 메일 단계를 추가한다. --------------------------------------------
create or replace function public.pipeline_start_run(p_source text, p_items jsonb)
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
  from unnest(array['quality_check', 'diff', 'validate', 'score', 'mail'])
       with ordinality as steps (step_key, step_order);

  return new_run;
end;
$$;

-- 5. 메일 대상 찾기 --------------------------------------------------------------
-- 조건 칸은 임시 형식이다. 조건을 하나도 저장하지 않은 회원에게는 새 매물을 보내지 않는다.
create function public.mail_listing_matches(filters jsonb, item jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select filters <> '{}'::jsonb
    and (not filters ? 'gu' or filters -> 'gu' ? (item ->> 'gu'))
    and (not filters ? 'dong' or filters -> 'dong' ? (item ->> 'dong'))
    and (not filters ? 'rent_max'
         or public.pipeline_num(item ->> 'rent') <= public.pipeline_num(filters ->> 'rent_max'))
    and (not filters ? 'deposit_max'
         or public.pipeline_num(item ->> 'deposit') <= public.pipeline_num(filters ->> 'deposit_max'))
    and (not filters ? 'area_min'
         or public.pipeline_num(item ->> 'area_m2') >= public.pipeline_num(filters ->> 'area_min'))
    and (not filters ? 'area_max'
         or public.pipeline_num(item ->> 'area_m2') <= public.pipeline_num(filters ->> 'area_max'));
$$;

create function public.mail_month_used(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.email_sends
  where user_id = p_user
    and kind = 'subscriber_batch'
    and status in ('queued', 'deferred', 'preview', 'sent')
    and date_trunc('month', created_at at time zone 'Asia/Seoul')
        = date_trunc('month', now() at time zone 'Asia/Seoul');
$$;

-- 갱신 1회에서 구독 회원별로 보낼 내용을 모은다.
create function public.mail_collect_batch(p_run uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with batch as (
    select batch_id from public.agent_runs where id = p_run
  ), changes as (
    select v.listing_id, v.change_type, v.changed_fields, l.status, l.listing_data
    from public.listing_versions v
    join public.listings l on l.id = v.listing_id
    where v.batch_id = (select batch_id from batch)
  ), recipients as (
    select p.id, p.contact_email, coalesce(pref.filters, '{}'::jsonb) as filters,
           public.mail_month_used(p.id) as used,
           public.pipeline_setting('subscriber.mail_monthly_limit')::integer as month_limit
    from public.profiles p
    left join public.user_preferences pref on pref.user_id = p.id
    where p.deleted_at is null
      and p.contact_email is not null
      and exists (
        select 1 from public.subscriptions s
        where s.user_id = p.id
          and (
            (s.status in ('active', 'canceled') and s.current_period_end > now())
            or (s.status = 'past_due' and s.grace_until > now())
          )
      )
      and exists (
        select 1 from public.user_consents c
        where c.user_id = p.id and c.consent_type = 'email' and c.withdrawn_at is null
      )
      and not exists (
        select 1 from public.email_sends e
        where e.user_id = p.id and e.kind = 'subscriber_batch' and e.run_id = p_run
      )
  ), built as (
    select r.*,
      (
        select coalesce(jsonb_agg(picked.card), '[]'::jsonb)
        from (
          select jsonb_build_object('listing_id', c.listing_id, 'data', c.listing_data) as card
          from changes c
          where c.change_type in ('new', 'relisted')
            and c.status = 'active'
            and public.mail_listing_matches(r.filters, c.listing_data)
          order by public.pipeline_num(c.listing_data ->> 'rent') nulls last, c.listing_id
          limit 5
        ) picked
      ) as new_items,
      (
        select count(*)::integer from changes c
        where c.change_type in ('new', 'relisted')
          and c.status = 'active'
          and public.mail_listing_matches(r.filters, c.listing_data)
      ) as new_total,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'listing_id', c.listing_id, 'data', c.listing_data, 'fields', c.changed_fields
        )), '[]'::jsonb)
        from changes c
        where c.change_type = 'changed' and c.status = 'active'
          and exists (
            select 1 from public.saved_listings s
            join public.saved_lists l on l.id = s.list_id
            where s.listing_id = c.listing_id and l.user_id = r.id
          )
      ) as changed_items,
      (
        select coalesce(jsonb_agg(jsonb_build_object('listing_id', c.listing_id, 'data', c.listing_data)), '[]'::jsonb)
        from changes c
        where c.status in ('gone', 'sold_out')
          and c.change_type in ('changed', 'gone')
          and exists (
            select 1 from public.saved_listings s
            join public.saved_lists l on l.id = s.list_id
            where s.listing_id = c.listing_id and l.user_id = r.id
          )
      ) as sold_items
    from recipients r
    where r.used < r.month_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', id, 'to', contact_email, 'used', used, 'month_limit', month_limit,
    'new', new_items, 'new_total', new_total, 'changed', changed_items, 'sold', sold_items
  )), '[]'::jsonb)
  from built
  where new_total > 0 or jsonb_array_length(changed_items) > 0 or jsonb_array_length(sold_items) > 0;
$$;

-- 6. 발송 기록 -----------------------------------------------------------------
-- 동시에 호출되어도 월 상한을 넘지 않도록 회원별로 잠근 뒤 확인한다.
create function public.mail_record_send(
  p_user uuid,
  p_kind text,
  p_run uuid,
  p_to text,
  p_subject text,
  p_status text,
  p_scheduled timestamptz default null,
  p_payload jsonb default null,
  p_items jsonb default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_send uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));

  if p_kind = 'subscriber_batch'
     and public.mail_month_used(p_user) >= public.pipeline_setting('subscriber.mail_monthly_limit') then
    return null;
  end if;

  insert into public.email_sends (user_id, kind, run_id, to_address, subject, status, scheduled_for, payload)
  values (p_user, p_kind, p_run, p_to, p_subject, p_status, p_scheduled, p_payload)
  on conflict (user_id, kind, run_id) where run_id is not null do nothing
  returning id into new_send;

  if new_send is null then
    return null;
  end if;

  insert into public.email_send_items (send_id, listing_id, section)
  select new_send, (entry ->> 'listing_id')::uuid, entry ->> 'section'
  from jsonb_array_elements(p_items) as entry
  on conflict do nothing;

  return new_send;
end;
$$;

create function public.mail_mark_result(
  p_send uuid,
  p_status text,
  p_resend_id text default null,
  p_error text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.email_sends
  set status = p_status,
      resend_id = p_resend_id,
      error = p_error,
      payload = null,
      sent_at = case when p_status = 'sent' then now() end
  where id = p_send;
$$;

-- 야간이라 미뤄 둔 메일 중 보낼 시각이 된 것. 그사이 거부한 회원의 메일은 취소한다.
create function public.mail_due_deferred()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  due jsonb;
begin
  update public.email_sends e
  set status = 'suppressed', payload = null
  where e.status = 'deferred'
    and e.kind = 'subscriber_batch'
    and not exists (
      select 1 from public.user_consents c
      where c.user_id = e.user_id and c.consent_type = 'email' and c.withdrawn_at is null
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'to', to_address, 'subject', subject, 'payload', payload
  )), '[]'::jsonb) into due
  from public.email_sends
  where status = 'deferred' and scheduled_for <= now();

  return due;
end;
$$;

-- 7. 수신 거부와 2년 주기 수신 동의 안내 -------------------------------------------
create function public.mail_unsubscribe(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
  address text;
begin
  update public.user_consents
  set withdrawn_at = now()
  where user_id = p_user and consent_type = 'email' and withdrawn_at is null;
  get diagnostics changed = row_count;

  update public.email_sends
  set status = 'suppressed', payload = null
  where user_id = p_user and status = 'deferred' and kind = 'subscriber_batch';

  select contact_email into address from public.profiles where id = p_user;

  return jsonb_build_object('changed', changed > 0, 'to', address);
end;
$$;

create function public.mail_due_consent_reminders()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.id, 'to', p.contact_email, 'agreed_at', c.agreed_at
  )), '[]'::jsonb)
  from public.user_consents c
  join public.profiles p on p.id = c.user_id
  where c.consent_type = 'email'
    and c.withdrawn_at is null
    and p.deleted_at is null
    and p.contact_email is not null
    and coalesce(c.last_reminded_at, c.agreed_at) <= now() - interval '2 years';
$$;

create function public.mail_mark_reminded(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.user_consents
  set last_reminded_at = now()
  where user_id = p_user and consent_type = 'email' and withdrawn_at is null;
$$;

-- 8. 함수 실행 권한: 서버의 서비스 키로만 실행한다. ------------------------------------
revoke all on function public.mail_listing_matches(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.mail_month_used(uuid) from public, anon, authenticated;
revoke all on function public.mail_collect_batch(uuid) from public, anon, authenticated;
revoke all on function public.mail_record_send(uuid, text, uuid, text, text, text, timestamptz, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.mail_mark_result(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.mail_due_deferred() from public, anon, authenticated;
revoke all on function public.mail_unsubscribe(uuid) from public, anon, authenticated;
revoke all on function public.mail_due_consent_reminders() from public, anon, authenticated;
revoke all on function public.mail_mark_reminded(uuid) from public, anon, authenticated;

grant execute on function public.mail_collect_batch(uuid) to service_role;
grant execute on function public.mail_record_send(uuid, text, uuid, text, text, text, timestamptz, jsonb, jsonb) to service_role;
grant execute on function public.mail_mark_result(uuid, text, text, text) to service_role;
grant execute on function public.mail_due_deferred() to service_role;
grant execute on function public.mail_unsubscribe(uuid) to service_role;
grant execute on function public.mail_due_consent_reminders() to service_role;
grant execute on function public.mail_mark_reminded(uuid) to service_role;
