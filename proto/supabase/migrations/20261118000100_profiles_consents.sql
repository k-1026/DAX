-- 3단계: 회원(profiles)과 동의 기록(user_consents), 권한 규칙
-- 근거: 앱 개발/04_회원_동의_권한_규칙.md, 앱 개발/03_데이터_설계서.md
-- 되돌리기: supabase/rollback/20261118000100_profiles_consents_rollback.sql

-- 1. 회원 정보 ---------------------------------------------------------------
-- 이메일과 비밀번호는 Supabase Auth(auth.users)가 관리한다.
-- 카카오 회원은 auth.users에 이메일이 없을 수 있어 메일 수신 주소를 따로 둔다.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  avatar_url    text,
  contact_email text
                check (
                  contact_email is null
                  or contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
                ),
  role          text not null default 'user' check (role in ('user', 'admin')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- 2. 동의 기록 ---------------------------------------------------------------
-- 필수: terms(이용약관), privacy(개인정보 처리방침)
-- 선택: behavior_tracking(행동 기록 저장), email(추천 메일 수신)
create table public.user_consents (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  consent_type     text not null
                   check (consent_type in ('terms', 'privacy', 'behavior_tracking', 'email')),
  document_version text not null,
  agreed_at        timestamptz not null default now(),
  withdrawn_at     timestamptz
);

-- 같은 문서 버전에 대한 유효한 동의는 1건만 둔다.
create unique index user_consents_active_unique
  on public.user_consents (user_id, consent_type, document_version)
  where withdrawn_at is null;

create index user_consents_user_id_idx on public.user_consents (user_id);

-- 3. 관리자 확인 함수 ---------------------------------------------------------
-- 권한 규칙 안에서 profiles를 다시 읽어도 규칙이 반복 실행되지 않도록 소유자 권한으로 실행한다.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and deleted_at is null
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 4. 필수 동의 완료 확인 함수 ---------------------------------------------------
-- 서버가 현재 약관 버전을 넘겨 호출한다. 약관이 바뀌면 새 버전에 다시 동의해야 true가 된다.
create function public.has_required_consents(terms_version text, privacy_version text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select count(distinct consent_type) = 2
  from public.user_consents
  where user_id = (select auth.uid())
    and withdrawn_at is null
    and (
      (consent_type = 'terms' and document_version = terms_version)
      or (consent_type = 'privacy' and document_version = privacy_version)
    );
$$;

revoke all on function public.has_required_consents(text, text) from public, anon;
grant execute on function public.has_required_consents(text, text) to authenticated;

-- 5. 가입하면 회원 정보를 자동으로 만든다 ---------------------------------------
-- 이 처리가 실패하면 카카오 가입 전체가 실패하므로, 이미 있는 회원은 건너뛴다.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'nickname',
      new.raw_user_meta_data ->> 'preferred_username',
      new.raw_user_meta_data ->> 'user_name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이 파일을 실행하기 전에 가입한 계정도 회원 정보를 갖도록 채운다.
insert into public.profiles (id, display_name, avatar_url)
select
  id,
  coalesce(
    raw_user_meta_data ->> 'name',
    raw_user_meta_data ->> 'full_name',
    raw_user_meta_data ->> 'nickname',
    raw_user_meta_data ->> 'preferred_username',
    raw_user_meta_data ->> 'user_name'
  ),
  coalesce(raw_user_meta_data ->> 'avatar_url', raw_user_meta_data ->> 'picture')
from auth.users
on conflict (id) do nothing;

-- 6. 수정 시각 자동 갱신 -------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 7. 칸 단위 권한 --------------------------------------------------------------
-- 사용자는 이름, 프로필 사진, 메일 수신 주소만 고칠 수 있다. 역할(role)은 바꿀 수 없다.
revoke all on public.profiles from anon, authenticated;
revoke all on public.user_consents from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, contact_email) on public.profiles to authenticated;

-- 동의 시각은 서버 시각만 쓰도록 agreed_at은 입력 권한을 주지 않는다.
grant select on public.user_consents to authenticated;
grant insert (user_id, consent_type, document_version) on public.user_consents to authenticated;
grant update (withdrawn_at) on public.user_consents to authenticated;

-- 8. 행 단위 권한(RLS) ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_consents enable row level security;

create policy "본인 또는 관리자만 회원 정보 조회"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "본인만 회원 정보 수정"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "본인 또는 관리자만 동의 기록 조회"
  on public.user_consents for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- 메일 수신 동의는 메일 수신 주소가 있어야 등록할 수 있다.
create policy "본인 동의만 등록"
  on public.user_consents for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      consent_type <> 'email'
      or exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.contact_email is not null
      )
    )
  );

create policy "본인 동의만 철회"
  on public.user_consents for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and withdrawn_at is not null);
