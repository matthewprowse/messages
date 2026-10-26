-- More about each calendar event, and deleting events.
--
-- Details the worker now keeps for every synced event, so opening one in the app can show more than its
-- name and time:
--   description     the notes
--   calendar_name   which calendar it is on (Home, Work, ...)
--   conference_url  a Zoom, Meet or Teams link, from the event's own link or its notes
--   resource_url    iCloud only: the event's file on the CalDAV server, which deleting it needs
--   series_id       set when the event is one occurrence of a repeating event: the iCloud UID or Google's
--                   recurringEventId, which is also how every occurrence of the series is found
alter table public.calendar_events
  add column description text,
  add column calendar_name text,
  add column conference_url text,
  add column resource_url text,
  add column series_id text;

-- Deleting an event from the app: the app queues a row, the worker deletes the event in iCloud or Google
-- Calendar, removes the stored copy and settles the row. scope says what a repeating event loses: that one
-- occurrence, or the whole series. event_id is set null when the stored event goes, which is what happens
-- once the delete has worked, so the row stays to say so.
create table public.calendar_deletes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  event_id uuid references public.calendar_events (id) on delete set null,
  scope text not null default 'occurrence' check (scope in ('occurrence', 'series')),
  status text not null default 'queued' check (status in ('queued', 'deleting', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index calendar_deletes_queued_idx on public.calendar_deletes (created_at) where status = 'queued';

alter table public.calendar_deletes enable row level security;

create policy "Read own calendar deletes" on public.calendar_deletes for select to authenticated
  using (user_id = (select auth.uid()));

-- Only your own events in the account they belong to can be queued.
create policy "Queue deletes of own events" on public.calendar_deletes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.calendar_events e
      where e.id = event_id and e.user_id = (select auth.uid()) and e.account_id = calendar_deletes.account_id
    )
  );

revoke all on public.calendar_deletes from anon, authenticated;
grant select on public.calendar_deletes to authenticated;
grant insert (event_id, account_id, scope) on public.calendar_deletes to authenticated;

alter publication supabase_realtime add table public.calendar_deletes;
