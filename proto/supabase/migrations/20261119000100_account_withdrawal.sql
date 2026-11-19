-- 3단계: 회원 탈퇴
-- 근거: 앱 개발/04_회원_동의_권한_규칙.md 6절
-- 되돌리기: supabase/rollback/20261119000100_account_withdrawal_rollback.sql

-- 1. 탈퇴 후에도 동의 기록을 보관할 수 있도록 회원과의 연결을 끊을 수 있게 한다.
alter table public.user_consents alter column user_id drop not null;
alter table public.user_consents drop constraint user_consents_user_id_fkey;
alter table public.user_consents
  add constraint user_consents_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete set null;

-- 회원 정보와 연결되지 않는 임의의 값. 같은 사람의 기록끼리만 묶는다.
alter table public.user_consents add column anonymized_ref uuid;

-- 2. 탈퇴 사유 통계. 누가 탈퇴했는지는 저장하지 않는다.
create table public.account_withdrawals (
  id           bigint generated always as identity primary key,
  reason_code  text check (
                 reason_code in (
                   'no_listing', 'poor_recommendation', 'hard_to_use',
                   'price', 'plan_changed', 'privacy', 'other'
                 )
               ),
  withdrawn_at timestamptz not null default now()
);

alter table public.account_withdrawals enable row level security;
revoke all on public.account_withdrawals from anon, authenticated;
grant select on public.account_withdrawals to authenticated;

create policy "관리자만 탈퇴 사유 조회"
  on public.account_withdrawals for select to authenticated
  using ((select public.is_admin()));

-- 3. 탈퇴 처리: 본인 계정만 삭제할 수 있다.
-- 로그인 계정을 지우면 회원 정보는 함께 삭제되고, 동의 기록은 익명으로 남는다.
create function public.withdraw_account(reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid := (select auth.uid());
  record_ref uuid := gen_random_uuid();
begin
  if target_id is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;

  insert into public.account_withdrawals (reason_code) values (reason);

  update public.user_consents
  set anonymized_ref = record_ref,
      withdrawn_at = coalesce(withdrawn_at, now())
  where user_id = target_id;

  delete from auth.users where id = target_id;
end;
$$;

revoke all on function public.withdraw_account(text) from public, anon;
grant execute on function public.withdraw_account(text) to authenticated;
