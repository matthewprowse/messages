-- Copy on first open for old or large email files. The worker no longer copies an email attachment up front when it is
-- over 5 MB or its message is over 30 days old: the row stays with no stored file and not_kept = 'deferred'. Opening
-- such a file inserts a row here; the worker fetches the file from the mailbox, keeps it, and deletes the request.
-- A file the mailbox no longer has becomes not_kept = 'unavailable'. Existing stored files are not touched.

alter table public.attachments drop constraint if exists attachments_not_kept_check;
alter table public.attachments
  add constraint attachments_not_kept_check check (not_kept in ('video_link', 'over_cap', 'deferred', 'unavailable'));

create table public.attachment_fetch_requests (
  attachment_id uuid primary key references public.attachments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  error text check (error is null or length(error) <= 300)
);

create index attachment_fetch_requests_open_idx on public.attachment_fetch_requests (created_at) where error is null;
create index attachment_fetch_requests_user_idx on public.attachment_fetch_requests (user_id);

alter table public.attachment_fetch_requests enable row level security;

create policy "attachment_fetch_requests_select_own" on public.attachment_fetch_requests
  for select to authenticated using (user_id = (select auth.uid()));

create policy "attachment_fetch_requests_insert_own" on public.attachment_fetch_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.attachments a where a.id = attachment_id and a.user_id = (select auth.uid()))
  );

-- Only a failed request may be removed by its owner, so Retry can ask again. Nothing else is updated or deleted by users.
create policy "attachment_fetch_requests_delete_failed_own" on public.attachment_fetch_requests
  for delete to authenticated using (user_id = (select auth.uid()) and error is not null);

-- The worker listens for new requests.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attachment_fetch_requests') then
    alter publication supabase_realtime add table public.attachment_fetch_requests;
  end if;
end $$;
