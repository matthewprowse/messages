-- Notes tied to the people, conversations and meetings they are about, and archived notes.
--
-- A link points a note at exactly one contact, conversation or calendar event; a note can have many links and a
-- target many notes. Links are rows of their own (not a column on notes) so a note's text is never rewritten to
-- link it, and a deleted contact, conversation or event takes its links with it, never the note. The note text
-- itself stays sealed in the browser; a link holds only ids.
--
-- notes.archived hides a note from the main list without deleting it. Archiving also turns Use in Drafts off (the
-- app does that in the same write), because the AI worker reads notes by use_in_drafts alone.

alter table public.notes add column archived boolean not null default false;

create table public.note_links (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  thread_id uuid references public.threads (id) on delete cascade,
  event_id uuid references public.calendar_events (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint note_links_one_target check (num_nonnulls(contact_id, thread_id, event_id) = 1)
);

-- One link per note and target; the targets are read back by id, so each gets an index.
create unique index note_links_contact_uniq on public.note_links (note_id, contact_id) where contact_id is not null;
create unique index note_links_thread_uniq on public.note_links (note_id, thread_id) where thread_id is not null;
create unique index note_links_event_uniq on public.note_links (note_id, event_id) where event_id is not null;
create index note_links_contact_idx on public.note_links (contact_id) where contact_id is not null;
create index note_links_thread_idx on public.note_links (thread_id) where thread_id is not null;
create index note_links_event_idx on public.note_links (event_id) where event_id is not null;
create index note_links_user_idx on public.note_links (user_id);

alter table public.note_links enable row level security;

create policy "Own note links" on public.note_links for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
  );

alter publication supabase_realtime add table public.note_links;
