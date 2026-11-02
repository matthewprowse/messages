-- Same-matter links between two conversations with one person (an email thread and a WhatsApp chat about the same job).
--
-- The AI worker (ai/matter.py) writes a row as status 'suggested' when the two conversations share a contact, were active
-- close together and their sealed embeddings are similar; the person answers in the app: 'linked' shows them together under one
-- heading in the person timeline, 'dismissed' stops the suggestion coming back. A row holds only ids, a score and where the
-- verdict came from, never any text. thread_a < thread_b, so a pair has exactly one row whichever way it was found.

create table public.thread_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  thread_a uuid not null references public.threads (id) on delete cascade,
  thread_b uuid not null references public.threads (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  status text not null default 'suggested' check (status in ('suggested', 'linked', 'dismissed')),
  score real not null default 0,
  -- 'similarity' (the rules alone), 'ai' (a borderline pair the model confirmed) or 'manual' (linked by hand)
  source text not null default 'similarity' check (source in ('similarity', 'ai', 'manual')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint thread_links_ordered check (thread_a < thread_b)
);

create unique index thread_links_pair_uniq on public.thread_links (user_id, thread_a, thread_b);
create index thread_links_b_idx on public.thread_links (thread_b);
create index thread_links_contact_idx on public.thread_links (contact_id) where contact_id is not null;

alter table public.thread_links enable row level security;

-- The worker (service role) inserts suggestions; a person reads their own and decides them, or links two by hand.
create policy "Read own thread links" on public.thread_links for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Decide own thread links" on public.thread_links for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Link own threads by hand" on public.thread_links for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and source = 'manual'
    and exists (select 1 from public.threads t where t.id = thread_a and t.user_id = (select auth.uid()))
    and exists (select 1 from public.threads t where t.id = thread_b and t.user_id = (select auth.uid()))
  );
create policy "Unlink own threads" on public.thread_links for delete to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.thread_links;
