-- Attachments on messages sent from the app (iCloud, Gmail and WhatsApp).
--
-- Order of operations in the app:
--   1. Upload each file to the private "attachments" bucket at "<user id>/outbox/<uuid>/<filename>".
--   2. Insert the outbox row with status 'queued' and attachment_count set to the number of files.
--   3. Insert one outbox_attachments row per file.
-- The worker does not send a row until it sees attachment_count matching rows in outbox_attachments
-- (it waits up to 60 seconds, then fails the row). Size limits are enforced in the app and the worker.
-- Storage files stay after sending; a cleanup in the worker removes outbox files older than 7 days whose
-- outbox row is sent or failed.

-- ---------------------------------------------------------------------------
-- 1. outbox.attachment_count, and a message may be attachments only
-- ---------------------------------------------------------------------------

alter table public.outbox add column attachment_count integer not null default 0;
alter table public.outbox add constraint outbox_attachment_count_check
  check (attachment_count between 0 and 10);

-- A message with attachments may have an empty body (a photo with no caption, a file with no note).
-- Without attachments the body still needs some text, as before.
alter table public.outbox drop constraint outbox_body_check;
alter table public.outbox add constraint outbox_body_check check (
  length(btrim(body)) <= 100000
  and (length(btrim(body)) >= 1 or attachment_count > 0)
);

-- The existing insert policies on public.outbox ("Queue replies in own conversations" and the restrictive
-- "Reply to a message in the same conversation") are unchanged: the column needs no extra condition.

-- ---------------------------------------------------------------------------
-- 2. outbox_attachments
-- ---------------------------------------------------------------------------

create table public.outbox_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  outbox_id uuid not null references public.outbox (id) on delete cascade,
  storage_path text not null,               -- in the "attachments" bucket, under "<user id>/outbox/"
  filename text not null check (char_length(filename) between 1 and 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  position integer not null default 0,      -- order the files were added in
  created_at timestamptz default now()
);

create index outbox_attachments_outbox_idx on public.outbox_attachments (outbox_id, position);
create index outbox_attachments_user_idx on public.outbox_attachments (user_id);

alter table public.outbox_attachments enable row level security;

create policy "Read own outbox attachments" on public.outbox_attachments for select to authenticated
  using (user_id = (select auth.uid()));

-- Only for your own outbox row while it is still queued, and only files in your own outbox folder.
create policy "Attach files to own queued messages" on public.outbox_attachments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and split_part(outbox_attachments.storage_path, '/', 1) = (select auth.uid())::text
    and split_part(outbox_attachments.storage_path, '/', 2) = 'outbox'
    and exists (
      select 1 from public.outbox o
      where o.id = outbox_attachments.outbox_id
        and o.user_id = (select auth.uid())
        and o.status = 'queued'
    )
  );

-- No update or delete for app users: once added, an attachment belongs to the worker.
revoke all on public.outbox_attachments from anon;
revoke update, delete, truncate on public.outbox_attachments from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Uploading outbox files
-- ---------------------------------------------------------------------------

-- The app uploads into "<user id>/outbox/..." in the attachments bucket. "Read own attachments" already
-- lets users read anything under their own folder; there is no update or delete policy, so no overwrites.
create policy "Upload own outbox files" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = 'outbox'
  );
