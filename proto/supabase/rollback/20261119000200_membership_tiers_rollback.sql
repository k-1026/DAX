-- 20261119000200_membership_tiers.sql 되돌리기
-- 주의: 구독 상태, 한도 설정값, 설정 변경 기록이 삭제된다.
-- 문제가 생겼을 때 관리자 확인을 받은 뒤에만 실행한다.

drop function if exists public.my_access();
drop function if exists public.current_tier();

drop table if exists public.app_setting_changes;
drop table if exists public.app_settings;
drop function if exists public.record_setting_change();

drop table if exists public.subscriptions;
