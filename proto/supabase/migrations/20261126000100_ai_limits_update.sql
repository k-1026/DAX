-- 2026-11-26 확정한 AI 이용 한도로 바꾼다 (16_비용_예상.md 5절).
-- 되돌리기: supabase/rollback/20261126000100_ai_limits_update_rollback.sql
update public.app_settings set value = '100', updated_at = now() where key = 'guest.ai_daily_cap';
update public.app_settings set value = '5',   updated_at = now() where key = 'member.ai_daily_limit';
update public.app_settings set value = '20',  updated_at = now() where key = 'subscriber.ai_daily_limit';
