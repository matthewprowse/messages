-- Replies waiting to be sent. The app adds a row; the sync worker sends it with the account's own mail
-- server, files a copy in Sent and records the outcome. Users can only add queued rows to their own
-- conversations and read their own rows. Only the worker (service role) changes them afterwards.
create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 100000),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  error text,                               -- a short reason the app can show when sending failed
  provider_message_id text,                 -- Message-ID of the sent email
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index outbox_pending_idx on public.outbox (created_at) where status in ('queued', 'sending');
create index outbox_user_idx on public.outbox (user_id, created_at desc);
create index outbox_thread_idx on public.outbox (thread_id);

alter table public.outbox enable row level security;

create policy "Read own outbox" on public.outbox for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Queue replies in own conversations" on public.outbox for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and error is null
    and provider_message_id is null
    and sent_at is null
    and exists (select 1 from public.threads t where t.id = thread_id and t.user_id = (select auth.uid()))
  );

-- No update or delete for app users: once queued, a reply belongs to the worker.
revoke all on public.outbox from anon;
revoke update, delete, truncate on public.outbox from authenticated;

alter publication supabase_realtime add table public.outbox;
