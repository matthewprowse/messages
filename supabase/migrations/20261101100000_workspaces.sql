-- Workspaces and members: step 1 of Teams (docs/PLAN.md, Teams). A workspace is a business team.
-- `organizations` already means client companies, so the team is a workspace and never an organization.
--
--   * workspaces: the business name (account detail, plain text, never message content), its owner, the seats
--     it pays for and the strict-sharing setting. Seats are set by the app's owner on /admin until billing exists.
--   * workspace_members: role (owner, admin, compliance, member) and status (invited, active, removed). One
--     active workspace per person. Removing someone ends their membership; it never deletes their data.
--   * workspace_invites: an invite link, stored only as a SHA-256 hash of its token, expiring in 7 days.
--     'invited' is kept in the member status list for later; a pending invite is a row in workspace_invites.
--   * Reading goes through row-level security (members read their own workspace and its member list);
--     every change goes through the functions below, each checking who is asking.
--   * The Compliance role only exists while strict_sharing is on. The functions enforce it, and turning
--     strict sharing off turns Compliance members into Members.
--   * A team pools its storage and AI allowance: seats x the per-seat amount, shared by its active members.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  owner_id uuid references auth.users (id) on delete set null,   -- empty until the owner accepts their invite
  seats integer not null default 5 check (seats >= 5),
  strict_sharing boolean not null default false,
  waitlist_id uuid unique references public.waitlist (id) on delete set null,   -- the request it was approved from
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'compliance', 'member')),
  status text not null check (status in ('invited', 'active', 'removed')),
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
-- One active workspace per person.
create unique index workspace_members_one_active on public.workspace_members (user_id) where status = 'active';

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1 and length(email) <= 320),
  role text not null check (role in ('owner', 'admin', 'compliance', 'member')),
  token_hash text not null unique,                       -- SHA-256 of the token, hex; the token itself is never stored
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
-- One open invite per address in a workspace; sending again replaces it.
create unique index workspace_invites_open on public.workspace_invites (workspace_id, email) where accepted_at is null;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;   -- no policies: only the functions below read or write it
revoke all on public.workspaces, public.workspace_members, public.workspace_invites from anon, authenticated;
grant select on public.workspaces, public.workspace_members to authenticated;

-- ---------------------------------------------------------------------------
-- Who the caller is
-- ---------------------------------------------------------------------------

-- The signed-in person's active workspace, or null. For the policies of later steps.
create function public.my_workspace_id() returns uuid
  language sql stable security definer set search_path = ''
as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = (select auth.uid()) and m.status = 'active'
$$;
revoke execute on function public.my_workspace_id() from public, anon;
grant execute on function public.my_workspace_id() to authenticated;

-- Their role in it, or null.
create function public.my_workspace_role() returns text
  language sql stable security definer set search_path = ''
as $$
  select m.role from public.workspace_members m
  where m.user_id = (select auth.uid()) and m.status = 'active'
$$;
revoke execute on function public.my_workspace_role() from public, anon;
grant execute on function public.my_workspace_role() to authenticated;

create policy "Members read their workspace" on public.workspaces for select to authenticated
  using (id = public.my_workspace_id());

-- Your own row, even once removed, and the active members of your workspace; owners and admins also see who left.
create policy "Members read the member list" on public.workspace_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (workspace_id = public.my_workspace_id() and (status = 'active' or public.my_workspace_role() in ('owner', 'admin')))
  );

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------

-- Makes an invite and returns its token, shown once. An open invite for the same address is replaced.
-- Only the functions below call this.
create function public.issue_invite(p_workspace uuid, p_email text, p_role text, p_by uuid) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  delete from public.workspace_invites i where i.workspace_id = p_workspace and i.email = p_email and i.accepted_at is null;
  insert into public.workspace_invites (workspace_id, email, role, token_hash, created_by)
  values (p_workspace, p_email, p_role, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), p_by);
  return v_token;
end;
$$;
revoke execute on function public.issue_invite(uuid, text, text, uuid) from public, anon, authenticated;

-- The app's owner approves a team request on /admin: this makes the workspace and the invite for its owner.
-- Returns the workspace and the invite's token, shown once. Seats are at least 5.
create function public.create_workspace(p_name text, p_seats integer, p_owner_email text, p_waitlist_id uuid default null)
  returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
  v_workspace uuid;
begin
  if not public.is_analytics_owner() then
    raise exception 'Only the owner of this app can create a team' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 200 then
    raise exception 'Enter the business name' using errcode = '22023';
  end if;
  if position('@' in v_email) < 2 or length(v_email) > 320 then
    raise exception 'Enter a valid email address for the owner' using errcode = '22023';
  end if;
  if p_waitlist_id is not null and exists (select 1 from public.workspaces w where w.waitlist_id = p_waitlist_id) then
    raise exception 'A team was already created for this request' using errcode = '23505';
  end if;

  insert into public.workspaces (name, seats, waitlist_id)
  values (v_name, greatest(5, coalesce(p_seats, 5)), p_waitlist_id)
  returning id into v_workspace;

  return jsonb_build_object(
    'workspace_id', v_workspace,
    'token', public.issue_invite(v_workspace, v_email, 'owner', (select auth.uid()))
  );
end;
$$;
revoke execute on function public.create_workspace(text, integer, text, uuid) from public, anon;
grant execute on function public.create_workspace(text, integer, text, uuid) to authenticated;

-- A new link for a team whose owner has not joined yet (the first was lost or has expired). App owner only.
create function public.reissue_owner_invite(p_workspace uuid) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
begin
  if not public.is_analytics_owner() then
    raise exception 'Only the owner of this app can do that' using errcode = '42501';
  end if;
  if exists (select 1 from public.workspaces w where w.id = p_workspace and w.owner_id is not null) then
    raise exception 'This team already has an owner' using errcode = '22023';
  end if;
  select i.email into v_email from public.workspace_invites i
  where i.workspace_id = p_workspace and i.role = 'owner'
  order by i.created_at desc limit 1;
  if v_email is null then
    raise exception 'No owner invite to send again' using errcode = 'P0002';
  end if;
  return public.issue_invite(p_workspace, v_email, 'owner', (select auth.uid()));
end;
$$;
revoke execute on function public.reissue_owner_invite(uuid) from public, anon;
grant execute on function public.reissue_owner_invite(uuid) to authenticated;

-- An owner or admin invites someone to their workspace. Returns the invite's token, shown once; nothing is
-- emailed. Only the owner makes admins. A pending invite holds a seat.
create function public.invite_member(p_email text, p_role text) returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_workspace uuid;
  v_my_role text;
  v_seats integer;
  v_strict boolean;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select m.workspace_id, m.role into v_workspace, v_my_role
  from public.workspace_members m where m.user_id = v_me and m.status = 'active';
  if v_workspace is null or v_my_role not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can invite people' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'compliance', 'member') then
    raise exception 'Choose a role' using errcode = '22023';
  end if;
  if p_role = 'admin' and v_my_role <> 'owner' then
    raise exception 'Only the owner can make someone an admin' using errcode = '42501';
  end if;
  if position('@' in v_email) < 2 or length(v_email) > 320 then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;

  -- Locks the workspace so two invites at once cannot both take the last seat.
  select w.seats, w.strict_sharing into v_seats, v_strict from public.workspaces w where w.id = v_workspace for update;
  if p_role = 'compliance' and not v_strict then
    raise exception 'The Compliance role needs strict sharing to be on' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.workspace_members m join auth.users u on u.id = m.user_id
    where m.workspace_id = v_workspace and m.status = 'active' and lower(u.email) = v_email
  ) then
    raise exception 'That person is already in your team' using errcode = '23505';
  end if;
  if (select count(*) from public.workspace_members m where m.workspace_id = v_workspace and m.status = 'active')
     + (select count(*) from public.workspace_invites i
        where i.workspace_id = v_workspace and i.accepted_at is null and i.expires_at > now() and i.email <> v_email) >= v_seats then
    raise exception 'All of your seats are in use' using errcode = '22023';
  end if;

  return public.issue_invite(v_workspace, v_email, p_role, v_me);
end;
$$;
revoke execute on function public.invite_member(text, text) from public, anon;
grant execute on function public.invite_member(text, text) to authenticated;

-- Takes an invite back before it is used.
create function public.revoke_invite(p_invite uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(public.my_workspace_role(), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can do that' using errcode = '42501';
  end if;
  delete from public.workspace_invites i
  where i.id = p_invite and i.workspace_id = public.my_workspace_id() and i.accepted_at is null;
end;
$$;
revoke execute on function public.revoke_invite(uuid) from public, anon;
grant execute on function public.revoke_invite(uuid) to authenticated;

-- What the invite page shows before anyone joins: the team, the role and the address it was sent to. Null when the
-- link is not valid, used or expired. The token is the secret, so it is open to anyone who holds it.
create function public.invite_preview(p_token text) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('workspace', w.name, 'role', i.role, 'email', i.email, 'strict_sharing', w.strict_sharing, 'expires_at', i.expires_at)
  from public.workspace_invites i join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
    and i.accepted_at is null and i.expires_at > now()
$$;
revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- Joins the signed-in person to the workspace the token was made for. It must have been sent to their own
-- sign-in address. Returns the workspace.
create function public.accept_invite(p_token text) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_invite public.workspace_invites;
  v_workspace public.workspaces;
  v_email text;
begin
  if v_user is null then
    raise exception 'Sign in to join a team' using errcode = '28000';
  end if;
  select i.* into v_invite from public.workspace_invites i
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
    and i.accepted_at is null and i.expires_at > now()
  for update;
  if not found then
    raise exception 'This invite link is not valid, or it has expired' using errcode = 'P0002';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_user;
  if v_email is distinct from v_invite.email then
    raise exception 'This invite was sent to a different email address. Sign in with the address it was sent to' using errcode = '42501';
  end if;

  select w.* into v_workspace from public.workspaces w where w.id = v_invite.workspace_id for update;
  if exists (select 1 from public.workspace_members m where m.user_id = v_user and m.status = 'active') then
    raise exception 'You already belong to a team. Leave it before joining another' using errcode = '23505';
  end if;
  if v_invite.role = 'compliance' and not v_workspace.strict_sharing then
    raise exception 'This invite is no longer valid' using errcode = '22023';
  end if;
  if v_invite.role = 'owner' and v_workspace.owner_id is not null then
    raise exception 'This team already has an owner' using errcode = '22023';
  end if;
  if (select count(*) from public.workspace_members m where m.workspace_id = v_workspace.id and m.status = 'active') >= v_workspace.seats then
    raise exception 'This team has no free seats' using errcode = '22023';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, status, joined_at)
  values (v_workspace.id, v_user, v_invite.role, 'active', now())
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, status = 'active', joined_at = now(), left_at = null;
  if v_invite.role = 'owner' then
    update public.workspaces set owner_id = v_user where id = v_workspace.id;
  end if;
  update public.workspace_invites set accepted_at = now() where id = v_invite.id;
  return v_workspace.id;
end;
$$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

-- The workspace's people for the Team page: members with their sign-in address and name, and, for owners and
-- admins, people who left and invites not yet used.
create function public.workspace_members_list()
  returns table (user_id uuid, invite_id uuid, email text, display_name text, role text, status text, joined_at timestamptz, left_at timestamptz, expires_at timestamptz)
  language sql stable security definer set search_path = ''
as $$
  with me as (
    select m.workspace_id, m.role from public.workspace_members m
    where m.user_id = (select auth.uid()) and m.status = 'active'
  )
  select m.user_id, null::uuid, u.email::text, p.display_name, m.role, m.status, m.joined_at, m.left_at, null::timestamptz
  from me
  join public.workspace_members m on m.workspace_id = me.workspace_id
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  where m.status = 'active' or me.role in ('owner', 'admin')
  union all
  select null::uuid, i.id, i.email, null::text, i.role, 'invited', null::timestamptz, null::timestamptz, i.expires_at
  from me
  join public.workspace_invites i on i.workspace_id = me.workspace_id
  where me.role in ('owner', 'admin') and i.accepted_at is null
$$;
revoke execute on function public.workspace_members_list() from public, anon;
grant execute on function public.workspace_members_list() to authenticated;

-- Ends someone's membership: status removed and the date they left. Nothing of theirs is deleted. Owners and
-- admins remove people (only the owner removes an admin); anyone but the owner can leave.
create function public.remove_member(p_user uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_workspace uuid;
  v_my_role text;
  v_role text;
begin
  select m.workspace_id, m.role into v_workspace, v_my_role
  from public.workspace_members m where m.user_id = v_me and m.status = 'active';
  if v_workspace is null then
    raise exception 'You are not in a team' using errcode = '42501';
  end if;
  select m.role into v_role from public.workspace_members m
  where m.workspace_id = v_workspace and m.user_id = p_user and m.status = 'active';
  if v_role is null then
    raise exception 'That person is not in your team' using errcode = 'P0002';
  end if;
  if v_role = 'owner' then
    raise exception 'The owner cannot be removed' using errcode = '42501';
  end if;
  if p_user <> v_me then
    if v_my_role not in ('owner', 'admin') then
      raise exception 'Only an owner or admin can remove people' using errcode = '42501';
    end if;
    if v_role = 'admin' and v_my_role <> 'owner' then
      raise exception 'Only the owner can remove an admin' using errcode = '42501';
    end if;
  end if;
  update public.workspace_members m set status = 'removed', left_at = now()
  where m.workspace_id = v_workspace and m.user_id = p_user;
end;
$$;
revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

-- Changes a member's role. Not the owner's, not your own, and only the owner changes an admin or makes one.
create function public.set_member_role(p_user uuid, p_role text) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_workspace uuid;
  v_my_role text;
  v_role text;
  v_strict boolean;
begin
  select m.workspace_id, m.role into v_workspace, v_my_role
  from public.workspace_members m where m.user_id = v_me and m.status = 'active';
  if v_workspace is null or v_my_role not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can change roles' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'compliance', 'member') then
    raise exception 'Choose a role' using errcode = '22023';
  end if;
  if p_user = v_me then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  select m.role into v_role from public.workspace_members m
  where m.workspace_id = v_workspace and m.user_id = p_user and m.status = 'active';
  if v_role is null then
    raise exception 'That person is not in your team' using errcode = 'P0002';
  end if;
  if v_role = 'owner' then
    raise exception 'The owner''s role cannot be changed' using errcode = '42501';
  end if;
  if (v_role = 'admin' or p_role = 'admin') and v_my_role <> 'owner' then
    raise exception 'Only the owner can change an admin' using errcode = '42501';
  end if;
  select w.strict_sharing into v_strict from public.workspaces w where w.id = v_workspace for update;
  if p_role = 'compliance' and not v_strict then
    raise exception 'The Compliance role needs strict sharing to be on' using errcode = '22023';
  end if;
  update public.workspace_members m set role = p_role where m.workspace_id = v_workspace and m.user_id = p_user;
end;
$$;
revoke execute on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;

-- Turns strict sharing on or off. Off turns Compliance members, and open Compliance invites, into Members.
create function public.set_strict_sharing(p_strict boolean) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  if coalesce(public.my_workspace_role(), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can change this' using errcode = '42501';
  end if;
  v_workspace := public.my_workspace_id();
  update public.workspaces set strict_sharing = coalesce(p_strict, false) where id = v_workspace;
  if not coalesce(p_strict, false) then
    update public.workspace_members m set role = 'member'
    where m.workspace_id = v_workspace and m.role = 'compliance';
    update public.workspace_invites i set role = 'member'
    where i.workspace_id = v_workspace and i.role = 'compliance' and i.accepted_at is null;
  end if;
end;
$$;
revoke execute on function public.set_strict_sharing(boolean) from public, anon;
grant execute on function public.set_strict_sharing(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The app owner's side (/admin)
-- ---------------------------------------------------------------------------

-- Sets the seats a workspace pays for: at least 5, and not fewer than its active members. App owner only.
create function public.set_seats(p_workspace uuid, p_seats integer) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_analytics_owner() then
    raise exception 'Only the owner of this app can change seats' using errcode = '42501';
  end if;
  if p_seats is null or p_seats < 5 then
    raise exception 'A team has at least 5 seats' using errcode = '22023';
  end if;
  if (select count(*) from public.workspace_members m where m.workspace_id = p_workspace and m.status = 'active') > p_seats then
    raise exception 'That is fewer seats than the team has members' using errcode = '22023';
  end if;
  update public.workspaces set seats = p_seats where id = p_workspace;
  if not found then
    raise exception 'No such team' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.set_seats(uuid, integer) from public, anon;
grant execute on function public.set_seats(uuid, integer) to authenticated;

-- Every workspace, for /admin. Empty for anyone but the app owner. An owner who has not joined yet shows the
-- address their invite went to.
create function public.admin_workspaces()
  returns table (id uuid, name text, seats integer, strict_sharing boolean, waitlist_id uuid, owner_email text, invited_email text, members integer, created_at timestamptz)
  language sql stable security definer set search_path = ''
as $$
  select w.id, w.name, w.seats, w.strict_sharing, w.waitlist_id,
         (select u.email::text from auth.users u where u.id = w.owner_id),
         (select i.email from public.workspace_invites i where i.workspace_id = w.id and i.role = 'owner' order by i.created_at desc limit 1),
         (select count(*)::integer from public.workspace_members m where m.workspace_id = w.id and m.status = 'active'),
         w.created_at
  from public.workspaces w
  where public.is_analytics_owner()
  order by w.created_at desc
$$;
revoke execute on function public.admin_workspaces() from public, anon;
grant execute on function public.admin_workspaces() to authenticated;

-- ---------------------------------------------------------------------------
-- Pooled storage and AI allowance
-- ---------------------------------------------------------------------------

-- AI allowance, as in 20261031140000_ai_budget.sql, except that a workspace member's budget is the
-- workspace total (seats x monthly_usd) and the spend counted against it is every active member's, so the
-- team shares it. Someone with no workspace is as before. Setup spend stays per person.
create or replace function public.ai_allowance_for(p_user uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  with pool as (
    select coalesce(array_agg(m.user_id), array[p_user]) as users, coalesce(max(w.seats), 1) as seats
    from public.workspace_members me
    join public.workspaces w on w.id = me.workspace_id
    join public.workspace_members m on m.workspace_id = me.workspace_id and m.status = 'active'
    where me.user_id = p_user and me.status = 'active'
  ),
  cfg as (
    select c.monthly_usd * pool.seats as monthly_usd, c.shares, c.weekly_pct, c.weekly_features
    from public.ai_budget c, pool limit 1
  ),
  bounds as (
    select date_trunc('month', now() at time zone 'utc') at time zone 'utc' as m,
           date_trunc('week', now() at time zone 'utc') at time zone 'utc' as w
  ),
  mspent as (
    select u.feature, sum(u.cost_usd) as cost from public.ai_usage u, bounds b, pool
    where u.user_id = any (pool.users) and not u.setup and u.created_at >= b.m group by u.feature
  ),
  wspent as (
    select u.feature, sum(u.cost_usd) as cost from public.ai_usage u, bounds b, pool
    where u.user_id = any (pool.users) and not u.setup and u.created_at >= b.w group by u.feature
  ),
  weekly as (
    select f.key, f.value::numeric as share from cfg, jsonb_each_text(cfg.shares) f where f.key = any (cfg.weekly_features)
  )
  select jsonb_build_object(
    'used_pct', round(coalesce((select sum(cost) from mspent), 0) / cfg.monthly_usd * 100, 1),
    'resets_at', (select m + interval '1 month' from bounds),
    'features', coalesce((
      select jsonb_object_agg(f.key, round(coalesce(s.cost, 0) / nullif(cfg.monthly_usd * f.value::numeric / 100, 0) * 100, 1))
      from jsonb_each_text(cfg.shares) f left join mspent s on s.feature = f.key
    ), '{}'::jsonb),
    'week_pct', (
      select round(coalesce(sum(s.cost), 0) / nullif(cfg.monthly_usd * sum(w.share) / 100 * cfg.weekly_pct / 100, 0) * 100, 1)
      from weekly w left join wspent s on s.feature = w.key
    ),
    'week_resets_at', (select w + interval '7 days' from bounds),
    'week_features', coalesce((
      select jsonb_object_agg(w.key, round(coalesce(s.cost, 0) / nullif(cfg.monthly_usd * w.share / 100 * cfg.weekly_pct / 100, 0) * 100, 1))
      from weekly w left join wspent s on s.feature = w.key
    ), '{}'::jsonb)
  )
  from cfg
$$;

-- Stored files, counted as storage_usage counts them, for a person's workspace: the seats, the active members
-- and the bytes they hold together, which the team shares against seats x 20 GB. Null when the person has no
-- workspace. Sizes only.
create function public.team_storage_for(p_user uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'seats', w.seats,
    'members', (select count(*) from public.workspace_members m where m.workspace_id = w.id and m.status = 'active'),
    'bytes', coalesce((
      select sum(a.size_bytes) from public.attachments a
      where a.user_id in (select m.user_id from public.workspace_members m where m.workspace_id = w.id and m.status = 'active')
        and a.storage_path is not null and a.kind <> 'audio' and a.filename not ilike 'Sticker.%'
    ), 0)
  )
  from public.workspace_members me join public.workspaces w on w.id = me.workspace_id
  where me.user_id = p_user and me.status = 'active'
$$;
revoke execute on function public.team_storage_for(uuid) from public, anon, authenticated;
grant execute on function public.team_storage_for(uuid) to service_role;

-- The signed-in person's own.
create function public.my_team_storage() returns jsonb
  language sql stable security definer set search_path = ''
as $$ select public.team_storage_for((select auth.uid())) $$;
revoke execute on function public.my_team_storage() from public, anon;
grant execute on function public.my_team_storage() to authenticated;
