-- Team key rotation (docs/PLAN.md, Security and Cost Review, item 6). A workspace's data key now has versions:
-- when a member is removed, the next version is made and everything sealed with the team's key is re-sealed under
-- it, so the copy of the old key a removed member may hold reads nothing new and, once the job has run, nothing
-- old. The exact rules are in the comment at the top of apps/worker/src/share/rotate.ts.
--
--   key_version  1 for every key made so far. The highest version is the current one; new values are sealed with it.
--   retired_at   set by the re-seal job when no value is left under the version. A retired version is no longer
--                handed out to decrypt with or read by the workers, except the first version, which stays as the
--                "index root": the team's blind indexes are always made with the first version's key so that a
--                rotation does not change the tokens the client list is matched on. Other retired rows are kept as an
--                audit trail and could be deleted once the backups that may hold values sealed under them age out.
--
-- Values stay tagged "t1:" whichever version sealed them. A reader tries the current version first, then the older
-- ones, which is cheap because AES-GCM rejects a wrong key at once and only the re-seal window has more than one.

alter table public.team_keys
  add column key_version integer not null default 1 check (key_version >= 1),
  add column retired_at timestamptz;

alter table public.team_keys drop constraint team_keys_pkey;
alter table public.team_keys add primary key (workspace_id, key_version);

-- Whether someone has been removed since the workspace's current key was made, which is when a new version is due.
-- Derived rather than stored, so it cannot be forgotten: remove_member needs no change. The comparison uses the
-- database's own clock for both dates. A new version made in a transaction that started before the removal
-- committed still counts as due, which only ever means one extra rotation.
create function public.team_key_rotation_due(p_workspace uuid) returns boolean
  language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    (select max(m.left_at) from public.workspace_members m where m.workspace_id = p_workspace and m.status = 'removed')
      > (select max(k.created_at) from public.team_keys k where k.workspace_id = p_workspace),
    false)
$$;
revoke execute on function public.team_key_rotation_due(uuid) from public, anon, authenticated;
grant execute on function public.team_key_rotation_due(uuid) to service_role;

-- Workspaces with a version still to retire: an unretired version older than the current one. The re-seal job
-- works these.
create function public.team_keys_to_reseal() returns table (workspace_id uuid, current_version integer)
  language sql stable security invoker set search_path = ''
as $$
  select k.workspace_id, c.v
  from public.team_keys k
  join (select t.workspace_id, max(t.key_version) as v from public.team_keys t group by t.workspace_id) c on c.workspace_id = k.workspace_id
  where k.retired_at is null and k.key_version < c.v
  group by k.workspace_id, c.v
$$;
revoke execute on function public.team_keys_to_reseal() from public, anon, authenticated;
grant execute on function public.team_keys_to_reseal() to service_role;
