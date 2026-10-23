-- 1. Mail actions: changes made in the app (read, unread, archive, unarchive) that the sync worker
--    applies to the mail server, so your phone and iCloud.com match the app.
create table public.mail_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  action text not null check (action in ('read', 'unread', 'archive', 'unarchive')),
  status text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index mail_actions_pending_idx on public.mail_actions (created_at) where status = 'queued';
create index mail_actions_thread_idx on public.mail_actions (thread_id);

alter table public.mail_actions enable row level security;

create policy "Read own mail actions" on public.mail_actions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Queue mail actions in own conversations" on public.mail_actions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and error is null
    and done_at is null
    and exists (select 1 from public.threads t where t.id = thread_id and t.user_id = (select auth.uid()))
  );

revoke all on public.mail_actions from anon;
revoke update, delete, truncate on public.mail_actions from authenticated;

-- 2. Drafts: the app asks for one by adding a pending row; the AI worker fills in the body.
alter table public.drafts drop constraint drafts_status_check;
alter table public.drafts add constraint drafts_status_check
  check (status in ('pending', 'active', 'sent', 'discarded', 'failed'));
alter table public.drafts alter column body set default '';
alter table public.drafts add column error text;
alter table public.drafts add column updated_at timestamptz not null default now();
create index drafts_pending_idx on public.drafts (created_at) where status = 'pending';

-- A draft may only point at one of your own conversations, so the AI never reads someone else's mail.
create policy "Drafts only in own conversations" on public.drafts as restrictive for insert to authenticated
  with check (exists (select 1 from public.threads t where t.id = thread_id and t.user_id = (select auth.uid())));
create policy "Drafts stay in own conversations" on public.drafts as restrictive for update to authenticated
  with check (exists (select 1 from public.threads t where t.id = thread_id and t.user_id = (select auth.uid())));

-- 3. Sent replies remember the draft they started from, so the AI can learn from your edits.
alter table public.outbox add column draft_id uuid references public.drafts (id) on delete set null;
drop policy "Queue replies in own conversations" on public.outbox;
create policy "Queue replies in own conversations" on public.outbox for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and error is null
    and provider_message_id is null
    and sent_at is null
    and exists (select 1 from public.threads t where t.id = thread_id and t.user_id = (select auth.uid()))
    and (draft_id is null or exists (select 1 from public.drafts d where d.id = draft_id and d.user_id = (select auth.uid())))
  );

-- 4. AI usage: one row per model call, with tokens and cost worked out when the call was made.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  thread_id uuid references public.threads (id) on delete set null,
  feature text not null check (feature in ('triage', 'draft', 'learn')),
  provider text not null default 'gemini',
  model text not null,
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,     -- includes thinking tokens, which are billed as output
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index ai_usage_user_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
create policy "Read own AI usage" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.ai_usage from anon;
revoke insert, update, delete, truncate on public.ai_usage from authenticated;

-- Totals per account, month, feature and model. security_invoker keeps the table's row-level security.
create view public.ai_usage_summary with (security_invoker = true) as
select
  user_id,
  account_id,
  date_trunc('month', created_at) as month,
  feature,
  provider,
  model,
  count(*)::integer as calls,
  sum(input_tokens)::bigint as input_tokens,
  sum(output_tokens)::bigint as output_tokens,
  sum(cost_usd)::numeric(12, 6) as cost_usd
from public.ai_usage
group by user_id, account_id, date_trunc('month', created_at), feature, provider, model;

revoke all on public.ai_usage_summary from anon;
grant select on public.ai_usage_summary to authenticated;

-- The worker reacts to these at once instead of waiting for its next check.
alter publication supabase_realtime add table public.mail_actions;
