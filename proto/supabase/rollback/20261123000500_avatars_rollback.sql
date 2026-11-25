-- 20261123000500_avatars.sql 되돌리기 (올려 둔 사진 파일은 먼저 지워야 칸을 지울 수 있다)
drop policy if exists avatars_select_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_insert_own on storage.objects;
delete from storage.objects where bucket_id = 'avatars';
delete from storage.buckets where id = 'avatars';
alter table public.profiles drop column if exists avatar_prompted_at;
