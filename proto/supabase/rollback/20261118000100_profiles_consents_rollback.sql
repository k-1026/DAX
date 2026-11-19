-- 20261118000100_profiles_consents.sql 되돌리기
-- 주의: 회원 정보(profiles)와 동의 기록(user_consents)이 삭제된다. 로그인 계정(auth.users)은 유지된다.
-- 문제가 생겼을 때 관리자 확인을 받은 뒤에만 실행한다.

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.user_consents;
drop table if exists public.profiles;

drop function if exists public.has_required_consents(text, text);
drop function if exists public.is_admin();
drop function if exists public.handle_new_user();
drop function if exists public.set_updated_at();
