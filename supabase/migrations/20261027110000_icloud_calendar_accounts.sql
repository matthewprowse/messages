-- iCloud Calendar accounts, read over CalDAV with an app-specific password. Events land in calendar_events
-- like Google's and Outlook's.

alter table public.accounts drop constraint accounts_provider_check;
alter table public.accounts add constraint accounts_provider_check
  check (provider in ('icloud', 'gmail', 'google_calendar', 'outlook', 'outlook_calendar', 'icloud_calendar', 'whatsapp'));
