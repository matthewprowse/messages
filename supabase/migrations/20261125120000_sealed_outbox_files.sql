-- Outgoing attachments are sealed (security audit 2026-11-03, H5). The app now seals each file's bytes in the browser
-- (FIELD.outboxFileData, the "e1b:" file format) and its name (FIELD.filename, "e1:"), and uploads it to
-- "<user id>/outbox/<uuid>/file", so neither Storage nor the path holds the real name or the contents.
--
-- 1. outbox_attachments.filename holds a sealed value, which is longer than the 255 characters a plain name may be.
-- 2. New uploads and new outbox_attachments rows must use the "file" object name. Rows queued before this keep their
--    old "<uuid>/<name>" paths, which the workers still read (ownOutboxPath, own_outbox_path) and the cleanup still
--    removes. Apply after the web app that writes "file" is live, or sends with files from an old tab fail to attach.
-- 3. The worker's cleanup finds files no row points at any more (a send cancelled with Undo deletes its row, an upload
--    whose send was never queued, rows removed by the retention job) with orphan_outbox_files, and removes them through
--    the Storage API. SQL cannot remove the objects themselves safely. storage_path gets an index for that lookup.

-- ---------------------------------------------------------------------------
-- 1. Room for a sealed name
-- ---------------------------------------------------------------------------

-- A 255 character name of 4-byte characters sealed is about 1,400 characters of base64.
alter table public.outbox_attachments drop constraint if exists outbox_attachments_filename_check;
alter table public.outbox_attachments
  add constraint outbox_attachments_filename_check check (char_length(filename) between 1 and 2000);

-- ---------------------------------------------------------------------------
-- 2. Only "<user id>/outbox/<uuid>/file" for new files
-- ---------------------------------------------------------------------------

drop policy if exists "Upload own outbox files" on storage.objects;

create policy "Upload own outbox files" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and name ~ (
      '^' || (select auth.uid())::text
      || '/outbox/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/file$'
    )
  );

drop policy "Attach files to own queued messages" on public.outbox_attachments;

create policy "Attach files to own queued messages" on public.outbox_attachments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and storage_path ~ (
      '^' || (select auth.uid())::text
      || '/outbox/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/file$'
    )
    and exists (
      select 1 from storage.objects so
      where so.bucket_id = 'attachments'
        and so.name = outbox_attachments.storage_path
        and so.owner_id = (select auth.uid())::text
    )
    and exists (
      select 1 from public.outbox o
      where o.id = outbox_attachments.outbox_id
        and o.user_id = (select auth.uid())
        and o.status = 'queued'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Files no row points at
-- ---------------------------------------------------------------------------

create index if not exists outbox_attachments_storage_path_idx on public.outbox_attachments (storage_path);

-- Outbox objects uploaded before p_before that no outbox_attachments row points at, oldest first. The worker removes
-- them (apps/worker/src/send/outbox-cleanup.ts), checking each path is inside its own user's outbox folder.
create or replace function public.orphan_outbox_files(p_before timestamptz, p_limit integer default 100)
returns table (path text)
language sql
stable
security definer
set search_path = ''
as $$
  select so.name
  from storage.objects so
  where so.bucket_id = 'attachments'
    and so.created_at < p_before
    and so.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/outbox/'
    and not exists (select 1 from public.outbox_attachments oa where oa.storage_path = so.name)
  order by so.created_at
  limit least(greatest(coalesce(p_limit, 100), 1), 1000)
$$;

revoke execute on function public.orphan_outbox_files(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.orphan_outbox_files(timestamptz, integer) to service_role;
