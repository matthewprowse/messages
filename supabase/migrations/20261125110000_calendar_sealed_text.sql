-- Calendar text sealed per user (security audit 2026-11-03, H5). calendar_events gains nothing: its description,
-- calendar_name, conference_url and resource_url hold "e1:" text in the same columns, and attendees (jsonb) holds the
-- whole guest list sealed as one JSON string instead of an array. Nothing in SQL reads any of them; the meeting linker
-- and Google Meet find an event by time and then compare its opened link and guests in the worker.
--
-- What changes here is the queue the app writes to. calendar_outbox and calendar_updates take their title, description,
-- location and guests from the browser, which now seals them before the insert: the text under the event fields, each
-- guest under the address field. The checks that made that impossible change:
--
--   1. calendar_attendees_valid accepts a sealed guest as well as a lowercase email address (rows queued before
--      sealing, or with NEXT_PUBLIC_ENCRYPT_ADDRESSES off). The worker opens every guest and checks it is an email
--      address before anything reaches Google, Microsoft or iCloud (apps/worker/src/calendar/event-text.ts).
--   2. normalise_calendar_attendees leaves a sealed guest as it is: lowercasing would change its base64. The browser
--      trims, lowercases and dedupes before sealing.
--   3. The length checks on title, description and location allow the longer sealed form of a value within the old
--      limit (calendar_text_valid). The worker checks the opened text against the same limits.
--
-- Latest definitions: both functions from 20261023300000_new_anything.sql, the checks from there and from
-- 20261028110500_calendar_updates.sql. Grants and search_path are kept.

-- 1
-- True when every entry is a sealed value ("e1:" and base64, no longer than a sealed 320 character address can be) or
-- looks like a lowercase email address.
create or replace function public.calendar_attendees_valid(p_attendees text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(
    (a ~ '^e1:[A-Za-z0-9+/]+={0,2}$' and char_length(a) <= 2000)
    or (a = lower(a) and a ~ '^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$')
  ), true)
  from unnest(p_attendees) as a
$$;

-- The check constraint runs it as the inserting user, so authenticated keeps execute; anon never inserts.
revoke execute on function public.calendar_attendees_valid(text[]) from public, anon;
grant execute on function public.calendar_attendees_valid(text[]) to authenticated, service_role;

-- 2
-- Plain guests are compared lowercase, so stored that way: trimmed, lowercase, no blanks or repeats, first spelling kept
-- in order. A sealed guest is kept exactly as it came.
create or replace function public.normalise_calendar_attendees()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.attendees := array(
    select case when u.a like 'e1:%' then u.a else lower(btrim(u.a)) end
    from unnest(new.attendees) with ordinality as u (a, i)
    where btrim(u.a) <> ''
    group by case when u.a like 'e1:%' then u.a else lower(btrim(u.a)) end
    order by min(u.i)
  );
  return new;
end;
$$;

-- 3
-- A title, description or location within p_max characters, or the same sealed: "e1:" and the base64 of a 12 byte
-- nonce, up to 4 UTF-8 bytes for each character and a 16 byte tag. p_required also refuses a blank plain value (a
-- title). Null passes; not null is the column's business.
create or replace function public.calendar_text_valid(p_value text, p_max integer, p_required boolean default false)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null
    or (p_value ~ '^e1:[A-Za-z0-9+/]+={0,2}$' and char_length(p_value) <= 3 + 4 * ceil((4 * p_max + 28) / 3.0))
    or (char_length(p_value) <= p_max and (not p_required or char_length(btrim(p_value)) >= 1))
$$;

revoke execute on function public.calendar_text_valid(text, integer, boolean) from public, anon;
grant execute on function public.calendar_text_valid(text, integer, boolean) to authenticated, service_role;

alter table public.calendar_outbox drop constraint if exists calendar_outbox_title_check;
alter table public.calendar_outbox add constraint calendar_outbox_title_check check (public.calendar_text_valid(title, 300, true));
alter table public.calendar_outbox drop constraint if exists calendar_outbox_description_check;
alter table public.calendar_outbox add constraint calendar_outbox_description_check check (public.calendar_text_valid(description, 8000));
alter table public.calendar_outbox drop constraint if exists calendar_outbox_location_check;
alter table public.calendar_outbox add constraint calendar_outbox_location_check check (public.calendar_text_valid(location, 500));

alter table public.calendar_updates drop constraint if exists calendar_updates_title_check;
alter table public.calendar_updates add constraint calendar_updates_title_check check (public.calendar_text_valid(title, 300, true));
alter table public.calendar_updates drop constraint if exists calendar_updates_description_check;
alter table public.calendar_updates add constraint calendar_updates_description_check check (public.calendar_text_valid(description, 8000));
alter table public.calendar_updates drop constraint if exists calendar_updates_location_check;
alter table public.calendar_updates add constraint calendar_updates_location_check check (public.calendar_text_valid(location, 500));

comment on column public.calendar_events.attendees is
  'The guest list: a JSON array, or the array sealed under event_guests as one JSON string ("e1:..."). An empty list stays [].';
comment on column public.calendar_events.description is 'The notes, sealed under event_notes (or plain, from before sealing).';
comment on column public.calendar_events.calendar_name is 'Which calendar it is on, sealed under calendar_name (or plain, from before sealing).';
comment on column public.calendar_events.conference_url is 'The join link, sealed under event_link (or plain, from before sealing).';
comment on column public.calendar_events.resource_url is 'iCloud only: the event''s CalDAV file, sealed under event_file (or plain, from before sealing).';
