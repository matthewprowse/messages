-- Snooze, Remind If No Reply, labels and saved views.
--
-- Snooze and reminders live on the thread: snoozed_until is when it returns, snooze_kind says whether it was a plain
-- snooze or a "remind me if no reply", and snoozed_at is when it was set. The app hides a thread while snoozed_until
-- is in the future and marks it Snoozed or Follow Up once the time has passed, so nothing needs a job to bring it back.
-- follow_ups (the AI's note that a message expects an answer) is a different thing and is left as it is.
-- A new inbound message cancels either kind: the trigger below clears them, but only for a message sent after the
-- snooze was set, so older mail arriving late from an import does not undo it.
--
-- Label names and saved view names are the user's own text, so the browser seals them with the user's key (field
-- "name"). Colours are a fixed set of palette names.

alter table public.threads
  add column snoozed_until timestamptz,
  add column snooze_kind text check (snooze_kind in ('snooze', 'reminder')),
  add column snoozed_at timestamptz;

create index threads_snoozed_idx on public.threads (user_id, snoozed_until) where snoozed_until is not null;

create function public.clear_snooze_on_inbound() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'inbound' then
    update public.threads
      set snoozed_until = null, snooze_kind = null, snoozed_at = null
      where id = new.thread_id and snoozed_until is not null and (snoozed_at is null or new.sent_at > snoozed_at);
  end if;
  return new;
end;
$$;

create trigger messages_clear_snooze after insert on public.messages
  for each row execute function public.clear_snooze_on_inbound();

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  color text not null default 'gray' check (color in ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')),
  created_at timestamptz not null default now()
);

create index labels_user_idx on public.labels (user_id, created_at);

create table public.thread_labels (
  thread_id uuid not null references public.threads (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, label_id)
);

create index thread_labels_label_idx on public.thread_labels (label_id);
create index thread_labels_user_idx on public.thread_labels (user_id);

-- A view is a saved Inbox address: which view, which filter and which label.
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  view text not null default 'all',
  filter text not null default 'none',
  label_id uuid references public.labels (id) on delete set null,
  created_at timestamptz not null default now()
);

create index saved_views_user_idx on public.saved_views (user_id, created_at);

alter table public.labels enable row level security;
alter table public.thread_labels enable row level security;
alter table public.saved_views enable row level security;

create policy "Own labels" on public.labels for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- A label can only be put on your own threads, and only your own labels.
create policy "Own thread labels" on public.thread_labels for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.threads t where t.id = thread_id and t.user_id = (select auth.uid()))
    and exists (select 1 from public.labels l where l.id = label_id and l.user_id = (select auth.uid()))
  );

create policy "Own saved views" on public.saved_views for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
