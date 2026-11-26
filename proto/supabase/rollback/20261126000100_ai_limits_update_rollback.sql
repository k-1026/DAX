-- 20261126000100_ai_limits_update 되돌리기: 이전 한도로 복원
update public.app_settings set value = '300', updated_at = now() where key = 'guest.ai_daily_cap';
update public.app_settings set value = '10',  updated_at = now() where key = 'member.ai_daily_limit';
update public.app_settings set value = '30',  updated_at = now() where key = 'subscriber.ai_daily_limit';
