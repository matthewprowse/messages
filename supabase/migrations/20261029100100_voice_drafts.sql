-- Saying what a reply should say. The app records you, seals the clip with your key (FIELD
-- voice_instruction) and uploads it to attachments/<user>/drafts/, then asks for a draft with audio_path
-- set. The AI worker listens to it in the same model call that writes the draft, stores what you said as
-- the draft's instruction (sealed), and deletes the clip: it is kept only until the draft is written.
alter table public.drafts add column audio_path text;
alter table public.drafts add constraint drafts_audio_path_check
  check (audio_path is null or audio_path like user_id::text || '/drafts/%');

-- "Read own attachments" already covers reading. Delete is for a request the app gives up on.
create policy "Upload own draft recordings" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = 'drafts'
  );

create policy "Delete own draft recordings" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = 'drafts'
  );
