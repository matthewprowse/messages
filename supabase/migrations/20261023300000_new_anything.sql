-- Starting something new from the app: a new WhatsApp chat, and a new Google Calendar event.
-- 1. outbox: a new WhatsApp chat uses the same shape as a new email (no conversation yet, an account and
--    recipients), with exactly one phone number in E.164 form and no subject or From address. The worker
--    sends it, then fills in thread_id, or fails the row when the number is not on WhatsApp.
-- 2. calendar_outbox: events waiting to be created in Google Calendar. The app adds a queued row; the
--    worker creates the event, stores it in calendar_events and records the outcome.

-- ---------------------------------------------------------------------------
-- 1. Outbox: new WhatsApp chats
-- ---------------------------------------------------------------------------

-- Same as before (send_from_and_compose), plus the WhatsApp branch. The restrictive policy "Reply to a
-- message in the same conversation" is separate and unchanged; with no thread_id it only allows a null
-- reply_to_message_id, which is what a new chat needs.
drop policy "Queue replies in own conversations" on public.outbox;
create policy "Queue replies in own conversations" on public.outbox for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and error is null
    and provider_message_id is null
    and sent_at is null
    and (outbox.draft_id is null or exists (
      select 1 from public.drafts d where d.id = outbox.draft_id and d.user_id = (select auth.uid())
    ))
    and (
      -- A reply: your own conversation, and if an account is named it must be that conversation's.
      (outbox.thread_id is not null and exists (
        select 1 from public.threads t
        where t.id = outbox.thread_id and t.user_id = (select auth.uid())
          and (outbox.account_id is null or t.account_id = outbox.account_id)
      ))
      -- A new email: one of your own email accounts.
      or (outbox.thread_id is null and exists (
        select 1 from public.accounts a
        where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider in ('icloud', 'gmail')
      ))
      -- A new WhatsApp chat: your own WhatsApp account, one phone number, no subject or From address.
      or (outbox.thread_id is null
        and cardinality(outbox.to_addresses) = 1
        and outbox.to_addresses[1] ~ '^\+[1-9][0-9]{6,14}$'
        and outbox.subject is null
        and outbox.from_address is null
        and exists (
          select 1 from public.accounts a
          where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider = 'whatsapp'
        ))
    )
  );

-- ---------------------------------------------------------------------------
-- 2. calendar_outbox
-- ---------------------------------------------------------------------------

-- Attendees are compared lowercase, so store them that way: trimmed, lowercase, no blanks or repeats,
-- first spelling kept in order.
create or replace function public.normalise_calendar_attendees()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.attendees := array(
    select lower(btrim(u.a))
    from unnest(new.attendees) with ordinality as u (a, i)
    where btrim(u.a) <> ''
    group by lower(btrim(u.a))
    order by min(u.i)
  );
  return new;
end;
$$;

-- True when every entry looks like a lowercase email address.
create or replace function public.calendar_attendees_valid(p_attendees text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(a = lower(a) and a ~ '^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$'), true)
  from unnest(p_attendees) as a
$$;

-- The check constraint runs it as the inserting user, so authenticated keeps execute; anon never inserts.
revoke execute on function public.calendar_attendees_valid(text[]) from public, anon;
grant execute on function public.calendar_attendees_valid(text[]) to authenticated, service_role;

create table public.calendar_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,  -- a google_calendar account
  calendar_id text not null default 'primary' check (char_length(calendar_id) between 1 and 1024),
  title text not null check (char_length(btrim(title)) >= 1 and char_length(title) <= 300),
  description text check (char_length(description) <= 8000),
  location text check (char_length(location) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,  -- the worker sends dates; ends_at is exclusive, as in Google
  time_zone text not null check (time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$'),  -- IANA, from the browser
  attendees text[] not null default '{}'
    check (cardinality(attendees) <= 50 and public.calendar_attendees_valid(attendees)),
  send_invites boolean not null default true,
  add_meet boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'creating', 'created', 'failed')),
  error text,                               -- a short reason the app can show when creating failed
  provider_event_id text,                   -- Google's event id
  html_link text,                           -- the event in Google Calendar
  created_at timestamptz not null default now(),
  done_at timestamptz,
  constraint calendar_outbox_times_check check (ends_at > starts_at)
);

create trigger normalise_calendar_attendees before insert or update of attendees on public.calendar_outbox
  for each row execute function public.normalise_calendar_attendees();

create index calendar_outbox_pending_idx on public.calendar_outbox (created_at) where status in ('queued', 'creating');
create index calendar_outbox_user_idx on public.calendar_outbox (user_id, created_at desc);
create index calendar_outbox_account_idx on public.calendar_outbox (account_id);

alter table public.calendar_outbox enable row level security;

create policy "Read own calendar outbox" on public.calendar_outbox for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Queue events in own calendars" on public.calendar_outbox for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and error is null
    and provider_event_id is null
    and html_link is null
    and done_at is null
    and exists (
      select 1 from public.accounts a
      where a.id = calendar_outbox.account_id and a.user_id = (select auth.uid()) and a.provider = 'google_calendar'
    )
  );

-- No update or delete for app users: once queued, an event belongs to the worker.
revoke all on public.calendar_outbox from anon;
revoke update, delete, truncate on public.calendar_outbox from authenticated;

alter publication supabase_realtime add table public.calendar_outbox;
