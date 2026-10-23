-- Tightens outbox_attachments after review.
--
-- 1. storage_path must be exactly the app's format, "<user id>/outbox/<uuid>/<safe name>", and point at a
--    file this user already uploaded. The worker downloads these paths with the service role, so a path
--    with encoded dots or other tricks must never get in.
-- 2. One row per position for each outbox row, so a retried insert cannot add the same files twice.

alter table public.outbox_attachments
  add constraint outbox_attachments_position_check check (position between 0 and 9);

drop index if exists public.outbox_attachments_outbox_idx;
alter table public.outbox_attachments
  add constraint outbox_attachments_outbox_position_key unique (outbox_id, position);

drop policy "Attach files to own queued messages" on public.outbox_attachments;

create policy "Attach files to own queued messages" on public.outbox_attachments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and storage_path ~ (
      '^' || (select auth.uid())::text
      || '/outbox/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9()][A-Za-z0-9._() -]{0,99}$'
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
