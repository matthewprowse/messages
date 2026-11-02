-- Readable Bulk Email (docs/PLAN.md, Readable Bulk Email). Opening a newsletter, marketing or notification email asks the
-- AI worker for a short readable version of it: a summary, a few key points and labelled links, stored sealed on
-- message_ai.bulk_read. Nothing is made on arrival, so mail that is never opened costs nothing.
--
-- The app inserts a request here. The AI worker claims it, writes message_ai.bulk_read, and deletes the request. A request
-- the worker could not answer keeps its error, so the app can say so and offer Retry (the owner may delete a failed one).

create table public.bulk_reads (
  message_id uuid primary key references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  error text check (error is null or char_length(error) <= 300)
);

-- The worker's queue: requests not failed, oldest first.
create index bulk_reads_open_idx on public.bulk_reads (created_at) where error is null;
create index bulk_reads_user_idx on public.bulk_reads (user_id);

alter table public.bulk_reads enable row level security;
revoke all on public.bulk_reads from anon;
revoke update, truncate on public.bulk_reads from authenticated;

create policy "bulk_reads_select_own" on public.bulk_reads
  for select to authenticated using (user_id = (select auth.uid()));

create policy "bulk_reads_insert_own" on public.bulk_reads
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and claimed_at is null and error is null
    and exists (select 1 from public.messages m where m.id = message_id and m.user_id = (select auth.uid()) and m.is_bulk)
  );

-- Only a failed request may be removed by its owner, so Retry can ask again.
create policy "bulk_reads_delete_failed_own" on public.bulk_reads
  for delete to authenticated using (user_id = (select auth.uid()) and error is not null);

-- The readable version: sealed JSON (field "bulk_read"), {summary, points, links, source}. Null until it is asked for.
alter table public.message_ai add column bulk_read text;

-- Its cost is filed under its own feature, with its own share of the monthly budget and a weekly limit.
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('triage', 'draft', 'learn', 'brief', 'transcribe', 'logos', 'bulk_read'));

-- Starting split: 5% for readable bulk mail, taken from Sorting and Junk. Only when the owner has not set a share for it
-- yet, so a split already changed in Admin is left as it is.
update public.ai_budget
set shares = jsonb_set(jsonb_set(shares, '{triage}', to_jsonb(((shares ->> 'triage')::numeric - 5))), '{bulk_read}', '5'::jsonb),
    weekly_features = array_append(weekly_features, 'bulk_read')
where not (shares ? 'bulk_read') and coalesce((shares ->> 'triage')::numeric, 0) >= 5;
