-- 20261119000100_account_withdrawal.sql 되돌리기
-- 주의: 탈퇴 사유 통계와 탈퇴 회원의 익명 동의 기록이 삭제된다.
-- 문제가 생겼을 때 관리자 확인을 받은 뒤에만 실행한다.

drop function if exists public.withdraw_account(text);
drop table if exists public.account_withdrawals;

delete from public.user_consents where user_id is null;
alter table public.user_consents drop column if exists anonymized_ref;

alter table public.user_consents drop constraint user_consents_user_id_fkey;
alter table public.user_consents
  add constraint user_consents_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;
alter table public.user_consents alter column user_id set not null;
