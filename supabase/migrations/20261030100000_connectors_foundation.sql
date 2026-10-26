-- The shared base for the next connectors: other IMAP mailboxes, Teams, Zoom, Google Meet and Google Chat,
-- LinkedIn, Instagram, Microsoft To Do, Google Tasks and iCloud Reminders. Each connector's own migration
-- adds only what is particular to it; the provider names, channels and the two shared tables are here, so
-- the connectors agree on them.
--
-- Encrypted fields (packages/crypto/src/fields.ts, apps/ai/ai/fields.py) when content encryption is on:
--   tasks.title task_title, tasks.notes task_notes, tasks.list_name task_list
--   meetings.title meeting_title, meetings.transcript transcript, meetings.summary summary,
--   meetings.action_items meeting_actions, meeting_participants.name name, meeting_participants.address address

alter table public.accounts drop constraint accounts_provider_check;
alter table public.accounts add constraint accounts_provider_check
  check (provider in (
    'icloud', 'gmail', 'google_calendar', 'outlook', 'outlook_calendar', 'icloud_calendar', 'whatsapp',
    'imap', 'teams', 'zoom', 'google_meet', 'linkedin', 'instagram', 'microsoft_todo', 'google_tasks', 'icloud_reminders'
  ));

alter table public.threads drop constraint threads_channel_check;
alter table public.threads add constraint threads_channel_check
  check (channel in ('email', 'whatsapp', 'linkedin', 'instagram', 'teams', 'zoom', 'google_chat'));

-- ---------------------------------------------------------------------------
-- Tasks and reminders: Microsoft To Do, Google Tasks and iCloud Reminders. Shown in Calendar on the day
-- they are due and in the daily brief. Written by the sync worker; the app changes them through task_updates.
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider_task_id text not null,
  list_id text not null,
  list_name text,
  title text not null default '',
  notes text,
  /** A due time, or midnight UTC of the due day when due_all_day. Null when the task has no date. */
  due_at timestamptz,
  due_all_day boolean not null default true,
  status text not null default 'open' check (status in ('open', 'completed')),
  completed_at timestamptz,
  /** 1 high, 2 medium, 3 low, null none, as the provider has it. */
  priority smallint check (priority between 1 and 3),
  /** The client the task is about, when it could be matched. */
  contact_id uuid references public.contacts (id) on delete set null,
  provider_meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider_task_id)
);

create index tasks_user_due_idx on public.tasks (user_id, due_at) where status = 'open';
create index tasks_contact_idx on public.tasks (contact_id) where contact_id is not null;
create trigger set_updated_at before update on public.tasks for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;
create policy "Read own tasks" on public.tasks for select to authenticated
  using (user_id = (select auth.uid()));

-- Ticking a task off, or back on, in the app. The worker applies it to the provider and marks it done.
create table public.task_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  action text not null check (action in ('complete', 'reopen')),
  status text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index task_updates_queued_idx on public.task_updates (created_at) where status = 'queued';

alter table public.task_updates enable row level security;
create policy "Read own task updates" on public.task_updates for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Queue updates to own tasks" on public.task_updates for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and exists (select 1 from public.tasks t where t.id = task_updates.task_id and t.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Meetings from Teams, Zoom and Google Meet, with their transcripts. A meeting shows as a card in each
-- attendee's conversation, on their contact page, and on its calendar event.
-- ---------------------------------------------------------------------------

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  platform text not null check (platform in ('teams', 'zoom', 'google_meet')),
  provider_meeting_id text not null,
  /** The calendar event this meeting was, matched by its join link or by time and attendees. */
  calendar_event_id uuid references public.calendar_events (id) on delete set null,
  title text,
  started_at timestamptz not null,
  ended_at timestamptz,
  /**
   * What was said, as JSON text: [{"speaker": "Name", "start_ms": 0, "text": "..."}], oldest first.
   * Sealed as one value under the transcript field.
   */
  transcript text,
  /** provider: the platform's own transcript. recording: transcribed by the AI worker from the recording. */
  transcript_source text check (transcript_source in ('provider', 'recording')),
  /** The AI worker's short summary of the meeting. */
  summary text,
  /** The AI worker's action items, as JSON text: ["Send the signed offer by Friday", ...]. */
  action_items text,
  /**
   * waiting: the meeting is known but its transcript is not ready yet. transcribed: transcript stored,
   * summary to come. summarised: done. no_transcript: the platform has none (transcription was off).
   * failed: see error.
   */
  status text not null default 'waiting' check (status in ('waiting', 'transcribed', 'summarised', 'no_transcript', 'failed')),
  error text,
  provider_meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider_meeting_id)
);

create index meetings_user_started_idx on public.meetings (user_id, started_at desc);
create index meetings_event_idx on public.meetings (calendar_event_id) where calendar_event_id is not null;
create index meetings_to_summarise_idx on public.meetings (updated_at) where status = 'transcribed';
create trigger set_updated_at before update on public.meetings for each row execute function public.set_updated_at();

create table public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  /** Matched by email address, like calendar attendees. Null until matched, or for someone unknown. */
  contact_id uuid references public.contacts (id) on delete set null,
  name text,
  /** Their email address, when the platform gives one. */
  address text,
  is_self boolean not null default false
);

create index meeting_participants_meeting_idx on public.meeting_participants (meeting_id);
create index meeting_participants_contact_idx on public.meeting_participants (user_id, contact_id) where contact_id is not null;

alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
create policy "Read own meetings" on public.meetings for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Read own meeting participants" on public.meeting_participants for select to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.tasks, public.meetings;
