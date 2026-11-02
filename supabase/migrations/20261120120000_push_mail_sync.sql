-- Push based mail sync: the pieces the web app and the worker meet in.
--
-- mail_hints: Microsoft Graph change notifications arrive at a public route in the web app (apps/web/app/api/graph/notify),
-- which cannot reach the worker directly. It writes one row per account here, and the worker hears the change through
-- Realtime and syncs that account now. One row per account (an upsert), so the table never grows past the number of
-- accounts, and a burst of notifications is a burst of updates to the same row. It holds no content: an id and a time.
--
-- account_heartbeats: the "last checked" time the worker used to write to accounts.last_synced_at every 15 minutes per
-- account. accounts is published to Realtime and every open browser listens to it, so each heartbeat was an event to
-- every tab. This table is not published. accounts.last_synced_at still changes when the status does.

create table public.mail_hints (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  hinted_at timestamptz not null default now()
);

-- Service role only (the route and the worker): no policy means no one else can read or write it.
alter table public.mail_hints enable row level security;

create table public.account_heartbeats (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  synced_at timestamptz not null default now()
);

alter table public.account_heartbeats enable row level security;

create policy "Read own account heartbeats" on public.account_heartbeats for select to authenticated
  using (exists (select 1 from public.accounts a where a.id = account_id and a.user_id = (select auth.uid())));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mail_hints'
  ) then
    alter publication supabase_realtime add table public.mail_hints;
  end if;
end $$;
