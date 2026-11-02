-- One iCloud sign-in for Mail, Calendar and Reminders (docs/PLAN.md, "One iCloud Sign-In").
--
-- The app queues a row with the Apple ID and password sealed under the static key (like sign-in codes) and what the
-- person ticked. The iCloud connector in the AI worker (apps/ai/ai/connectors/icloud_reminders/setup.py) signs in to
-- the account page, asks for the code through step, method, attempts and code here, makes an app-specific password
-- labelled "Konva" and writes it back sealed in result. The app then checks it with iCloud Mail and Calendar, saves the
-- accounts as it saves a pasted password, and deletes the row. Nothing here is for the browser: the app reads and
-- writes it through its own routes with the service role, so there are no policies.

create table public.icloud_setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  services text[] not null check (cardinality(services) > 0 and services <@ array['mail', 'calendar', 'reminders']),
  sign_in text not null,                 -- sealed {appleId, password, mailUser, address}; emptied once the row fails
  status text not null default 'queued' check (status in ('queued', 'signing_in', 'ready', 'done', 'failed')),
  step text check (step in ('two_factor', 'code')),
  method text check (method in ('app', 'sms')),
  attempts integer not null default 0,
  code text,                             -- sealed answer typed in the app
  detail text,                           -- what to show while it waits
  result text,                           -- sealed {appPassword, trustToken}
  error text,                            -- the plain reason it failed
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index icloud_setups_user_idx on public.icloud_setups (user_id);
create index icloud_setups_open_idx on public.icloud_setups (created_at) where status in ('queued', 'signing_in', 'ready');

alter table public.icloud_setups enable row level security;
revoke all on public.icloud_setups from anon, authenticated;
