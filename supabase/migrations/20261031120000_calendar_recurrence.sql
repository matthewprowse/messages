-- Repeating events: how a series repeats, so the app can say it in words and change it.
--
-- calendar_events.recurrence  the series' rule as iCalendar writes it after "RRULE:" (FREQ=WEEKLY;BYDAY=TU),
--                             stored on every occurrence of the series by the sync worker. Null for an event
--                             that does not repeat, or when the calendar does not say (Outlook).
-- calendar_outbox.recurrence  a new event that repeats, by this rule.
-- calendar_updates.recurrence a new rule for the whole series, or one that makes a single event repeat. Null
--                             leaves it as it is.

alter table public.calendar_events add column if not exists recurrence text;

alter table public.calendar_outbox add column if not exists recurrence text
  check (char_length(recurrence) <= 500 and recurrence ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Za-z0-9,:+-]+)*$');

alter table public.calendar_updates add column if not exists recurrence text
  check (char_length(recurrence) <= 500 and recurrence ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Za-z0-9,:+-]+)*$');

-- A change of rule is a change on its own; an answer to an invitation never carries one.
alter table public.calendar_updates drop constraint if exists calendar_updates_kind_fields_check;
alter table public.calendar_updates add constraint calendar_updates_kind_fields_check check (
  (kind = 'rsvp' and response is not null
    and title is null and description is null and location is null and starts_at is null and attendees is null and recurrence is null)
  or (kind = 'update' and response is null
    and (title is not null or description is not null or location is not null or starts_at is not null or attendees is not null or recurrence is not null))
);

grant insert (recurrence) on public.calendar_updates to authenticated;
