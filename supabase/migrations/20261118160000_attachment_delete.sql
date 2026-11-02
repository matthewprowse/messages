-- Delete a file from Konva's storage (Attachments page) without touching the email or chat it came with. Not applied
-- by whoever wrote it: apply by hand.
--
-- Identical files are stored once per account, so several attachments rows can point at one storage object. Deleting a
-- row's copy therefore clears that row (storage_path, thumb_path, team_path, content_hash) and marks it not_kept =
-- 'deleted', and the object itself is only queued for removal when no other row still points at it (ref counting).
-- Users cannot delete storage objects or update attachments, so a narrow function does both steps for the caller's own
-- files, and the worker (apps/worker/src/storage-sweep.ts) removes the queued objects, checking the count again first
-- in case a new duplicate arrived in between.

alter table public.attachments drop constraint if exists attachments_not_kept_check;
alter table public.attachments
  add constraint attachments_not_kept_check check (not_kept in ('video_link', 'over_cap', 'deferred', 'unavailable', 'deleted'));

create table public.storage_deletions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null unique check (length(path) <= 300),
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
-- Service role only: no policies.
alter table public.storage_deletions enable row level security;

create or replace function public.delete_attachment_files(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
  paths text[];
begin
  select coalesce(array_agg(distinct p), '{}') into paths
  from public.attachments a, unnest(array[a.storage_path, a.thumb_path, a.team_path]) as p
  where a.id = any (p_ids) and a.user_id = (select auth.uid()) and p is not null;

  update public.attachments
  set storage_path = null, thumb_path = null, team_path = null, team_key_version = null,
      sealed = false, content_hash = null, not_kept = 'deleted'
  where id = any (p_ids)
    and user_id = (select auth.uid())
    and (storage_path is not null or thumb_path is not null or team_path is not null);
  get diagnostics changed = row_count;

  -- Only objects no remaining row points at are queued.
  insert into public.storage_deletions (user_id, path)
  select (select auth.uid()), d from unnest(paths) as d
  where not exists (
    select 1 from public.attachments r
    where r.user_id = (select auth.uid()) and d in (coalesce(r.storage_path, ''), coalesce(r.thumb_path, ''), coalesce(r.team_path, ''))
  )
  on conflict (path) do nothing;

  return changed;
end;
$$;

revoke execute on function public.delete_attachment_files(uuid[]) from public, anon;
grant execute on function public.delete_attachment_files(uuid[]) to authenticated;

-- The other attachments (any conversation) holding the same file as this one, for "Also in N conversations". Same stored
-- object or same content hash; conversations in the bin are left out. Runs as the caller, so row level security applies.
create or replace function public.attachment_copies(p_id uuid)
returns table (attachment_id uuid, message_id uuid, thread_id uuid)
language sql
stable
set search_path = ''
as $$
  select o.id, m.id, m.thread_id
  from public.attachments me
  join public.attachments o on o.user_id = me.user_id and o.id <> me.id
    and ((me.storage_path is not null and o.storage_path = me.storage_path)
      or (me.content_hash is not null and o.content_hash = me.content_hash))
  join public.messages m on m.id = o.message_id
  join public.threads t on t.id = m.thread_id and t.status <> 'trash'
  where me.id = p_id and me.user_id = (select auth.uid())
  limit 200
$$;

revoke execute on function public.attachment_copies(uuid) from public, anon;
grant execute on function public.attachment_copies(uuid) to authenticated;
