-- Owner features at launch: step 5 of Teams (docs/PLAN.md, Teams). Reassigning a client, the people who read a chat
-- beyond its agent, shared inboxes and response tracking, all content-free except what is sealed with the team's key.
--
--   * Assignees: a chat assigned to someone is read by them through the step 3 policies. They write nothing in the
--     agent's rows. Replying means a new conversation from their OWN connected account, started from the outbox like any
--     new email or WhatsApp chat, with outbox.for_thread_id naming the shared chat it answers. The worker links the
--     sent conversation to the outbox row as it always does, so the chat shows "your conversation" and a reply counts as
--     the chat being answered. Compliance is never assigned and never replies.
--   * Reassigning: work_chats() lists a workspace's work chats (client label sealed t1, agent, whether the agent has left,
--     time, awaiting reply, assignees) for an owner or admin, and for Compliance under strict sharing. assign_agent_chats
--     gives a departed agent's chats to one person in one go.
--   * Compliance: reading is only open for a while after log_compliance_open wrote a row (thread, person, time). The
--     agent reads their own log; nobody else does. This makes the log a gate and not a courtesy: without a row, the
--     read policies of step 3 find nothing for a Compliance member.
--   * Shared inboxes: accounts.workspace_id, an access list (workspace_inbox_access) chosen by an owner or admin, every
--     chat on the account shared in full (shared_by account, a trigger on new threads and share_account for the
--     history), members on the list read all of its chats, assign one person at a time, add internal notes
--     (thread_notes, sealed t1, never sent) and reply from the shared account (outbox rows by a member for a chat of an
--     inbox they can use). "Someone is replying" is Realtime presence on a private channel per chat, authorised below.
--   * Response tracking: team_response_stats and team_moved_back, computed from timestamps and counts only, for work
--     chats only. Personal chats are not workspace chats, so they never enter a query here.
--
-- Not here: removing a shared inbox from the team (its chats stay shared), attachments on a shared inbox reply, Reply All
-- and Cc from a shared inbox, a shared inbox for Instagram, LinkedIn, Teams, Zoom and Google Chat.

-- ---------------------------------------------------------------------------
-- Names
-- ---------------------------------------------------------------------------

-- A person's name as the team sees it: their profile name, else their sign-in address. Only the functions below call it.
create function public.person_name(p_user uuid) returns text
  language sql stable security definer set search_path = ''
as $$
  select coalesce(nullif(p.display_name, ''), u.email::text)
  from auth.users u left join public.profiles p on p.user_id = u.id
  where u.id = p_user
$$;
revoke execute on function public.person_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.accounts
  add column workspace_id uuid references public.workspaces (id),
  add column inbox_name text check (inbox_name is null or length(btrim(inbox_name)) between 1 and 80),
  add constraint accounts_inbox_named check (workspace_id is null or inbox_name is not null);
create index accounts_workspace_idx on public.accounts (workspace_id) where workspace_id is not null;

-- The shared chat a queued reply answers, when an assignee replies from their own account. The new conversation is
-- linked as usual (thread_id, set by the worker once the sent copy is stored). Only an assignee may set it.
alter table public.outbox add column for_thread_id uuid references public.threads (id) on delete set null;
create index outbox_for_thread_idx on public.outbox (for_thread_id) where for_thread_id is not null;

-- ---------------------------------------------------------------------------
-- The Compliance access log
-- ---------------------------------------------------------------------------

create table public.compliance_opens (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  opened_at timestamptz not null default now()
);
create index compliance_opens_thread_idx on public.compliance_opens (thread_id, opened_at desc);
create index compliance_opens_user_idx on public.compliance_opens (user_id, thread_id, opened_at desc);

alter table public.compliance_opens enable row level security;
revoke all on public.compliance_opens from anon, authenticated;
grant select on public.compliance_opens to authenticated;
-- Only the agent whose chat it is reads its log. Not the owner, not other Compliance members, not Compliance itself.
create policy "Agents read the log of their chats" on public.compliance_opens for select to authenticated
  using (
    workspace_id = public.my_workspace_id()
    and exists (select 1 from public.threads t where t.id = thread_id and t.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Shared inboxes
-- ---------------------------------------------------------------------------

create table public.workspace_inbox_access (
  account_id uuid not null references public.accounts (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index workspace_inbox_access_user_idx on public.workspace_inbox_access (user_id);

alter table public.workspace_inbox_access enable row level security;
revoke all on public.workspace_inbox_access from anon, authenticated;
grant select on public.workspace_inbox_access to authenticated;
-- Your own access, and for owners and admins the whole list.
create policy "Read inbox access" on public.workspace_inbox_access for select to authenticated
  using (workspace_id = public.my_workspace_id() and (user_id = (select auth.uid()) or public.my_workspace_role() in ('owner', 'admin')));

-- Notes between colleagues on a shared chat. The body is sealed with the team key ("t1:", which the check insists on)
-- and is never sent anywhere. Read by whoever can read the chat; written through add_thread_note.
create table public.thread_notes (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (body like 't1:%' and length(body) <= 20000),
  created_at timestamptz not null default now()
);
create index thread_notes_thread_idx on public.thread_notes (thread_id, created_at);

alter table public.thread_notes enable row level security;
revoke all on public.thread_notes from anon, authenticated;
grant select on public.thread_notes to authenticated;
alter publication supabase_realtime add table public.thread_notes;

-- ---------------------------------------------------------------------------
-- Who may read and reply
-- ---------------------------------------------------------------------------

-- Replaces step 3's: a person on the access list of the chat's shared inbox also reads it, and a Compliance member reads
-- a chat only for 4 hours after log_compliance_open wrote their row for it.
create or replace function public.can_read_thread(p_thread uuid, p_workspace uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select p_workspace is not null and exists (
    select 1 from public.threads t
    where t.id = p_thread and t.workspace_id = p_workspace and p_workspace = public.my_workspace_id()
      and (
        exists (select 1 from public.thread_assignments a where a.thread_id = t.id and a.assignee_id = (select auth.uid()))
        or exists (
          select 1 from public.workspace_inbox_access x join public.accounts ac on ac.id = x.account_id
          where x.account_id = t.account_id and x.user_id = (select auth.uid()) and ac.workspace_id = t.workspace_id)
        or (public.my_workspace_role() = 'compliance'
            and exists (select 1 from public.workspaces w where w.id = t.workspace_id and w.strict_sharing)
            and exists (
              select 1 from public.compliance_opens o
              where o.thread_id = t.id and o.user_id = (select auth.uid()) and o.opened_at > now() - interval '4 hours'))
      )
  )
$$;

-- The agent, or anyone who can read the chat. For notes and presence.
create function public.can_open_thread(p_thread uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.threads t
    where t.id = p_thread and t.workspace_id is not null and t.workspace_id = public.my_workspace_id()
      and (t.user_id = (select auth.uid()) or public.can_read_thread(t.id, t.workspace_id))
  )
$$;
revoke execute on function public.can_open_thread(uuid) from public, anon;
grant execute on function public.can_open_thread(uuid) to authenticated;

-- Whether this person is one of the chat's assignees, and so may answer it from their own account. Never Compliance.
create function public.is_assignee(p_thread uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.thread_assignments a
    join public.threads t on t.id = a.thread_id and t.workspace_id = a.workspace_id
    join public.workspace_members m on m.workspace_id = a.workspace_id and m.user_id = a.assignee_id and m.status = 'active' and m.role <> 'compliance'
    where a.thread_id = p_thread and a.assignee_id = (select auth.uid())
  )
$$;
revoke execute on function public.is_assignee(uuid) from public, anon;
grant execute on function public.is_assignee(uuid) to authenticated;

-- Whether p_user may reply from the shared account a chat is on: the chat is part of a shared inbox, they are on its
-- access list and still an active member, and not Compliance. A signed-in person can only ask about themselves; the sync
-- worker (no signed-in person) asks about whoever queued the reply.
create function public.user_can_reply_in_inbox(p_thread uuid, p_user uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select p_user is not distinct from coalesce((select auth.uid()), p_user) and exists (
    select 1 from public.threads t
    join public.accounts ac on ac.id = t.account_id
    join public.workspace_inbox_access x on x.account_id = ac.id and x.user_id = p_user
    join public.workspace_members m on m.workspace_id = ac.workspace_id and m.user_id = p_user and m.status = 'active' and m.role <> 'compliance'
    where t.id = p_thread and t.shared_by = 'account' and t.workspace_id = ac.workspace_id
  )
$$;
revoke execute on function public.user_can_reply_in_inbox(uuid, uuid) from public, anon;
grant execute on function public.user_can_reply_in_inbox(uuid, uuid) to authenticated, service_role;

-- A queued reply by a member of a shared inbox, in a chat on that inbox. Text only, to whoever the chat is with (the
-- worker picks them as it does for the account's own replies), no copies, no attachments. It goes from the shared account.
create policy "Queue replies in shared inboxes" on public.outbox for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and error is null
    and provider_message_id is null
    and sent_at is null
    and outbox.thread_id is not null
    and outbox.draft_id is null
    and outbox.reply_to_message_id is null
    and outbox.for_thread_id is null
    and outbox.attachment_count = 0
    and cardinality(outbox.to_addresses) = 0
    and outbox.subject is null
    and (outbox.account_id is null or exists (select 1 from public.threads t where t.id = outbox.thread_id and t.account_id = outbox.account_id))
    and public.user_can_reply_in_inbox(outbox.thread_id, (select auth.uid()))
  );

-- An assignee's reply from their own account starts a new conversation (no thread_id yet) and may say which shared chat it
-- answers. Nobody else may set it.
create policy "Replies for a shared chat are the assignee's own" on public.outbox as restrictive for insert to authenticated
  with check (outbox.for_thread_id is null or (outbox.thread_id is null and public.is_assignee(outbox.for_thread_id)));

-- Whether a chat is waiting for an answer: the last message is from the client, and no assignee has answered it from
-- their own account since. Newsletters and notifications never wait for one.
create function public.thread_awaiting(p_thread public.threads) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select p_thread.last_message_at is not null and not p_thread.last_from_me
    and coalesce(p_thread.category, '') not in ('newsletter', 'notification')
    and not exists (
      select 1 from public.outbox o
      where o.for_thread_id = p_thread.id and o.status = 'sent' and o.sent_at >= p_thread.last_message_at)
$$;
revoke execute on function public.thread_awaiting(public.threads) from public, anon, authenticated;

-- Read policies for the new tables (they use the functions above).
create policy "Read notes of chats you can open" on public.thread_notes for select to authenticated
  using (
    workspace_id = public.my_workspace_id()
    and exists (
      select 1 from public.threads t
      where t.id = thread_id and t.workspace_id = thread_notes.workspace_id
        and (t.user_id = (select auth.uid()) or public.can_read_thread(t.id, t.workspace_id)))
  );

-- ---------------------------------------------------------------------------
-- Assigning and reassigning
-- ---------------------------------------------------------------------------

-- Step 3's, with one more rule: Compliance reads every work chat as it is (and the log says so), so it is never assigned.
create or replace function public.assign_thread(p_thread uuid, p_assignee uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_thread public.threads;
  v_role text;
  v_assignee_role text;
begin
  select t.* into v_thread from public.threads t where t.id = p_thread;
  if not found or v_thread.workspace_id is null then
    raise exception 'That chat is not shared' using errcode = 'P0002';
  end if;
  select m.role into v_role from public.workspace_members m
  where m.workspace_id = v_thread.workspace_id and m.user_id = v_me and m.status = 'active';
  if v_role is null then
    raise exception 'You are not in this chat''s team' using errcode = '42501';
  end if;
  if not (v_thread.user_id = v_me or v_role in ('owner', 'admin')) then
    raise exception 'Only the person whose chat it is, an owner or an admin can assign it' using errcode = '42501';
  end if;
  if p_assignee = v_thread.user_id then
    raise exception 'A chat is always open to the person whose chat it is' using errcode = '22023';
  end if;
  select m.role into v_assignee_role from public.workspace_members m
  where m.workspace_id = v_thread.workspace_id and m.user_id = p_assignee and m.status = 'active';
  if v_assignee_role is null then
    raise exception 'That person is not in your team' using errcode = 'P0002';
  end if;
  if v_assignee_role = 'compliance' then
    raise exception 'Compliance reads every work chat and never replies, so it is not given chats' using errcode = '22023';
  end if;
  insert into public.thread_assignments (thread_id, workspace_id, assignee_id, assigned_by)
  values (p_thread, v_thread.workspace_id, p_assignee, v_me)
  on conflict (thread_id, assignee_id) do nothing;
end;
$$;

-- An owner or admin gives every work chat of someone who has left the team to one active person. Returns how many were
-- newly assigned. Only for a person who has left: a colleague who is still here keeps deciding who reads their chats.
create function public.assign_agent_chats(p_agent uuid, p_assignee uuid) returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_workspace uuid := public.my_workspace_id();
  v_assignee_role text;
  v_count integer;
begin
  if coalesce(public.my_workspace_role(), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can reassign chats' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = v_workspace and m.user_id = p_agent and m.status = 'removed') then
    raise exception 'That person has not left the team' using errcode = '22023';
  end if;
  select m.role into v_assignee_role from public.workspace_members m
  where m.workspace_id = v_workspace and m.user_id = p_assignee and m.status = 'active';
  if v_assignee_role is null then
    raise exception 'That person is not in your team' using errcode = 'P0002';
  end if;
  if v_assignee_role = 'compliance' then
    raise exception 'Compliance reads every work chat and never replies, so it is not given chats' using errcode = '22023';
  end if;
  insert into public.thread_assignments (thread_id, workspace_id, assignee_id, assigned_by)
  select t.id, v_workspace, p_assignee, v_me
  from public.threads t
  where t.workspace_id = v_workspace and t.user_id = p_agent and t.user_id <> p_assignee
  on conflict (thread_id, assignee_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.assign_agent_chats(uuid, uuid) from public, anon;
grant execute on function public.assign_agent_chats(uuid, uuid) to authenticated;

-- Someone leaving the team, or becoming Compliance, no longer holds assignments or a place on any access list. A person
-- who connected a shared inbox cannot become Compliance: Compliance reads through the log, and their own account is
-- that inbox.
create function public.members_drop_access() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if new.role = 'compliance' and exists (select 1 from public.accounts ac where ac.workspace_id = new.workspace_id and ac.user_id = new.user_id) then
    raise exception 'This person connected a shared inbox, so they cannot be Compliance' using errcode = '22023';
  end if;
  if new.status <> 'active' or new.role = 'compliance' then
    delete from public.thread_assignments a where a.workspace_id = new.workspace_id and a.assignee_id = new.user_id;
    delete from public.workspace_inbox_access x where x.workspace_id = new.workspace_id and x.user_id = new.user_id;
  end if;
  return null;
end;
$$;
create trigger members_drop_access after update of status, role on public.workspace_members
  for each row when (old.status is distinct from new.status or old.role is distinct from new.role)
  execute function public.members_drop_access();

-- Someone who connected a shared inbox cannot be removed while it is shared: their account is what its chats live on,
-- and the sync worker would stop sealing what arrives. Step 1's remove_member, with that one check.
create or replace function public.remove_member(p_user uuid) returns void
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
  if exists (select 1 from public.accounts a where a.workspace_id = v_workspace and a.user_id = p_user) then
    raise exception 'This person connected a shared inbox. Disconnect it first, or have the owner connect it again' using errcode = '22023';
  end if;
  update public.workspace_members m set status = 'removed', left_at = now()
  where m.workspace_id = v_workspace and m.user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner's list
-- ---------------------------------------------------------------------------

drop function public.work_chats();

-- A workspace's work chats with no content, for owners and admins, and for Compliance under strict sharing. Who it is with
-- (the label, sealed t1 for the browser to open with the team key), who looks after it and whether they have left, when it
-- last moved, whether the client is waiting and who it is assigned to. p_filter is all, left (the agent has left),
-- awaiting or unassigned. Shared inbox chats are in it too, with the inbox's name. Newest first, a page at a time;
-- total_count is the number the filter matches. Empty for anyone else.
create function public.work_chats(p_filter text default 'all', p_limit integer default 200, p_offset integer default 0)
  returns table (thread_id uuid, agent_id uuid, agent_name text, agent_left boolean, share_label text, channel text, shared_by text,
                 inbox_name text, shared_at timestamptz, last_message_at timestamptz, awaiting_reply boolean, assignee_ids uuid[], total_count bigint)
  language sql stable security definer set search_path = ''
as $$
  with mine as (
    select public.my_workspace_id() as workspace_id, public.my_workspace_role() as role
  ), listed as (
    select t.id, t.user_id, t.share_label, t.channel, t.shared_by, ac.inbox_name, t.shared_at, t.last_message_at,
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
revoke execute on function public.work_chats(text, integer, integer) from public, anon;
grant execute on function public.work_chats(text, integer, integer) to authenticated;

-- How many work chats each filter of the list would show, for the filter menu. Same people as work_chats.
create function public.work_chat_counts() returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'all', count(*),
    'left', count(*) filter (where agent_left),
    'awaiting', count(*) filter (where awaiting),
    'unassigned', count(*) filter (where not assigned)
  )
  from (
    select not exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = t.user_id and m.status = 'active') as agent_left,
           public.thread_awaiting(t) as awaiting,
           exists (select 1 from public.thread_assignments a where a.thread_id = t.id) as assigned
    from public.threads t
    where t.workspace_id = public.my_workspace_id()
      and (public.my_workspace_role() in ('owner', 'admin')
           or (public.my_workspace_role() = 'compliance' and exists (select 1 from public.workspaces w where w.id = t.workspace_id and w.strict_sharing)))
  ) x
$$;
revoke execute on function public.work_chat_counts() from public, anon;
grant execute on function public.work_chat_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- The assignee's, and the shared inbox's, lists
-- ---------------------------------------------------------------------------

-- The chats assigned to the signed-in person, newest first: who looks after the chat, who else is assigned, and the
-- sealed label and preview for the browser to open. Not for Compliance.
create function public.my_assigned_chats()
  returns table (thread_id uuid, agent_id uuid, agent_name text, agent_left boolean, share_label text, preview text, channel text,
                 shared_by text, inbox_name text, last_message_at timestamptz, awaiting_reply boolean, assigned_at timestamptz, assignees jsonb)
  language sql stable security definer set search_path = ''
as $$
  select t.id, t.user_id, public.person_name(t.user_id),
         not exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = t.user_id and m.status = 'active'),
         t.share_label, t.last_message_preview, t.channel, t.shared_by, ac.inbox_name, t.last_message_at, public.thread_awaiting(t), a.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('user_id', o.assignee_id, 'name', public.person_name(o.assignee_id)) order by o.created_at)
           from public.thread_assignments o where o.thread_id = t.id
         ), '[]'::jsonb)
  from public.thread_assignments a
  join public.threads t on t.id = a.thread_id and t.workspace_id = a.workspace_id
  left join public.accounts ac on ac.id = t.account_id and t.shared_by = 'account'
  where a.assignee_id = (select auth.uid()) and a.workspace_id = public.my_workspace_id()
    and coalesce(public.my_workspace_role(), '') <> 'compliance' and t.status <> 'trash'
  order by t.last_message_at desc nulls last
$$;
revoke execute on function public.my_assigned_chats() from public, anon;
grant execute on function public.my_assigned_chats() to authenticated;

-- The workspace's shared inboxes. Someone on an inbox's access list sees it with the number of chats waiting; an owner or
-- admin sees every inbox with who is on its list and whether its account needs attention. Empty for Compliance, which reads
-- inbox chats through the Work Chats list.
create function public.my_shared_inboxes()
  returns table (account_id uuid, inbox_name text, provider text, status text, connected_by uuid, connected_by_name text,
                 has_access boolean, awaiting integer, access jsonb)
  language sql stable security definer set search_path = ''
as $$
  select ac.id, ac.inbox_name, ac.provider, ac.status, ac.user_id, public.person_name(ac.user_id),
         exists (select 1 from public.workspace_inbox_access x where x.account_id = ac.id and x.user_id = (select auth.uid())) as has_access,
         case when exists (select 1 from public.workspace_inbox_access x where x.account_id = ac.id and x.user_id = (select auth.uid()))
              then (select count(*)::integer from public.threads t
                    where t.account_id = ac.id and t.workspace_id = ac.workspace_id and t.status <> 'trash' and not t.junk and public.thread_awaiting(t))
              else 0 end,
         case when public.my_workspace_role() in ('owner', 'admin') then coalesce((
           select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', public.person_name(x.user_id)) order by x.created_at)
           from public.workspace_inbox_access x where x.account_id = ac.id
         ), '[]'::jsonb) else '[]'::jsonb end
  from public.accounts ac
  where ac.workspace_id = public.my_workspace_id() and coalesce(public.my_workspace_role(), '') <> 'compliance'
    and (public.my_workspace_role() in ('owner', 'admin')
         or exists (select 1 from public.workspace_inbox_access x where x.account_id = ac.id and x.user_id = (select auth.uid())))
  order by ac.inbox_name
$$;
revoke execute on function public.my_shared_inboxes() from public, anon;
grant execute on function public.my_shared_inboxes() to authenticated;

-- One shared inbox's chats, newest first, a page at a time (p_before is the last_message_at of the last row seen). For
-- someone on its access list. Conversations in the provider's bin and junk are left out.
create function public.shared_inbox_chats(p_account uuid, p_limit integer default 30, p_before timestamptz default null)
  returns table (thread_id uuid, share_label text, preview text, channel text, last_message_at timestamptz, awaiting_reply boolean, assignees jsonb)
  language sql stable security definer set search_path = ''
as $$
  select t.id, t.share_label, t.last_message_preview, t.channel, t.last_message_at, public.thread_awaiting(t),
         coalesce((
           select jsonb_agg(jsonb_build_object('user_id', o.assignee_id, 'name', public.person_name(o.assignee_id)) order by o.created_at)
           from public.thread_assignments o where o.thread_id = t.id
         ), '[]'::jsonb)
  from public.threads t
  join public.accounts ac on ac.id = t.account_id and ac.workspace_id = t.workspace_id
  where t.account_id = p_account and ac.workspace_id = public.my_workspace_id() and t.status <> 'trash' and not t.junk
    and exists (select 1 from public.workspace_inbox_access x where x.account_id = ac.id and x.user_id = (select auth.uid()))
    and exists (select 1 from public.workspace_members m where m.workspace_id = ac.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role <> 'compliance')
    and (p_before is null or t.last_message_at < p_before)
  order by t.last_message_at desc nulls last, t.id
  limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;
revoke execute on function public.shared_inbox_chats(uuid, integer, timestamptz) from public, anon;
grant execute on function public.shared_inbox_chats(uuid, integer, timestamptz) to authenticated;

-- What the shared chat's page needs beyond its messages, with no content: who looks after it, who else is assigned, how the
-- caller is allowed in and how they may reply. Null when the caller cannot open it (an owner or admin must assign it to
-- themselves first, Compliance must have opened it).
-- access: agent, assignee, inbox or compliance. reply: inbox (from the shared account), own (from the caller's own
-- account, as an assignee) or null.
create function public.shared_chat_info(p_thread uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'thread_id', t.id,
    'workspace_id', t.workspace_id,
    'label', t.share_label,
    'subject', t.subject,
    'channel', t.channel,
    'is_group', t.is_group,
    'shared_by', t.shared_by,
    'agent_id', t.user_id,
    'agent_name', public.person_name(t.user_id),
    'agent_left', not exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = t.user_id and m.status = 'active'),
    'account_id', t.account_id,
    'inbox_name', ac.inbox_name,
    'role', public.my_workspace_role(),
    'access', case
      when t.user_id = (select auth.uid()) then 'agent'
      when exists (select 1 from public.thread_assignments a where a.thread_id = t.id and a.assignee_id = (select auth.uid())) then 'assignee'
      when t.shared_by = 'account' and public.user_can_reply_in_inbox(t.id, (select auth.uid())) then 'inbox'
      else 'compliance' end,
    'reply', case
      when t.shared_by = 'account' and public.user_can_reply_in_inbox(t.id, (select auth.uid())) then 'inbox'
      when public.is_assignee(t.id) then 'own'
      else null end,
    'assignees', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', o.assignee_id, 'name', public.person_name(o.assignee_id)) order by o.created_at)
      from public.thread_assignments o where o.thread_id = t.id
    ), '[]'::jsonb)
  )
  from public.threads t
  left join public.accounts ac on ac.id = t.account_id and t.shared_by = 'account'
  where t.id = p_thread and public.can_open_thread(p_thread)
$$;
revoke execute on function public.shared_chat_info(uuid) from public, anon;
grant execute on function public.shared_chat_info(uuid) to authenticated;

-- Takes a shared inbox chat for one person, replacing whoever had it: someone on the inbox's access list assigns it to
-- themselves or to another person on the list; an owner or admin may assign it to anyone on the list. p_assignee null clears it.
create function public.assign_inbox_chat(p_thread uuid, p_assignee uuid) returns void
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
  delete from public.thread_assignments a where a.thread_id = p_thread;
  if p_assignee is not null then
    insert into public.thread_assignments (thread_id, workspace_id, assignee_id, assigned_by)
    values (p_thread, v_thread.workspace_id, p_assignee, v_me);
  end if;
end;
$$;
revoke execute on function public.assign_inbox_chat(uuid, uuid) from public, anon;
grant execute on function public.assign_inbox_chat(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Making an account a shared inbox
-- ---------------------------------------------------------------------------

-- An owner or admin turns one of their own connected accounts into the workspace's shared inbox. Every chat on it, now and
-- from here on, is shared in full (shared_by account, the whole history), and the sync worker seals it with the team key.
-- They are put on the access list. Email and WhatsApp accounts only. It cannot be undone here: the chats stay shared.
create function public.share_account(p_account uuid, p_name text) returns integer
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

  select coalesce(array_agg(t.id), '{}') into v_ids from public.threads t where t.account_id = p_account and t.workspace_id is null;
  update public.threads t set workspace_id = v_workspace, shared_at = now(), shared_by = 'account', share_from = null where t.id = any (v_ids);
  delete from public.share_jobs j where j.thread_id = any (v_ids) and j.status = 'queued';
  insert into public.share_jobs (thread_id, user_id, workspace_id, direction)
  select t.id, t.user_id, v_workspace, 'to_work' from public.threads t where t.id = any (v_ids);
  return coalesce(cardinality(v_ids), 0);
end;
$$;
revoke execute on function public.share_account(uuid, text) from public, anon;
grant execute on function public.share_account(uuid, text) to authenticated;

-- A new chat on a shared account is shared from the moment it exists: before the insert, so there is no instant when it is
-- personal. Its messages queue the follow-up jobs that seal it (step 3's triggers see a shared chat).
create function public.threads_share_inbox() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  if new.workspace_id is not null then return new; end if;
  select a.workspace_id into v_workspace from public.accounts a where a.id = new.account_id;
  if v_workspace is not null then
    new.workspace_id := v_workspace;
    new.shared_at := now();
    new.shared_by := 'account';
    new.share_from := null;
  end if;
  return new;
end;
$$;
create trigger threads_share_inbox before insert on public.threads for each row execute function public.threads_share_inbox();

-- A shared inbox's chats cannot go back to personal.
create function public.threads_keep_inbox_shared() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  if old.shared_by = 'account' and new.workspace_id is null then
    raise exception 'This chat is part of a shared inbox, so it stays shared' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger threads_keep_inbox_shared before update of workspace_id on public.threads
  for each row execute function public.threads_keep_inbox_shared();

-- Who can use a shared inbox: an owner or admin sets the list. p_users are active members, never Compliance; whoever
-- connected the account always stays. Someone taken off the list loses the chats they were assigned in that inbox.
create function public.set_inbox_access(p_account uuid, p_users uuid[]) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_account public.accounts;
  v_user uuid;
begin
  if coalesce(public.my_workspace_role(), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can choose who uses an inbox' using errcode = '42501';
  end if;
  select a.* into v_account from public.accounts a where a.id = p_account;
  if not found or v_account.workspace_id is distinct from public.my_workspace_id() then
    raise exception 'That is not a shared inbox of your team' using errcode = 'P0002';
  end if;
  foreach v_user in array coalesce(p_users, '{}') loop
    if not exists (select 1 from public.workspace_members m where m.workspace_id = v_account.workspace_id and m.user_id = v_user and m.status = 'active' and m.role <> 'compliance') then
      raise exception 'Only active members, other than Compliance, can use an inbox' using errcode = '22023';
    end if;
  end loop;

  delete from public.thread_assignments a
  using public.threads t
  where a.thread_id = t.id and t.account_id = p_account
    and a.assignee_id <> all (coalesce(p_users, '{}') || v_account.user_id);
  delete from public.workspace_inbox_access x
  where x.account_id = p_account and x.user_id <> all (coalesce(p_users, '{}') || v_account.user_id);
  insert into public.workspace_inbox_access (account_id, workspace_id, user_id, added_by)
  select p_account, v_account.workspace_id, u, v_me from unnest(coalesce(p_users, '{}') || v_account.user_id) u
  on conflict (account_id, user_id) do nothing;
end;
$$;
revoke execute on function public.set_inbox_access(uuid, uuid[]) from public, anon;
grant execute on function public.set_inbox_access(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

-- Adds a note to a shared chat. The caller can open the chat and is not Compliance, which only reads. The body must
-- already be sealed with the team key (the table checks it). Returns the note's id.
create function public.add_thread_note(p_thread uuid, p_body text) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid;
  v_id uuid;
begin
  if coalesce(public.my_workspace_role(), '') in ('', 'compliance') then
    raise exception 'You cannot add notes here' using errcode = '42501';
  end if;
  select t.workspace_id into v_workspace from public.threads t where t.id = p_thread and public.can_open_thread(p_thread);
  if v_workspace is null then
    raise exception 'You cannot open this chat' using errcode = '42501';
  end if;
  insert into public.thread_notes (thread_id, workspace_id, user_id, body)
  values (p_thread, v_workspace, (select auth.uid()), p_body)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.add_thread_note(uuid, text) from public, anon;
grant execute on function public.add_thread_note(uuid, text) to authenticated;

-- Deletes your own note.
create function public.delete_thread_note(p_note uuid) returns void
  language sql security definer set search_path = ''
as $$
  delete from public.thread_notes n where n.id = p_note and n.user_id = (select auth.uid())
$$;
revoke execute on function public.delete_thread_note(uuid) from public, anon;
grant execute on function public.delete_thread_note(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Compliance
-- ---------------------------------------------------------------------------

-- Compliance opens a work chat: this writes the row the agent sees, and opens the chat for them for 4 hours. A new row is
-- only written when their last one for the chat is over 3 hours old, so reading a long chat does not fill the log.
create function public.log_compliance_open(p_thread uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_workspace uuid := public.my_workspace_id();
begin
  if public.my_workspace_role() is distinct from 'compliance'
     or not exists (select 1 from public.workspaces w where w.id = v_workspace and w.strict_sharing) then
    raise exception 'Only Compliance, under strict sharing, opens chats this way' using errcode = '42501';
  end if;
  if not exists (select 1 from public.threads t where t.id = p_thread and t.workspace_id = v_workspace) then
    raise exception 'That is not a work chat of your team' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.compliance_opens o
    where o.thread_id = p_thread and o.user_id = v_me and o.opened_at > now() - interval '3 hours'
  ) then
    insert into public.compliance_opens (workspace_id, thread_id, user_id) values (v_workspace, p_thread, v_me);
  end if;
end;
$$;
revoke execute on function public.log_compliance_open(uuid) from public, anon;
grant execute on function public.log_compliance_open(uuid) to authenticated;

-- The agent's own list (step 3's) with the days Compliance opened each chat, newest first (the last five), and the shared
-- inbox's chats only when Compliance opened them (the inbox has its own screen, and the agent here is whoever connected it).
drop function public.my_shared_chats();
create function public.my_shared_chats()
  returns table (thread_id uuid, share_label text, channel text, shared_at timestamptz, shared_by text, share_from timestamptz,
                 last_message_at timestamptz, state text, assignees jsonb, compliance_opens jsonb)
  language sql stable security definer set search_path = ''
as $$
  select t.id, t.share_label, t.channel, t.shared_at, t.shared_by, t.share_from, t.last_message_at,
         case
           when exists (select 1 from public.share_jobs j where j.thread_id = t.id and not j.follow_up and j.direction = 'to_work'
                          and (j.status in ('queued', 'working') or (j.status = 'failed' and j.attempts < 5))) then 'sharing'
           when exists (select 1 from public.share_jobs j where j.thread_id = t.id and not j.follow_up and j.direction = 'to_work'
                          and j.status = 'failed' and j.attempts >= 5) then 'failed'
           else 'shared'
         end,
         coalesce((
           select jsonb_agg(jsonb_build_object('user_id', a.assignee_id, 'name', coalesce(nullif(p.display_name, ''), u.email)) order by a.created_at)
           from public.thread_assignments a
           join auth.users u on u.id = a.assignee_id
           left join public.profiles p on p.user_id = a.assignee_id
           where a.thread_id = t.id
         ), '[]'::jsonb),
         coalesce((
           select jsonb_agg(d.day order by d.day desc)
           from (select distinct (o.opened_at at time zone 'utc')::date as day from public.compliance_opens o where o.thread_id = t.id
                 order by 1 desc limit 5) d
         ), '[]'::jsonb)
  from public.threads t
  where t.user_id = (select auth.uid()) and t.workspace_id is not null
    and (t.shared_by is distinct from 'account' or exists (select 1 from public.compliance_opens o where o.thread_id = t.id))
  order by t.shared_at desc
$$;
revoke execute on function public.my_shared_chats() from public, anon;
grant execute on function public.my_shared_chats() to authenticated;

-- ---------------------------------------------------------------------------
-- Response tracking
-- ---------------------------------------------------------------------------

-- Per person, for owners and admins: work chats waiting for an answer (the client's message arrived in the last 7 or 30
-- days and nothing has answered it) and the median time from a client's message to the first answer, over the last 7 and
-- 30 days. Timestamps and directions only, never text, and only chats that are in the workspace: a personal chat is not.
-- A chat is the agent's, or for a shared inbox whoever it is assigned to (the first, if several), else nobody (user_id
-- null). An answer is an outbound message in the chat or a reply an assignee sent from their own account for it. A
-- conversation turn starts at a client message that follows an answer or opens the chat; a message sent before a chat's
-- Share From date is not looked at. Newsletters and notifications, junk and bin are left out. Seconds, null when no turn was
-- answered in the window.
create function public.team_response_stats()
  returns table (user_id uuid, name text, role text, active boolean, unanswered_7d integer, unanswered_30d integer,
                 answered_7d integer, answered_30d integer, median_reply_7d integer, median_reply_30d integer)
  language sql stable security definer set search_path = ''
as $$
  with me as (
    select m.workspace_id from public.workspace_members m
    where m.user_id = (select auth.uid()) and m.status = 'active' and m.role in ('owner', 'admin')
  ), chats as (
    select t.id, t.last_message_at, t.share_from, public.thread_awaiting(t) as awaiting,
           case when t.shared_by = 'account'
                then (select a.assignee_id from public.thread_assignments a where a.thread_id = t.id order by a.created_at limit 1)
                else t.user_id end as owner_id
    from public.threads t join me on t.workspace_id = me.workspace_id
    where t.status <> 'trash' and not t.junk and coalesce(t.category, '') not in ('newsletter', 'notification')
  ), events as (
    select m.thread_id, m.sent_at, m.direction
    from public.messages m join chats c on c.id = m.thread_id
    where m.sent_at >= now() - interval '31 days' and (c.share_from is null or m.sent_at >= c.share_from)
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
revoke execute on function public.team_response_stats() from public, anon;
grant execute on function public.team_response_stats() to authenticated;

-- The weekly counts of chats moved back to personal and chats shared, per person, for the last 8 weeks, for owners and
-- admins. Counts only: never which chats.
create function public.team_moved_back()
  returns table (week date, user_id uuid, name text, chats_shared integer, chats_moved_back integer)
  language sql stable security definer set search_path = ''
as $$
  select a.week, a.user_id, public.person_name(a.user_id), a.chats_shared, a.chats_moved_back
  from public.workspace_activity a
  where a.workspace_id = public.my_workspace_id() and coalesce(public.my_workspace_role(), '') in ('owner', 'admin')
    and a.week >= (date_trunc('week', now() at time zone 'utc') - interval '7 weeks')::date
    and (a.chats_shared > 0 or a.chats_moved_back > 0)
  order by a.week desc, a.chats_moved_back desc, 3
$$;
revoke execute on function public.team_moved_back() from public, anon;
grant execute on function public.team_moved_back() to authenticated;

-- ---------------------------------------------------------------------------
-- "Someone is replying": Realtime presence, one private channel per chat
-- ---------------------------------------------------------------------------

-- Presence rides on a private channel named chat:<thread id>. Whoever can open the chat may join it and see who else is
-- there; the payload is a name and a typing flag, never text. Skipped where Realtime Authorization is not installed.
create function public.presence_chat_ok(p_topic text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select case when p_topic ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.can_open_thread(substring(p_topic from 6)::uuid) else false end
$$;
revoke execute on function public.presence_chat_ok(text) from public, anon;
grant execute on function public.presence_chat_ok(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$create policy "Presence in chats you can open (read)" on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'presence' and public.presence_chat_ok(realtime.topic()))$p$;
    execute $p$create policy "Presence in chats you can open (write)" on realtime.messages for insert to authenticated
      with check (realtime.messages.extension = 'presence' and public.presence_chat_ok(realtime.topic()))$p$;
  end if;
end
$$;
