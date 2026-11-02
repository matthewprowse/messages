-- Events made in the app can be added to an Outlook Calendar account as well as Google and iCloud ones (the worker
-- creates them through Microsoft Graph). The policy is otherwise the same as in 20261027120000_icloud_calendar_events.sql.
-- Deleting, changing and answering events need no change: their policies check the event and its account, not the provider.

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
      where a.id = calendar_outbox.account_id and a.user_id = (select auth.uid()) and a.provider in ('google_calendar', 'icloud_calendar', 'outlook_calendar')
    )
  );
