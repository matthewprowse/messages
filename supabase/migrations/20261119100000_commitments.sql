-- Promises found in conversations ("I'll send the quote by Friday", "they will confirm Monday"). The AI worker
-- (apps/ai/ai/chasers.py with commitments.py) lists them while it checks which conversations are waiting on a
-- reply, so no extra model call is made. text is sealed with the user's key (field task_title). message_id is the
-- message the promise was said in; seq tells apart several promises from one message so a re-read never repeats them.
-- The app shows them as Promises on the Summary and as a strip in the open conversation, and lets you tick one Done
-- or snooze it (status, done_at, snoozed_until). nudged_at is set by the worker when a promise of theirs passed its
-- date unanswered and it returned the conversation to Inbox with a Follow Up reminder.
create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  seq smallint not null default 0,
  owner text not null check (owner in ('me', 'them')),
  text text not null,
  due_on date,
  status text not null default 'open' check (status in ('open', 'done')),
  done_at timestamptz,
  snoozed_until timestamptz,
  nudged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, seq)
);

create index commitments_open on public.commitments (user_id, due_on) where status = 'open';
create index commitments_thread on public.commitments (thread_id);

alter table public.commitments enable row level security;

create policy "Own commitments" on public.commitments for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Written by the AI worker (service role). The app may read them, tick one Done and snooze one.
revoke insert, update, truncate on public.commitments from authenticated;
grant update (status, done_at, snoozed_until) on public.commitments to authenticated;

alter publication supabase_realtime add table public.commitments;
