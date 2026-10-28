-- email_originals was published to Realtime with every column, including the sealed html of the email. The page
-- (awaitAnswer in apps/web/components/message-body.tsx) only uses the event as a tick (filter id=eq.<id>) and then
-- reads the row itself, so the html crossed Realtime for nothing. The publication now carries a column list
-- without html: id (the filter and the replica identity), user_id (the row policy), message_id, status, error and
-- created_at. Reading the row through the API still returns html as before.
--
-- A publication's table list cannot be changed in place for one table without replacing the whole list, so the
-- table is dropped from the publication and added again with its columns, in this one transaction, and only when
-- the publication exists, is not FOR ALL TABLES, and the server supports column lists (PostgreSQL 15 and later).
-- Replica identity is the primary key (id), which is in the list, as required for UPDATE and DELETE.
-- Brief locks only; no table is scanned. Safe to run again.

do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise notice 'column lists need PostgreSQL 15, email_originals stays published as it was';
    return;
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    return;
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'email_originals'
  ) then
    alter publication supabase_realtime drop table public.email_originals;
  end if;
  alter publication supabase_realtime add table public.email_originals (id, user_id, message_id, status, error, created_at);
end
$$;
