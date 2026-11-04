-- Every assignment of a work chat is logged, and the people it concerns can see it (security audit 2026-11-03, M10).
--
-- An owner or admin may assign any work chat of their team, themselves included (assign_thread), and an assignee reads
-- the chat. Until now nothing recorded that, unlike a Compliance open, so an owner or admin could read a colleague's chat
-- by giving it to themselves with no trace. 20261104100000_team_after_launch.sql says owners and admins "never read a work
-- chat that is not assigned to them": that stays true, and now every assignment is on the record.
--
--   * thread_assignment_log: one row per new assignment (thread, the chat's agent, who it went to, who gave it, who else
--     held it at that moment, whether the person gave it to themselves, when). Ids and a time only, no content. Written by
--     a trigger on thread_assignments, so assign_thread, assign_agent_chats, assign_inbox_chat and any later path are all
--     logged. Nobody writes it from the app.
--   * Read by the chat's agent, by the person it was assigned to, by anyone who already held the chat when it was assigned
--     again, and by the team's owner. So an owner or admin taking a chat that is someone else's (or already assigned to
--     someone) shows up for that person, who the app can tell ("Sam gave themselves access to this chat").
--   * Published to Realtime so the app can show it as it happens.
--   * assign_inbox_chat replaced the inbox chat's assignee by deleting before inserting, so the log could not say who had
--     it. It now inserts the new assignee first and then drops the others, which ends in the same state and lets the log
--     name the person it was taken from. Assigning a chat to the person who already has it changes nothing and logs nothing.
-- Legitimate reassignment is not blocked: this is a record, not a gate.
-- Deletions are not logged: a removal grants nobody any reading, and a delete cascading from a deleted chat or person
-- must never fail because of a log row.

create table public.thread_assignment_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  agent_id uuid references auth.users (id) on delete cascade,
  assignee_id uuid not null references auth.users (id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null,
  previous_assignees uuid[] not null default '{}',
  self_assigned boolean not null default false,
  assigned_at timestamptz not null default now()
);
create index thread_assignment_log_thread_idx on public.thread_assignment_log (thread_id, assigned_at desc);
create index thread_assignment_log_agent_idx on public.thread_assignment_log (agent_id, assigned_at desc);
create index thread_assignment_log_assignee_idx on public.thread_assignment_log (assignee_id);
create index thread_assignment_log_assigned_by_idx on public.thread_assignment_log (assigned_by);
create index thread_assignment_log_workspace_idx on public.thread_assignment_log (workspace_id, assigned_at desc);

alter table public.thread_assignment_log enable row level security;
revoke all on public.thread_assignment_log from anon, authenticated;
grant select on public.thread_assignment_log to authenticated;

create policy "Read assignments that concern you" on public.thread_assignment_log for select to authenticated
  using (
    workspace_id = (select public.my_workspace_id())
    and (
      agent_id = (select auth.uid())
      or assignee_id = (select auth.uid())
      or (select auth.uid()) = any (previous_assignees)
      or (select public.my_workspace_role()) = 'owner'
    )
  );

-- Runs after the new assignment row is in, so "who else held it" is every other assignee of the chat at that moment.
create function public.log_thread_assignment() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.thread_assignment_log (workspace_id, thread_id, agent_id, assignee_id, assigned_by, previous_assignees, self_assigned)
  select new.workspace_id, new.thread_id, t.user_id, new.assignee_id, new.assigned_by,
         coalesce((
           select array_agg(a.assignee_id order by a.created_at)
           from public.thread_assignments a
           where a.thread_id = new.thread_id and a.assignee_id <> new.assignee_id
         ), '{}'),
         new.assigned_by is not distinct from new.assignee_id
  from public.threads t
  where t.id = new.thread_id;
  return null;
end;
$$;
revoke execute on function public.log_thread_assignment() from public, anon, authenticated;

create trigger thread_assignments_log after insert on public.thread_assignments
  for each row execute function public.log_thread_assignment();

-- 20261103100000's, with the new assignee inserted before the others are dropped (see the header). Same checks, same
-- grants.
create or replace function public.assign_inbox_chat(p_thread uuid, p_assignee uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_thread public.threads;
  v_role text;
begin
  select t.* into v_thread from public.threads t where t.id = p_thread;
  if not found or v_thread.workspace_id is null or v_thread.shared_by is distinct from 'account' then
    raise exception 'That chat is not in a shared inbox' using errcode = 'P0002';
  end if;
  select m.role into v_role from public.workspace_members m
  where m.workspace_id = v_thread.workspace_id and m.user_id = v_me and m.status = 'active';
  if v_role is null or v_role = 'compliance'
     or not (v_role in ('owner', 'admin') or exists (select 1 from public.workspace_inbox_access x where x.account_id = v_thread.account_id and x.user_id = v_me)) then
    raise exception 'You do not have access to this inbox' using errcode = '42501';
  end if;
  if p_assignee is not null and not exists (
    select 1 from public.workspace_inbox_access x
    join public.workspace_members m on m.workspace_id = x.workspace_id and m.user_id = x.user_id and m.status = 'active' and m.role <> 'compliance'
    where x.account_id = v_thread.account_id and x.user_id = p_assignee
  ) then
    raise exception 'That person does not have access to this inbox' using errcode = '22023';
  end if;
  if p_assignee is not null then
    insert into public.thread_assignments (thread_id, workspace_id, assignee_id, assigned_by)
    values (p_thread, v_thread.workspace_id, p_assignee, v_me)
    on conflict (thread_id, assignee_id) do nothing;
  end if;
  delete from public.thread_assignments a where a.thread_id = p_thread and a.assignee_id is distinct from p_assignee;
end;
$$;
revoke execute on function public.assign_inbox_chat(uuid, uuid) from public, anon;
grant execute on function public.assign_inbox_chat(uuid, uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'thread_assignment_log'
  ) then
    alter publication supabase_realtime add table public.thread_assignment_log;
  end if;
end $$;
