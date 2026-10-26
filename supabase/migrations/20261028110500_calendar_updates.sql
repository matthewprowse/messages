-- Editing calendar events and answering invitations from the app, queued for the worker like creating
-- (calendar_outbox) and deleting (calendar_deletes).
--
-- One row is one change to one stored event:
--   kind 'update'  new details. Each detail column left null is left as it is; an empty location or
--                  description clears it. starts_at, ends_at, all_day and time_zone come together (all
--                  four or none). attendees, when set, is the whole new list (lowercase addresses, as in
--                  calendar_outbox), and send_invites says whether the provider tells them of the change.
--   kind 'rsvp'    response is accepted, tentative or declined, sent as the account's own answer.
-- scope says what a repeating event's change applies to: that occurrence, or the whole series.
--
-- The worker makes the change in iCloud or Google Calendar, updates the stored event and settles the row
-- (status done or failed, with a short error and done_at). event_id is set null if the stored event goes.

create table if not exists public.calendar_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  event_id uuid references public.calendar_events (id) on delete set null,
  kind text not null check (kind in ('update', 'rsvp')),
  scope text not null default 'occurrence' check (scope in ('occurrence', 'series')),
  title text check (char_length(btrim(title)) >= 1 and char_length(title) <= 300),
  description text check (char_length(description) <= 8000),
  location text check (char_length(location) <= 500),
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  time_zone text check (time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$'),
  attendees text[] check (cardinality(attendees) <= 50 and public.calendar_attendees_valid(attendees)),
  send_invites boolean not null default true,
  response text check (response in ('accepted', 'tentative', 'declined')),
  status text not null default 'queued' check (status in ('queued', 'updating', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  constraint calendar_updates_times_check check (
    (starts_at is null and ends_at is null and all_day is null and time_zone is null)
    or (starts_at is not null and ends_at is not null and all_day is not null and time_zone is not null and ends_at > starts_at)
  ),
  constraint calendar_updates_kind_fields_check check (
    (kind = 'rsvp' and response is not null
      and title is null and description is null and location is null and starts_at is null and attendees is null)
    or (kind = 'update' and response is null
      and (title is not null or description is not null or location is not null or starts_at is not null or attendees is not null))
  )
);

-- Lowercase, trimmed, no repeats, as calendar_outbox. Only when a list is given: null means unchanged.
drop trigger if exists normalise_calendar_attendees on public.calendar_updates;
create trigger normalise_calendar_attendees before insert or update of attendees on public.calendar_updates
  for each row when (new.attendees is not null) execute function public.normalise_calendar_attendees();

create index if not exists calendar_updates_queued_idx on public.calendar_updates (created_at) where status = 'queued';
create index if not exists calendar_updates_user_idx on public.calendar_updates (user_id, created_at desc);
create index if not exists calendar_updates_event_idx on public.calendar_updates (event_id);

alter table public.calendar_updates enable row level security;

drop policy if exists "Read own calendar updates" on public.calendar_updates;
create policy "Read own calendar updates" on public.calendar_updates for select to authenticated
  using (user_id = (select auth.uid()));

-- Only your own events in the account they belong to can be changed.
drop policy if exists "Queue updates of own events" on public.calendar_updates;
create policy "Queue updates of own events" on public.calendar_updates for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.calendar_events e
      where e.id = event_id and e.user_id = (select auth.uid()) and e.account_id = calendar_updates.account_id
    )
  );

-- The app names the change; status, error and done_at are the worker's.
revoke all on public.calendar_updates from anon, authenticated;
grant select on public.calendar_updates to authenticated;
grant insert (
  account_id, event_id, kind, scope, title, description, location, starts_at, ends_at, all_day, time_zone,
  attendees, send_invites, response
) on public.calendar_updates to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calendar_updates'
  ) then
    alter publication supabase_realtime add table public.calendar_updates;
  end if;
end;
$$;
