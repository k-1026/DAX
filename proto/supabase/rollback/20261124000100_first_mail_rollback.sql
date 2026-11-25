-- 20261124000100_first_mail.sql 되돌리기
drop function if exists public.my_first_mail_preview();
drop function if exists public.mail_first_claim(uuid);
drop function if exists public.mail_first_collect();
alter table public.user_preferences drop column if exists first_mail_requested_at;
-- set_my_preferences는 20261123000400_preferences.sql의 원래 함수로 다시 만든다(그 파일의 함수 정의를 다시 실행).
