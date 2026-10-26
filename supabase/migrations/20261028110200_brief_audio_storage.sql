-- The daily brief's audio in Storage instead of base64 in the database.
--
-- Each part is a file in the private "brief-audio" bucket at "<user id>/<brief id>/<seq>.<ext>" (for
-- example ".../0.wav"), sealed by the AI worker as the base64 column is (field "brief"), so the file says
-- nothing without the user's key. Only the worker writes and deletes them (the service role, which storage
-- policies do not limit); a user can read only files under their own "<user id>/" folder.
--
-- brief_parts.audio_path names the file. The base64 audio column stays for now, for parts stored before
-- this, and becomes optional: a part has one or the other. The worker deletes a brief's files when it
-- deletes or rewrites the brief (deleting the row does not delete the files).
--
-- brief_parts joins briefs in the realtime publication, so the app hears each part as it is stored instead
-- of polling.

insert into storage.buckets (id, name, public)
values ('brief-audio', 'brief-audio', false)
on conflict (id) do nothing;

drop policy if exists "Read own brief audio" on storage.objects;
create policy "Read own brief audio" on storage.objects for select to authenticated
  using (bucket_id = 'brief-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.brief_parts add column if not exists audio_path text;
alter table public.brief_parts alter column audio drop not null;

alter table public.brief_parts drop constraint if exists brief_parts_audio_check;
alter table public.brief_parts add constraint brief_parts_audio_check check (
  (audio is not null or audio_path is not null)
  and (audio_path is null or (
    audio_path like user_id::text || '/' || brief_id::text || '/%'
    and char_length(audio_path) <= 200
  ))
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'brief_parts'
  ) then
    alter publication supabase_realtime add table public.brief_parts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'briefs'
  ) then
    alter publication supabase_realtime add table public.briefs;
  end if;
end;
$$;
