-- Your own profile photo, so "You" shows your picture. It is kept in the private "avatars" bucket at <user id>/me
-- (2 MB, JPEG, PNG or WebP; the bucket limits already cover this), and profiles.avatar_path points at it.
-- Profiles are already updatable by their owner through row level security, so no column grant is needed.

alter table public.profiles add column if not exists avatar_path text;

alter table public.profiles drop constraint if exists profiles_avatar_path_own;
alter table public.profiles add constraint profiles_avatar_path_own
  check (avatar_path is null or avatar_path = user_id::text || '/me');

-- Each person may write, replace and remove only their own photo object, never another file in the bucket.
create policy "Add own profile photo" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text and name = (select auth.uid())::text || '/me');

create policy "Replace own profile photo" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text and name = (select auth.uid())::text || '/me')
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text and name = (select auth.uid())::text || '/me');

create policy "Remove own profile photo" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text and name = (select auth.uid())::text || '/me');
