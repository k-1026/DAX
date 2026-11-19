-- 20261119000700_feedback_analysis.sql 되돌리기
drop function if exists public.feedback_weekly_report(boolean);
drop function if exists public.feedback_check_summary(text, boolean);
drop function if exists public.feedback_record(text, text, text, boolean, jsonb);
drop function if exists public.feedback_second_sample(text);
drop function if exists public.feedback_to_classify(text, integer);
drop function if exists public.weekly_start_run();
drop trigger if exists listing_feedback_clear_classifications on public.listing_feedback;
drop function if exists public.feedback_clear_classifications();
drop table if exists public.weight_proposals;
drop table if exists public.feedback_classifications;
delete from public.agent_runs where run_type = 'weekly';
delete from public.app_settings where key like 'feedback.%';
