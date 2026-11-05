-- Every cover period is logged, and the person covered can see it (security audit 2026-11-04, Medium 10).
--
-- set_cover (20261104100000_team_after_launch.sql) lets an owner or admin name anyone, themselves included, as cover
-- for any active member for up to six months, with no check that the member is away. While it runs, i_cover makes
-- can_read_thread and is_assignee true for every one of that member's work chats: read and reply. 20261124140000
-- put every assignment on the record so that an owner or admin taking a chat shows up for its agent; cover was the
-- other door, and nothing recorded it beyond the workspace_cover row itself.
--
--   * workspace_cover_log: one row per grant and one per early end (workspace, who is covered, who covers, who did it,
--     the dates, whether the person granted it to themselves, when). Ids and times only. Written by a trigger on
--     workspace_cover, so set_cover, end_cover and any later path are all logged. Nobody writes it from the app.
--   * Read by the person covered, the person covering, whoever granted or ended it, and the team's owner. Published to
--     Realtime, so the app can tell the member as it happens ("Sam set themselves as your cover until Friday").
-- Cover is not blocked: people are away and someone has to answer. This is a record, not a gate.

create table public.workspace_cover_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  cover_period_id uuid not null,                     -- the workspace_cover row; no foreign key, the log outlives it
  absent_id uuid not null references auth.users (id) on delete cascade,
  cover_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event text not null check (event in ('granted', 'ended')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  self_granted boolean not null default false,       -- the person covering set it up themselves
  logged_at timestamptz not null default now()
);
create index workspace_cover_log_absent_idx on public.workspace_cover_log (absent_id, logged_at desc);
create index workspace_cover_log_cover_idx on public.workspace_cover_log (cover_id, logged_at desc);
create index workspace_cover_log_workspace_idx on public.workspace_cover_log (workspace_id, logged_at desc);

alter table public.workspace_cover_log enable row level security;
revoke all on public.workspace_cover_log from anon, authenticated;
grant select on public.workspace_cover_log to authenticated;

create policy "Read cover that concerns you" on public.workspace_cover_log for select to authenticated
  using (
    workspace_id = (select public.my_workspace_id())
    and (
      absent_id = (select auth.uid())
      or cover_id = (select auth.uid())
      or actor_id = (select auth.uid())
      or (select public.my_workspace_role()) = 'owner'
    )
  );

create function public.log_workspace_cover() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.workspace_cover_log (workspace_id, cover_period_id, absent_id, cover_id, actor_id, event, starts_at, ends_at, self_granted)
    values (new.workspace_id, new.id, new.absent_id, new.cover_id, new.created_by, 'granted', new.starts_at, new.ends_at, new.created_by is not distinct from new.cover_id);
  elsif tg_op = 'UPDATE' and new.ended_at is not null and old.ended_at is null then
    insert into public.workspace_cover_log (workspace_id, cover_period_id, absent_id, cover_id, actor_id, event, starts_at, ends_at)
    values (new.workspace_id, new.id, new.absent_id, new.cover_id, new.ended_by, 'ended', new.starts_at, new.ends_at);
  end if;
  return null;
end;
$$;
revoke execute on function public.log_workspace_cover() from public, anon, authenticated;

create trigger workspace_cover_log after insert or update on public.workspace_cover
  for each row execute function public.log_workspace_cover();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_cover_log'
  ) then
    alter publication supabase_realtime add table public.workspace_cover_log;
  end if;
end $$;
