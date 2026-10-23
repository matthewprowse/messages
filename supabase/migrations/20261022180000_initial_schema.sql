-- Initial schema for Messages: a unified inbox for iCloud+ Mail, Gmail, Google Calendar and WhatsApp.
--
-- Conventions
-- * Every table has user_id so row-level security is one rule everywhere: you only see your own rows.
--   The app is single-user today; this keeps multi-user a configuration change rather than a rewrite.
-- * The sync worker connects with the service role, which bypasses row-level security.
-- * Secrets (passwords, OAuth tokens, WhatsApp session keys) live in tables with RLS on and no policies,
--   so only the service role can touch them. Values are encrypted by the app before they arrive here.
-- * messages has a unique key per account and provider message ID, so a message that arrives twice
--   (reconnects, overlapping syncs) is only ever stored once.

create extension if not exists vector with schema extensions;

-- Keeps updated_at current on every table that has one.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- You
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  about text,
  important_people text,
  timezone text not null default 'Europe/London',
  quiet_start time not null default '22:00',
  quiet_end time not null default '07:30',
  push_urgent boolean not null default true,
  push_important boolean not null default true,
  auto_draft_top boolean not null default true,
  whatsapp_read_receipts boolean not null default true,
  briefing_time time not null default '07:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Connected accounts and sync bookkeeping
-- ---------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('icloud', 'gmail', 'google_calendar', 'whatsapp')),
  label text not null,
  address text not null,                    -- email address or phone number
  status text not null default 'disconnected'
    check (status in ('connecting', 'syncing', 'connected', 'disconnected', 'error')),
  status_detail text,                       -- e.g. the reason a reconnect is needed
  qr_code text,                             -- WhatsApp pairing code while linking; cleared once linked
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, address)
);

-- Encrypted credentials: app-specific password, OAuth refresh token. Service role only.
create table public.account_credentials (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

-- WhatsApp (Baileys) session keys, encrypted. Service role only.
create table public.whatsapp_auth_keys (
  account_id uuid not null references public.accounts (id) on delete cascade,
  key_type text not null,
  key_id text not null,
  ciphertext text not null,
  updated_at timestamptz not null default now(),
  primary key (account_id, key_type, key_id)
);

-- Where each sync left off, so reconnects fill gaps instead of re-importing.
-- IMAP uses uid_validity and last_uid per folder; Gmail uses history_id; Calendar uses sync_token.
create table public.sync_state (
  account_id uuid not null references public.accounts (id) on delete cascade,
  scope text not null,                      -- folder name, 'history' or a calendar ID
  uid_validity bigint,
  last_uid bigint,
  history_id text,
  sync_token text,
  updated_at timestamptz not null default now(),
  primary key (account_id, scope)
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  company text,
  role text,
  relationship text,                        -- e.g. family, friend, colleague, client, investor, recruiter
  style_note text,                          -- learned summary of how you write to this person
  style_updated_at timestamptz,
  ai_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One person, many addresses and numbers. Values are stored normalised (lowercase email, E.164 phone).
create table public.contact_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  kind text not null check (kind in ('email', 'phone', 'whatsapp')),
  value text not null,
  source text not null default 'header'
    check (source in ('header', 'address_book', 'signature', 'whatsapp', 'manual')),
  created_at timestamptz not null default now(),
  unique (user_id, kind, value)
);

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  provider_thread_id text not null,         -- Gmail thread ID, root Message-ID, or WhatsApp chat ID
  is_group boolean not null default false,
  group_name text,
  subject text,
  status text not null default 'inbox' check (status in ('inbox', 'archived')),
  unread_count integer not null default 0,
  pinned boolean not null default false,
  triage_enabled boolean not null default true,  -- WhatsApp groups default to off, set by the worker
  last_message_at timestamptz,
  last_message_preview text,
  -- Latest triage, copied from message_ai so the list loads from one table.
  priority text check (priority in ('urgent', 'important', 'normal', 'low')),
  category text check (category in ('personal', 'work', 'needs_reply', 'fyi', 'newsletter', 'notification')),
  summary text,
  needs_reply boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider_thread_id)
);

create table public.thread_participants (
  thread_id uuid not null references public.threads (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (thread_id, contact_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  provider_message_id text not null,        -- Message-ID header, Gmail ID or WhatsApp message key
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_contact_id uuid references public.contacts (id) on delete set null,
  sender_address text,
  sent_at timestamptz not null,
  subject text,
  body_text text,
  body_html text,
  in_reply_to text,                         -- email threading headers, used when replying
  reference_ids text[] not null default '{}',
  is_read boolean not null default false,
  provider_meta jsonb not null default '{}', -- e.g. IMAP folder and UID, needed to archive or flag
  created_at timestamptz not null default now(),
  unique (account_id, provider_message_id)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  filename text not null,
  mime_type text,
  kind text not null default 'file' check (kind in ('image', 'pdf', 'video', 'file')),
  size_bytes bigint,
  storage_path text,                        -- set once downloaded into the attachments bucket
  provider_attachment_id text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI: triage, drafts and what it learns from you
-- ---------------------------------------------------------------------------

-- The embedding column is added with the AI worker, once the embedding model and its size are chosen.
create table public.message_ai (
  message_id uuid primary key references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  priority text not null check (priority in ('urgent', 'important', 'normal', 'low')),
  category text not null check (category in ('personal', 'work', 'needs_reply', 'fyi', 'newsletter', 'notification')),
  summary text not null,
  needs_reply boolean not null default false,
  model text,
  created_at timestamptz not null default now()
);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  body text not null,
  tone text not null default 'default' check (tone in ('default', 'shorter', 'formal', 'casual', 'custom')),
  instruction text,
  status text not null default 'active' check (status in ('active', 'sent', 'discarded')),
  model text,
  created_at timestamptz not null default now()
);

-- What the AI drafted next to what you actually sent. The main signal it learns from.
create table public.draft_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  draft_id uuid references public.drafts (id) on delete set null,
  thread_id uuid not null references public.threads (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  draft_body text not null,
  sent_body text not null,
  edit_ratio real,                          -- 0 means sent untouched, 1 means fully rewritten
  created_at timestamptz not null default now()
);

-- Learned rules about how you write, e.g. "Signs off 'Matt', never 'Best'".
create table public.style_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null check (scope in ('global', 'contact', 'relationship')),
  contact_id uuid references public.contacts (id) on delete cascade,
  relationship text,
  rule text not null,
  support_count integer not null default 1,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'contact') = (contact_id is not null)),
  check ((scope = 'relationship') = (relationship is not null))
);

create table public.writing_examples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  situation text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.priority_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('always_important', 'never_important')),
  target text not null,                     -- an address, a phone number or a whole domain
  created_at timestamptz not null default now(),
  unique (user_id, kind, target)
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  value text not null check (value in ('important', 'not_important')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Calendar, briefings and notifications
-- ---------------------------------------------------------------------------

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  calendar_id text not null,
  provider_event_id text not null,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  attendees jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  unique (account_id, provider_event_id)
);

create table public.briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  for_date date not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, for_date)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes for the screens that must load fast
-- ---------------------------------------------------------------------------

create index threads_inbox_idx on public.threads (user_id, status, last_message_at desc);
create index threads_priority_idx on public.threads (user_id, priority) where status = 'inbox';
create index messages_thread_idx on public.messages (thread_id, sent_at);
create index messages_sender_idx on public.messages (sender_contact_id);
create index contact_identities_contact_idx on public.contact_identities (contact_id);
create index thread_participants_contact_idx on public.thread_participants (contact_id);
create index attachments_message_idx on public.attachments (message_id);
create index drafts_thread_idx on public.drafts (thread_id) where status = 'active';
create index draft_outcomes_contact_idx on public.draft_outcomes (contact_id, created_at desc);
create index style_rules_user_idx on public.style_rules (user_id) where enabled;
create index calendar_events_time_idx on public.calendar_events (user_id, starts_at);

-- Foreign-key indexes the security and performance advisors expect.
create index accounts_user_idx on public.accounts (user_id);
create index threads_account_idx on public.threads (account_id);
create index messages_account_idx on public.messages (account_id);
create index messages_user_idx on public.messages (user_id);
create index contacts_user_idx on public.contacts (user_id);
create index thread_participants_user_idx on public.thread_participants (user_id);
create index attachments_user_idx on public.attachments (user_id);
create index message_ai_user_idx on public.message_ai (user_id);
create index drafts_user_idx on public.drafts (user_id);
create index draft_outcomes_user_idx on public.draft_outcomes (user_id);
create index draft_outcomes_draft_idx on public.draft_outcomes (draft_id);
create index draft_outcomes_thread_idx on public.draft_outcomes (thread_id);
create index style_rules_contact_idx on public.style_rules (contact_id);
create index writing_examples_user_idx on public.writing_examples (user_id);
create index feedback_user_idx on public.feedback (user_id);
create index feedback_thread_idx on public.feedback (thread_id);
create index feedback_message_idx on public.feedback (message_id);
create index calendar_events_account_idx on public.calendar_events (account_id);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.accounts for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.account_credentials for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.whatsapp_auth_keys for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.sync_state for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.contacts for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.threads for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.style_rules for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.calendar_events for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Secrets and sync bookkeeping: RLS on, no policies, so only the service role (the worker) can read them.
alter table public.account_credentials enable row level security;
alter table public.whatsapp_auth_keys enable row level security;
alter table public.sync_state enable row level security;

-- Everything else: signed-in users can read and change only their own rows.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'accounts', 'contacts', 'contact_identities', 'threads', 'thread_participants',
    'messages', 'attachments', 'message_ai', 'drafts', 'draft_outcomes', 'style_rules',
    'writing_examples', 'priority_rules', 'feedback', 'calendar_events', 'briefings', 'push_subscriptions'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "Own rows" on public.%I for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: the inbox, open conversation and connection status update live
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.accounts, public.threads, public.messages, public.drafts;

-- ---------------------------------------------------------------------------
-- Attachment storage: private bucket, files filed under the owner's user ID
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "Read own attachments" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
