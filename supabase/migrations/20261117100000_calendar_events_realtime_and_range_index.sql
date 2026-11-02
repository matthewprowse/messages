-- Calendar page: live updates and a faster range query.
-- 1. calendar_events joins the Realtime publication, so an invite or a moved meeting the sync worker stores shows on the
--    page within a second instead of after the next visit. The row policy ("Own rows") scopes who hears what. Replica
--    identity full lets a DELETE (a cancelled meeting) carry user_id, so the page's filter on it matches.
-- 2. An index on (user_id, ends_at): the page asks for events that start in a range or are still running at its start
--    ("starts_at >= x or ends_at > x"), and with a year of events in reach the second half needs its own index.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calendar_events'
  ) then
    alter publication supabase_realtime add table public.calendar_events;
  end if;
end;
$$;

alter table public.calendar_events replica identity full;

create index if not exists calendar_events_end_idx on public.calendar_events (user_id, ends_at);
