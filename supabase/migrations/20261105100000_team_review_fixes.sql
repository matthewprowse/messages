-- Fixes from the review of Teams (27 October 2026, docs/PLAN.md, Teams). Each function below is the latest version from the
-- migrations before it, with only the change its comment names.
--
--   1. Share From: a message older than its chat's Share From is never read through a team policy, even if it still holds
--      the team key from an earlier share, and a chat cannot be shared again while it is still moving back to personal.
--   2. Only the owner gives or takes the Compliance role and changes strict sharing, so an admin cannot read every work chat
--      by making a Compliance member (an owner or admin reads a work chat only once it is assigned to them).
--   3. A match on a client company's domain only suggests a chat; only a client's own address or number shares it.
--   4. A chat whose agent has left the team is shown to the team as it stood when they left: its raw row is no longer read by
--      colleagues (nor sent to them over Realtime), and the lists use the last shared message for its time and whether the
--      client is waiting, never what the agent's own account keeps writing to it.
--   5. Turning an account into a shared inbox also takes its chats already shared with the team as work chats.
--   6. The team read policies look up the reader's workspace once per query, and skip the reader's own rows ("Own rows"
--      covers those), before calling the per-row checks.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Whether the agent whose chat this is has left its team. A shared inbox chat belongs to the inbox, so never.
create function public.agent_has_left(p_thread public.threads) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select p_thread.workspace_id is not null and p_thread.shared_by is distinct from 'account' and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_thread.workspace_id and m.user_id = p_thread.user_id and m.status = 'active')
$$;
revoke execute on function public.agent_has_left(public.threads) from public, anon;
-- The Shared threads policy calls it as the reader.
grant execute on function public.agent_has_left(public.threads) to authenticated;

-- When a work chat last moved, as the team sees it: the chat's own time, or for an agent who has left, their last message
-- the team holds (what their account writes afterwards is theirs alone).
create function public.team_last_at(p_thread public.threads) returns timestamptz
  language sql stable security definer set search_path = ''
as $$
  select case when public.agent_has_left(p_thread)
    then (select max(m.sent_at) from public.messages m where m.thread_id = p_thread.id and m.workspace_id = p_thread.workspace_id)
    else p_thread.last_message_at end
$$;
revoke execute on function public.team_last_at(public.threads) from public, anon, authenticated;

-- can_read_thread for one message: also from the chat's Share From date on.
create function public.can_read_thread_at(p_thread uuid, p_workspace uuid, p_sent_at timestamptz) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select public.can_read_thread(p_thread, p_workspace) and exists (
    select 1 from public.threads t where t.id = p_thread and (t.share_from is null or p_sent_at >= t.share_from))
$$;
revoke execute on function public.can_read_thread_at(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.can_read_thread_at(uuid, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Share From
-- ---------------------------------------------------------------------------

-- Messages, message AI and attachment files: a message older than Share From is never read through a team policy.
create or replace function public.can_read_message(p_message uuid, p_workspace uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.messages m where m.id = p_message and public.can_read_thread_at(m.thread_id, p_workspace, m.sent_at))
$$;

-- Not while the chat is still moving back to personal.
create or replace function public.queue_thread_share(p_thread uuid, p_user uuid, p_workspace uuid, p_share_from timestamptz, p_by text) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  -- Not while the chat is still moving back to personal: that job would be replaced, and rows from the earlier share would
  -- stay in the workspace although the new Share From leaves them out.
  if exists (
    select 1 from public.share_jobs j
    where j.thread_id = p_thread and j.direction = 'to_personal'
      and (j.status in ('queued', 'working') or (j.status = 'failed' and j.attempts < 5))
  ) then
    raise exception 'This chat is still moving back to personal. Try again in a minute' using errcode = '55006';
  end if;
  update public.threads t
  set workspace_id = p_workspace, shared_at = now(), shared_by = p_by, share_from = p_share_from
  where t.id = p_thread and t.user_id = p_user and t.workspace_id is null;
  if not found then
    raise exception 'That chat is already shared' using errcode = '23505';
  end if;
  -- A newer request replaces one still waiting.
  delete from public.share_jobs j where j.thread_id = p_thread and j.status = 'queued';
  insert into public.share_jobs (thread_id, user_id, workspace_id, direction, share_from)
  values (p_thread, p_user, p_workspace, 'to_work', p_share_from);
  perform public.bump_workspace_activity(p_workspace, p_user, 1, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1, 4 and 6: the team read policies
-- ---------------------------------------------------------------------------

drop policy "Shared threads" on public.threads;
create policy "Shared threads" on public.threads for select to authenticated
  using (
    workspace_id = (select public.my_workspace_id()) and user_id <> (select auth.uid())
    and public.can_read_thread(id, workspace_id) and not public.agent_has_left(threads)
  );
drop policy "Shared messages" on public.messages;
create policy "Shared messages" on public.messages for select to authenticated
  using (
    workspace_id = (select public.my_workspace_id()) and user_id <> (select auth.uid())
    and public.can_read_thread_at(thread_id, workspace_id, sent_at)
  );
drop policy "Shared message AI" on public.message_ai;
create policy "Shared message AI" on public.message_ai for select to authenticated
  using (
    workspace_id = (select public.my_workspace_id()) and user_id <> (select auth.uid())
    and public.can_read_message(message_id, workspace_id)
  );
drop policy "Shared attachments" on public.attachments;
create policy "Shared attachments" on public.attachments for select to authenticated
  using (
    workspace_id = (select public.my_workspace_id()) and user_id <> (select auth.uid())
    and public.can_read_message(message_id, workspace_id)
  );

-- ---------------------------------------------------------------------------
-- 2. Compliance and strict sharing are the owner's
-- ---------------------------------------------------------------------------

create or replace function public.invite_member(p_email text, p_role text) returns text
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
  if p_role = 'compliance' and v_my_role <> 'owner' then
    raise exception 'Only the owner can give someone the Compliance role' using errcode = '42501';
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

create or replace function public.set_member_role(p_user uuid, p_role text) returns void
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
  if (v_role = 'compliance' or p_role = 'compliance') and v_my_role <> 'owner' then
    raise exception 'Only the owner can give or take the Compliance role' using errcode = '42501';
  end if;
  select w.strict_sharing into v_strict from public.workspaces w where w.id = v_workspace for update;
  if p_role = 'compliance' and not v_strict then
    raise exception 'The Compliance role needs strict sharing to be on' using errcode = '22023';
  end if;
  update public.workspace_members m set role = p_role where m.workspace_id = v_workspace and m.user_id = p_user;
end;
$$;

create or replace function public.set_strict_sharing(p_strict boolean) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  if coalesce(public.my_workspace_role(), '') <> 'owner' then
    raise exception 'Only the owner can change strict sharing' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- 3. A company match only suggests
-- ---------------------------------------------------------------------------

drop function public.apply_team_rule(uuid, text);
-- p_by is client (one of the client's own addresses or numbers) or company (the domain of anyone at a client company).
create function public.apply_team_rule(p_thread uuid, p_match text, p_by text default 'client') returns text
  language plpgsql security definer set search_path = ''
as $$
declare
  v_thread public.threads;
  v_workspace uuid;
  v_strict boolean;
begin
  select t.* into v_thread from public.threads t where t.id = p_thread for update;
  if not found or v_thread.workspace_id is not null or v_thread.share_opt_out or v_thread.is_group
     or v_thread.share_suggestion = 'dismissed' or v_thread.status = 'trash' then
    return null;
  end if;
  select m.workspace_id, w.strict_sharing into v_workspace, v_strict
  from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
  where m.user_id = v_thread.user_id and m.status = 'active';
  if v_workspace is null then
    return null;
  end if;

  if v_strict or p_by is distinct from 'client' then
    update public.threads t set share_suggestion = 'suggested', share_match = p_match where t.id = p_thread;
    return 'suggested';
  end if;
  update public.threads t set share_match = p_match where t.id = p_thread;
  perform public.queue_thread_share(p_thread, v_thread.user_id, v_workspace, null, 'rule');
  return 'shared';
end;
$$;
revoke execute on function public.apply_team_rule(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_team_rule(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. A departed agent's chat as it stood
-- ---------------------------------------------------------------------------

create or replace function public.thread_awaiting(p_thread public.threads) returns boolean
  language sql stable security definer set search_path = ''
as $$
  with last as (
    select public.team_last_at(p_thread) as at,
           case when public.agent_has_left(p_thread)
                then coalesce((select m.direction = 'outbound' from public.messages m
                               where m.thread_id = p_thread.id and m.workspace_id = p_thread.workspace_id
                               order by m.sent_at desc limit 1), false)
                else p_thread.last_from_me end as from_me
  )
  select last.at is not null and not last.from_me
    and coalesce(p_thread.category, '') not in ('newsletter', 'notification')
    and not exists (
      select 1 from public.outbox o
      where o.for_thread_id = p_thread.id and o.status = 'sent' and o.sent_at >= last.at)
  from last
$$;

create or replace function public.work_chats(p_filter text default 'all', p_limit integer default 200, p_offset integer default 0)
  returns table (thread_id uuid, agent_id uuid, agent_name text, agent_left boolean, share_label text, channel text, shared_by text,
                 inbox_name text, shared_at timestamptz, last_message_at timestamptz, awaiting_reply boolean, assignee_ids uuid[], total_count bigint)
  language sql stable security definer set search_path = ''
as $$
  with mine as (
    select public.my_workspace_id() as workspace_id, public.my_workspace_role() as role
  ), listed as (
    select t.id, t.user_id, t.share_label, t.channel, t.shared_by, ac.inbox_name, t.shared_at, public.team_last_at(t) as last_message_at,
           public.thread_awaiting(t) as awaiting,
           not exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = t.user_id and m.status = 'active') as agent_left,
           coalesce((select array_agg(a.assignee_id order by a.created_at) from public.thread_assignments a where a.thread_id = t.id), '{}') as assignees
    from public.threads t
    join mine on t.workspace_id = mine.workspace_id
    left join public.accounts ac on ac.id = t.account_id and t.shared_by = 'account'
    where mine.role in ('owner', 'admin')
       or (mine.role = 'compliance' and exists (select 1 from public.workspaces w where w.id = mine.workspace_id and w.strict_sharing))
  ), picked as (
    select r.*, count(*) over () as total
    from listed r
    where case coalesce(p_filter, 'all')
      when 'left' then r.agent_left
      when 'awaiting' then r.awaiting
      when 'unassigned' then cardinality(r.assignees) = 0
      else true
    end
  )
  select p.id, p.user_id, public.person_name(p.user_id), p.agent_left, p.share_label, p.channel, p.shared_by, p.inbox_name, p.shared_at,
         p.last_message_at, p.awaiting, p.assignees, p.total
  from picked p
  order by p.last_message_at desc nulls last, p.id
  limit greatest(1, least(coalesce(p_limit, 200), 500)) offset greatest(0, coalesce(p_offset, 0))
$$;

create or replace function public.my_assigned_chats()
  returns table (thread_id uuid, agent_id uuid, agent_name text, agent_left boolean, share_label text, preview text, channel text,
                 shared_by text, inbox_name text, last_message_at timestamptz, awaiting_reply boolean, assigned_at timestamptz, assignees jsonb,
                 cover_until timestamptz)
  language sql stable security definer set search_path = ''
as $$
  with mine as (
    select distinct on (x.thread_id) x.thread_id, x.since, x.cover_end
    from (
      select t.id as thread_id, a.created_at as since, null::timestamptz as cover_end, 0 as rank
      from public.thread_assignments a
      join public.threads t on t.id = a.thread_id and t.workspace_id = a.workspace_id
      where a.assignee_id = (select auth.uid()) and a.workspace_id = public.my_workspace_id()
      union all
      select t.id, c.starts_at, c.ends_at, 1
      from public.workspace_cover c
      join public.threads t on t.user_id = c.absent_id and t.workspace_id = c.workspace_id and t.shared_by is distinct from 'account'
      where c.cover_id = (select auth.uid()) and c.workspace_id = public.my_workspace_id()
        and c.ended_at is null and c.starts_at <= now() and now() < c.ends_at
        and public.i_cover(c.workspace_id, c.absent_id)
    ) x
    order by x.thread_id, x.rank
  )
  select t.id, t.user_id, public.person_name(t.user_id),
         not exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = t.user_id and m.status = 'active'),
         t.share_label, case when public.agent_has_left(t) then null else t.last_message_preview end, t.channel, t.shared_by, ac.inbox_name,
         public.team_last_at(t), public.thread_awaiting(t), mine.since,
         coalesce((
           select jsonb_agg(jsonb_build_object('user_id', o.assignee_id, 'name', public.person_name(o.assignee_id)) order by o.created_at)
           from public.thread_assignments o where o.thread_id = t.id
         ), '[]'::jsonb),
         mine.cover_end
  from mine
  join public.threads t on t.id = mine.thread_id
  left join public.accounts ac on ac.id = t.account_id and t.shared_by = 'account'
  where coalesce(public.my_workspace_role(), '') <> 'compliance' and t.status <> 'trash'
  order by public.team_last_at(t) desc nulls last
$$;

create or replace function public.team_response_stats()
  returns table (user_id uuid, name text, role text, active boolean, unanswered_7d integer, unanswered_30d integer,
                 answered_7d integer, answered_30d integer, median_reply_7d integer, median_reply_30d integer)
  language sql stable security definer set search_path = ''
as $$
  with me as (
    select m.workspace_id from public.workspace_members m
    where m.user_id = (select auth.uid()) and m.status = 'active' and m.role in ('owner', 'admin')
  ), chats as (
    select t.id, t.workspace_id, public.team_last_at(t) as last_message_at, t.share_from, public.thread_awaiting(t) as awaiting,
           case when t.shared_by = 'account'
                then (select a.assignee_id from public.thread_assignments a where a.thread_id = t.id order by a.created_at limit 1)
                else t.user_id end as owner_id
    from public.threads t join me on t.workspace_id = me.workspace_id
    where t.status <> 'trash' and not t.junk and coalesce(t.category, '') not in ('newsletter', 'notification')
  ), events as (
    select m.thread_id, m.sent_at, m.direction
    from public.messages m join chats c on c.id = m.thread_id
    where m.sent_at >= now() - interval '31 days' and (c.share_from is null or m.sent_at >= c.share_from)
      and m.workspace_id = c.workspace_id
    union all
    select o.for_thread_id, o.sent_at, 'outbound'
    from public.outbox o join chats c on c.id = o.for_thread_id
    where o.status = 'sent' and o.sent_at >= now() - interval '31 days'
  ), ordered as (
    select e.thread_id, e.sent_at, e.direction,
           lag(e.direction) over (partition by e.thread_id order by e.sent_at) as prev,
           min(case when e.direction = 'outbound' then e.sent_at end)
             over (partition by e.thread_id order by e.sent_at rows between 1 following and unbounded following) as answered_at
    from events e
  ), turns as (
    select c.owner_id, o.sent_at, extract(epoch from o.answered_at - o.sent_at) as secs
    from ordered o join chats c on c.id = o.thread_id
    where o.direction = 'inbound' and o.prev is distinct from 'inbound' and o.answered_at is not null
  ), waiting as (
    select c.owner_id,
           count(*) filter (where c.last_message_at >= now() - interval '7 days')::integer as w7,
           count(*) filter (where c.last_message_at >= now() - interval '30 days')::integer as w30
    from chats c where c.awaiting group by c.owner_id
  ), answered as (
    select t.owner_id,
           count(*) filter (where t.sent_at >= now() - interval '7 days')::integer as a7,
           count(*) filter (where t.sent_at >= now() - interval '30 days')::integer as a30,
           (percentile_cont(0.5) within group (order by t.secs) filter (where t.sent_at >= now() - interval '7 days'))::integer as m7,
           (percentile_cont(0.5) within group (order by t.secs) filter (where t.sent_at >= now() - interval '30 days'))::integer as m30
    from turns t group by t.owner_id
  ), people as (
    select m.user_id, m.role, m.status = 'active' as active from public.workspace_members m join me on m.workspace_id = me.workspace_id
    union all
    select null::uuid, null, true where exists (select 1 from me)
  )
  select p.user_id, case when p.user_id is null then null else public.person_name(p.user_id) end, p.role, p.active,
         coalesce(w.w7, 0), coalesce(w.w30, 0), coalesce(a.a7, 0), coalesce(a.a30, 0), a.m7, a.m30
  from people p
  left join waiting w on w.owner_id is not distinct from p.user_id
  left join answered a on a.owner_id is not distinct from p.user_id
  order by p.active desc, p.user_id is null, coalesce(w.w30, 0) desc, 2
$$;

-- ---------------------------------------------------------------------------
-- 5. A shared inbox takes the account's work chats
-- ---------------------------------------------------------------------------

create or replace function public.share_account(p_account uuid, p_name text) returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_workspace uuid := public.my_workspace_id();
  v_account public.accounts;
  v_name text := btrim(coalesce(p_name, ''));
  v_ids uuid[];
begin
  if coalesce(public.my_workspace_role(), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can make a shared inbox' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Give the inbox a name' using errcode = '22023';
  end if;
  select a.* into v_account from public.accounts a where a.id = p_account for update;
  if not found or v_account.user_id <> v_me then
    raise exception 'You can only share an account you connected' using errcode = '42501';
  end if;
  if v_account.workspace_id is not null then
    raise exception 'That account is already a shared inbox' using errcode = '23505';
  end if;
  if v_account.provider not in ('gmail', 'outlook', 'imap', 'icloud', 'whatsapp') then
    raise exception 'Only email and WhatsApp accounts can be shared inboxes' using errcode = '22023';
  end if;

  update public.accounts set workspace_id = v_workspace, inbox_name = v_name where id = p_account;
  insert into public.workspace_inbox_access (account_id, workspace_id, user_id, added_by) values (p_account, v_workspace, v_me, v_me);

  -- Every chat on the account: personal ones, and ones already shared with this team as a work chat, which become the
  -- inbox's from the start of their history (so the access list reads them and they cannot be moved back).
  select coalesce(array_agg(t.id), '{}') into v_ids from public.threads t
  where t.account_id = p_account and (t.workspace_id is null or (t.workspace_id = v_workspace and t.shared_by is distinct from 'account'));
  update public.threads t
  set workspace_id = v_workspace, shared_at = coalesce(t.shared_at, now()), shared_by = 'account', share_from = null
  where t.id = any (v_ids);
  delete from public.share_jobs j where j.thread_id = any (v_ids) and j.status = 'queued';
  insert into public.share_jobs (thread_id, user_id, workspace_id, direction)
  select t.id, t.user_id, v_workspace, 'to_work' from public.threads t where t.id = any (v_ids);
  return coalesce(cardinality(v_ids), 0);
end;
$$;

