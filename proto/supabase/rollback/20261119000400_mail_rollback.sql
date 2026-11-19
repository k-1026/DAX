-- 20261119000400_mail.sql 되돌리기
-- 주의: 선호 조건, 담기, 메일 발송 기록이 삭제된다.
-- 문제가 생겼을 때 관리자 확인을 받은 뒤에만 실행한다.

drop function if exists public.mail_mark_reminded(uuid);
drop function if exists public.mail_due_consent_reminders();
drop function if exists public.mail_unsubscribe(uuid);
drop function if exists public.mail_due_deferred();
drop function if exists public.mail_mark_result(uuid, text, text, text);
drop function if exists public.mail_record_send(uuid, text, uuid, text, text, text, timestamptz, jsonb, jsonb);
drop function if exists public.mail_collect_batch(uuid);
drop function if exists public.mail_month_used(uuid);
drop function if exists public.mail_listing_matches(jsonb, jsonb);

drop trigger if exists profiles_clear_mail_address on public.profiles;
drop function if exists public.clear_mail_address();

drop table if exists public.email_send_items;
drop table if exists public.email_sends;
drop table if exists public.saved_listings;
drop table if exists public.saved_lists;
drop table if exists public.user_preferences;

alter table public.user_consents drop column if exists last_reminded_at;

-- 파이프라인에서 메일 단계를 뺀다.
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
  from unnest(array['quality_check', 'diff', 'validate', 'score'])
       with ordinality as steps (step_key, step_order);

  return new_run;
end;
$$;
