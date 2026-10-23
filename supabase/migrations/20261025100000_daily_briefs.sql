-- The spoken daily brief: one per user per local day. The AI worker writes it at profiles.briefing_time
-- in the user's time zone, or when the app asks for one (status 'pending'): a short script from today's
-- calendar and the conversations waiting on them, and that script spoken by Gemini as WAV audio.
-- script and audio are encrypted (field "brief"); audio is the WAV file in base64 before sealing.
--
-- It replaces the briefings placeholder from the initial schema, which nothing used and which was empty.
drop table if exists public.briefings;

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  for_date date not null,
  status text not null default 'pending' check (status in ('pending', 'working', 'ready', 'failed')),
  script text,
  audio text,
  seconds integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, for_date)
);

create index briefs_pending_idx on public.briefs (created_at) where status = 'pending';

alter table public.briefs enable row level security;

create policy "Own rows" on public.briefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The app may ask for a brief (pending), ask again, read and delete it. The script and audio are only
-- written by the worker.
revoke insert, update, truncate on public.briefs from authenticated;
grant insert (user_id, for_date, status) on public.briefs to authenticated;
grant update (status, updated_at) on public.briefs to authenticated;

alter publication supabase_realtime add table public.briefs;
