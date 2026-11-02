-- Undo Send and Send Later. The app sets outbox.send_after to now plus the undo window (or to a chosen time) and the
-- worker claims only rows that are due, so it cannot send early. Users have no update or delete on outbox (the worker
-- owns a row once queued), so Undo and Send Now are two narrow functions that act only on the caller's own rows and
-- only while a row is still 'queued'. The worker claims with an update guarded by the same status, so exactly one of
-- the two wins: a message already claimed cannot be cancelled, and a cancelled one cannot be claimed.

alter table public.outbox add column if not exists send_after timestamptz;

-- A year is far enough for a scheduled message and stops a typo from parking a row for good.
alter table public.outbox add constraint outbox_send_after_range
  check (send_after is null or send_after < created_at + interval '366 days') not valid;

create index if not exists outbox_due_idx on public.outbox (send_after) where status = 'queued' and send_after is not null;

-- Cancels a queued message (Undo, or Cancel on a scheduled one). True when it was cancelled, false when the worker
-- already has it. Its files go with it (outbox_attachments cascades).
create or replace function public.cancel_outbox(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone integer;
begin
  delete from public.outbox
  where id = p_id and user_id = (select auth.uid()) and status = 'queued';
  get diagnostics gone = row_count;
  return gone = 1;
end;
$$;

-- Sends a scheduled message now: it becomes due at once. False when it is not queued any more.
create or replace function public.send_outbox_now(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.outbox set send_after = now()
  where id = p_id and user_id = (select auth.uid()) and status = 'queued';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke execute on function public.cancel_outbox(uuid), public.send_outbox_now(uuid) from public, anon;
grant execute on function public.cancel_outbox(uuid), public.send_outbox_now(uuid) to authenticated;
