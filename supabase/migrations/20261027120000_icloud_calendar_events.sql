-- Events made in the app can be added to an iCloud Calendar account as well as a Google Calendar one. The
-- policy is otherwise the same as in 20261023300000_new_anything.sql.

drop policy "Queue events in own calendars" on public.calendar_outbox;
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
      where a.id = calendar_outbox.account_id and a.user_id = (select auth.uid()) and a.provider in ('google_calendar', 'icloud_calendar')
    )
  );
