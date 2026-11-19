-- 20261119000900_improvements.sql 되돌리기
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

drop function if exists public.improvement_mark_urgent_notified(uuid[]);
drop function if exists public.improvement_urgent_unnotified();
drop function if exists public.improvement_weekly(boolean);
drop function if exists public.improvement_record_groups(text, boolean, jsonb);
drop function if exists public.improvement_to_group(text, integer);
drop trigger if exists listing_feedback_add_urgent on public.listing_feedback;
drop trigger if exists listing_feedback_clear_groups on public.listing_feedback;
drop trigger if exists listing_feedback_urgent on public.listing_feedback;
drop function if exists public.improvement_add_urgent();
drop function if exists public.improvement_clear_groups();
drop function if exists public.listing_feedback_urgent();
drop table if exists public.improvement_review_groups;
drop table if exists public.improvement_evidence;
drop table if exists public.improvement_candidates;
alter table public.listing_feedback drop column if exists urgent_notified_at;
alter table public.listing_feedback drop column if exists urgent_kind;
drop function if exists public.improvement_urgent_kind(text);
delete from public.app_settings where key like 'improvement.%';
