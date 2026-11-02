-- Matters (docs/PLAN.md, Client Timeline): a deal, listing, policy or matter kept for one contact, with a short name, so a
-- client's timeline can be narrowed to the one job. Light on purpose: a name, a kind and open or closed. No stages, no values,
-- no pipeline.
--
--   matters       one row per matter. The name is sealed with the user's key (field "name"), so the database never sees it.
--   matter_links  what belongs to a matter: a conversation, a note, a file or a meeting, exactly one per row. Ids only. A matter
--                 can hold several conversations; the same item can sit in more than one matter.
--
-- Both are written and read by the signed-in user in the browser. The worker and the AI worker do not touch them.

create table public.matters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  name text not null,
  kind text not null default 'matter' check (kind in ('deal', 'listing', 'policy', 'matter')),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index matters_user_idx on public.matters (user_id);
create index matters_contact_idx on public.matters (contact_id);

alter table public.matters enable row level security;
create policy "Own matters" on public.matters for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = (select auth.uid()))
  );

create table public.matter_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  matter_id uuid not null references public.matters (id) on delete cascade,
  thread_id uuid references public.threads (id) on delete cascade,
  note_id uuid references public.notes (id) on delete cascade,
  attachment_id uuid references public.attachments (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint matter_links_one_target check (num_nonnulls(thread_id, note_id, attachment_id, meeting_id) = 1)
);

-- One link per matter and item; the partial indexes are what stops a repeat, as for note_links.
create unique index matter_links_thread_uniq on public.matter_links (matter_id, thread_id) where thread_id is not null;
create unique index matter_links_note_uniq on public.matter_links (matter_id, note_id) where note_id is not null;
create unique index matter_links_attachment_uniq on public.matter_links (matter_id, attachment_id) where attachment_id is not null;
create unique index matter_links_meeting_uniq on public.matter_links (matter_id, meeting_id) where meeting_id is not null;
create index matter_links_user_idx on public.matter_links (user_id);
create index matter_links_thread_idx on public.matter_links (thread_id) where thread_id is not null;
create index matter_links_note_idx on public.matter_links (note_id) where note_id is not null;
create index matter_links_attachment_idx on public.matter_links (attachment_id) where attachment_id is not null;
create index matter_links_meeting_idx on public.matter_links (meeting_id) where meeting_id is not null;

alter table public.matter_links enable row level security;
create policy "Own matter links" on public.matter_links for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.matters m where m.id = matter_id and m.user_id = (select auth.uid()))
  );
