-- Action cards: next steps the AI proposes under a draft (book a meeting, create a task, attach a file, use a template).
--
-- The draft call may return one optional action; the AI worker validates it and stores a proposal here with its arguments
-- sealed (field "action", JSON). The app shows the proposal under the draft with one Approve button. Approving runs the
-- existing paths in the browser (New Event, the task_updates queue, the composer's attach, the template insert), so nothing
-- is ever done without the click; this table only remembers what was proposed and what was decided.
--
-- The browser may read its own rows and mark them (status, edited arguments) but never insert: only the AI worker, with
-- the service role, proposes. Deleting a draft or conversation takes its proposals with it.

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  draft_id uuid not null references public.drafts (id) on delete cascade,
  kind text not null check (kind in ('book_meeting', 'create_task', 'attach_file', 'use_template')),
  args text not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index actions_draft_idx on public.actions (draft_id);
create index actions_thread_idx on public.actions (thread_id, created_at desc);
create index actions_user_idx on public.actions (user_id);

alter table public.actions enable row level security;

create policy "Read own actions" on public.actions for select to authenticated using (user_id = (select auth.uid()));
create policy "Resolve own actions" on public.actions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Realtime pushes a new proposal to the open conversation.
alter publication supabase_realtime add table public.actions;
