-- Junk: spam, marketing and impersonal bulk mail, sorted out of All and Priority by the AI worker.
alter table public.message_ai add column junk boolean not null default false;
alter table public.threads add column junk boolean not null default false;
create index threads_junk_idx on public.threads (user_id, last_message_at desc) where junk;

-- The sender's own unsubscribe instructions (RFC 2369 List-Unsubscribe, RFC 8058 one-click).
alter table public.messages add column list_unsubscribe text;
alter table public.messages add column list_unsubscribe_post boolean not null default false;
create index messages_sender_idx on public.messages (account_id, sender_address, sent_at desc);

-- Unsubscribe requests, one per sender. The app adds queued rows; the sync worker carries them out
-- with the sender's List-Unsubscribe header and records the result. Mail from a sender with a row
-- here is treated as junk from then on.
create table public.unsubscribes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  sender_address text not null,
  status text not null default 'queued' check (status in ('queued', 'working', 'done', 'manual', 'failed')),
  method text check (method in ('one_click', 'mailto', 'link')),
  manual_url text,                          -- a page you must open yourself, when that is the only way
  error text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (user_id, account_id, sender_address)
);

create index unsubscribes_pending_idx on public.unsubscribes (created_at) where status = 'queued';

alter table public.unsubscribes enable row level security;

create policy "Read own unsubscribes" on public.unsubscribes for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Queue unsubscribes for own accounts" on public.unsubscribes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and method is null and manual_url is null and error is null and done_at is null
    and exists (select 1 from public.accounts a where a.id = account_id and a.user_id = (select auth.uid()))
  );

revoke all on public.unsubscribes from anon;
revoke update, delete, truncate on public.unsubscribes from authenticated;

alter publication supabase_realtime add table public.unsubscribes;

-- A failed or manual request can be cleared, so the sender can be tried again.
grant delete on public.unsubscribes to authenticated;
create policy "Clear own unfinished unsubscribes" on public.unsubscribes for delete to authenticated
  using (user_id = (select auth.uid()) and status in ('failed', 'manual'));
