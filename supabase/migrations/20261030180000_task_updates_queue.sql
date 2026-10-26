-- The shared tasks layer's queue (apps/worker/src/tasks/index.ts). Two additions to task_updates, nothing
-- else in the foundation's tables changes:
--
--   status 'updating'  the worker claims a queued row before it asks the provider, so a row a restart cut
--                      off can be told from one still waiting, and is failed rather than repeated blind.
--   Realtime           the worker hears a tick at once instead of at its next poll, and the app hears its
--                      own rows settle (row-level security already limits it to them).

alter table public.task_updates drop constraint task_updates_status_check;
alter table public.task_updates add constraint task_updates_status_check
  check (status in ('queued', 'updating', 'done', 'failed'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_updates'
  ) then
    alter publication supabase_realtime add table public.task_updates;
  end if;
end;
$$;
