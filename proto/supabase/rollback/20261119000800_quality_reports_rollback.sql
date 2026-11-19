-- 20261119000800_quality_reports.sql 되돌리기
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
  from unnest(array['feedback_classify', 'feedback_second_check', 'feedback_report'])
       with ordinality as steps (step_key, step_order);

  return new_run;
end;
$$;

drop function if exists public.quality_weekly_report(uuid, boolean);
drop function if exists public.quality_metric(text, text, text, text, numeric, text, text, text, text, integer);
drop table if exists public.quality_reports;
delete from public.app_settings where key like 'quality.%';
