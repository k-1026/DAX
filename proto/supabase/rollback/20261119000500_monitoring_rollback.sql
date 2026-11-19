-- 20261119000500_monitoring.sql 되돌리기
drop function if exists public.monitor_undo_alert(bigint);
drop function if exists public.monitor_record(jsonb);
drop function if exists public.monitor_db_checks();
drop table if exists public.health_checks;
delete from public.app_settings where key like 'monitor.%';
