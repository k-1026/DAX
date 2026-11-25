-- 6-E-2: 프로필 사진 올리기 (Supabase Storage 'avatars') + 가입 직후 사진 설정 화면 표시
-- 되돌리기: supabase/rollback/20261123000500_avatars_rollback.sql

-- 사진 보관 칸: 누구나 볼 수 있고(공개 주소), 2MB 이하 JPG·PNG·WebP만 받는다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 올리기·바꾸기·지우기는 본인 폴더({내 id}/…)에서만 할 수 있다.
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- 목록 조회는 본인 폴더만(공개 주소로 파일을 보는 데는 정책이 필요 없다).
create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 이메일로 가입한 회원에게 가입 직후 "사진 설정" 화면을 한 번만 보여 주기 위한 표시.
-- 건너뛰면 이 시각이 찍히고, 다시 보여 주지 않는다.
alter table public.profiles add column avatar_prompted_at timestamptz;
grant update (avatar_prompted_at) on public.profiles to authenticated;
