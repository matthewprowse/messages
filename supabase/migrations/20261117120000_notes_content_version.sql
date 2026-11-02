-- Notes: the edited time becomes a content version, and notes join Realtime.
--
-- The app saves a note only if the row still has the edited time it last read, so a second tab or device is never
-- overwritten silently. Until now the set_updated_at trigger moved that time on every update, so pinning a note or
-- marking it Use in Drafts would have made the next text save look like a conflict. From now on updated_at moves
-- only when the title, text or excerpt change. (The app also copes if this migration has not been applied yet.)
--
-- Notes are added to the Realtime publication so an open Notes page sees a change made elsewhere within a second.
-- Row level security still decides who receives a change.

create or replace function public.notes_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.excerpt is distinct from old.excerpt then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.notes;
create trigger set_updated_at before update on public.notes for each row execute function public.notes_touch();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes') then
    alter publication supabase_realtime add table public.notes;
  end if;
end;
$$;
