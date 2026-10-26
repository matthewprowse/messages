-- Conversations waiting on the other person. When you wrote last, the AI worker (apps/ai/ai/chasers.py)
-- reads your last message, with the one before it, and notes whether it expects an answer: a question, a
-- request, a proposal. Thanks and "see you then" do not. The app's Waiting filter lists the ones that do
-- and have had no answer for two days, and Draft Follow-Up writes the nudge. message_id is the message
-- that was read, so a newer one of yours is read again.
create table public.follow_ups (
  thread_id uuid primary key references public.threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  expects_reply boolean not null,
  checked_at timestamptz not null default now()
);

create index follow_ups_waiting on public.follow_ups (user_id) where expects_reply;

alter table public.follow_ups enable row level security;

-- Written by the AI worker only (service role); you can read your own.
create policy "Read own follow-ups" on public.follow_ups for select to authenticated
  using (user_id = (select auth.uid()));
