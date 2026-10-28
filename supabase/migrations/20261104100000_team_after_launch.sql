-- Soon after launch: step 6 of Teams (docs/PLAN.md, Teams). Company voice, cover, the compliance export and the shared
-- contacts page. Not applied by whoever wrote it: apply by hand, after 20261103100000_team_owner_features.sql.
--
--   * Company voice: workspace_voice_items holds what the team teaches the AI about the business, all sealed with the team key
--     ("t1:", which the table insists on): a profile (tone, sign-off, things to always say, things to never say), templates
--     (a name and a body) and company facts (a title and a body). Every active member reads them; only an owner or admin writes
--     them, through save_voice_item and delete_voice_item. The AI worker reads them with company_voice_for_draft, which returns
--     nothing unless the chat is a work chat of the person's own workspace, so a personal chat never gets any of it.
--   * Cover: workspace_cover is a dated table (absent member, covering member, start, end). While a row is in force the covering
--     member reads the absent member's work chats as if they were assigned: can_read_thread and is_assignee ask i_cover, so the
--     step 5 reply path (a new conversation from their OWN account with outbox.for_thread_id) works unchanged. Cover ends by
--     itself when ends_at passes, because the policies compare it with now(): there is no job and nothing to forget. It is
--     ended early by end_cover, or when either person leaves the team. Chats of a shared inbox are not covered this way: the
--     inbox's own access list decides who reads those. Replying from the absent member's own number is NOT built: only the
--     setting's storage is (workspace_members.allow_cover_reply, set by the member themselves, default off, read by nothing).
--   * Compliance export: for a workspace with strict sharing on, only Compliance exports one team client's work
--     history. workspace_contact_threads says which shared chats are with which client (filled by the sync worker, no content).
--     begin_client_export writes the content-free log row first (who, which client sealed t1, when) and returns the chats, and
--     export_chat_messages and export_chat_notes read only while that row is open, from each chat's Share From date on. The
--     browser opens the t1 values and builds the file, so no plaintext reaches the server. finish_client_export records how
--     many messages were read. The log is read by owners and admins, and each agent sees which of their chats were included.
--   * Shared contacts page: owners and admins rename a client, set or clear their company, change who looks after them, merge
--     two clients and remove a client or company from the team list. Removing records the identities in
--     workspace_client_exclusions so the sync worker's next pass does not add them back, and never unshares a chat.
--
-- Not here, on purpose: replying from an absent member's own number, templates inside the AI prompt for a chat that is not a
-- work chat, attachment files in the export (names only), and a team key rotation of thread_notes (step 5).

-- ---------------------------------------------------------------------------
-- Company voice
-- ---------------------------------------------------------------------------

create table public.workspace_voice_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('profile', 'template', 'fact')),
  slot text check (slot in ('tone', 'sign_off', 'always', 'never')),   -- a profile's parts, one row each
  title text,                    -- a template's name or a fact's title, sealed t1 (none for the profile)
  body text not null,            -- sealed t1
  position integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_items_sealed check (body like 't1:%' and (title is null or title like 't1:%')),
  constraint voice_items_shape check (
    (kind = 'profile' and slot is not null and title is null)
    or (kind in ('template', 'fact') and slot is null and title is not null)),
  constraint voice_items_size check (length(body) <= 6000 and coalesce(length(title), 0) <= 400)
);
create unique index workspace_voice_profile_slot on public.workspace_voice_items (workspace_id, slot) where kind = 'profile';
create index workspace_voice_items_idx on public.workspace_voice_items (workspace_id, kind, position);
create trigger set_updated_at before update on public.workspace_voice_items for each row execute function public.set_updated_at();

alter table public.workspace_voice_items enable row level security;
revoke all on public.workspace_voice_items from anon, authenticated;
grant select on public.workspace_voice_items to authenticated;
-- Every active member reads them (the composer inserts templates for anyone). Writing goes through the functions below.
create policy "Members read the company voice" on public.workspace_voice_items for select to authenticated
  using (workspace_id = public.my_workspace_id());

-- Adds or changes one item. p_body (and p_title, for a template or fact) must already be sealed with the team key. A profile
-- part is one row per slot, so saving it again replaces it. p_id null adds a template or fact (at most 40 and 100); with an
-- id it changes that item. Owner or admin only.
create function public.save_voice_item(p_id uuid, p_kind text, p_slot text, p_title text, p_body text) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_workspace uuid := public.my_workspace_id();
  v_id uuid;
  v_room integer;
begin
  if coalesce(public.my_workspace_role(), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can change the company voice' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('profile', 'template', 'fact') then
    raise exception 'Choose what to save' using errcode = '22023';
  end if;
  if p_body is null or p_body not like 't1:%' or length(p_body) > 6000
     or (p_kind <> 'profile' and (p_title is null or p_title not like 't1:%' or length(p_title) > 400))
     or (p_kind = 'profile' and p_title is not null) then
    raise exception 'The text must be sealed with the team key first' using errcode = '22023';
  end if;

  if p_kind = 'profile' then
    if p_slot is null or p_slot not in ('tone', 'sign_off', 'always', 'never') then
      raise exception 'Choose which part of the profile this is' using errcode = '22023';
    end if;
    insert into public.workspace_voice_items (workspace_id, kind, slot, body, created_by, updated_by)
    values (v_workspace, 'profile', p_slot, p_body, v_me, v_me)
    on conflict (workspace_id, slot) where kind = 'profile'
    do update set body = excluded.body, updated_by = v_me
    returning id into v_id;
    return v_id;
  end if;

  if p_slot is not null then
    raise exception 'Only the profile has parts' using errcode = '22023';
  end if;
  if p_id is null then
    -- Locks the workspace's items so two saves at once cannot both take the last place.
    perform pg_advisory_xact_lock(hashtextextended('voice:' || v_workspace::text, 0));
    v_room := case p_kind when 'template' then 40 else 100 end;
    if (select count(*) from public.workspace_voice_items v where v.workspace_id = v_workspace and v.kind = p_kind) >= v_room then
      raise exception 'There is no room for another %', replace(p_kind, 'fact', 'company fact') using errcode = '22023';
    end if;
    insert into public.workspace_voice_items (workspace_id, kind, title, body, position, created_by, updated_by)
    values (v_workspace, p_kind, p_title, p_body,
            coalesce((select max(v.position) from public.workspace_voice_items v where v.workspace_id = v_workspace and v.kind = p_kind), 0) + 1, v_me, v_me)
    returning id into v_id;
    return v_id;
  end if;
  update public.workspace_voice_items v set title = p_title, body = p_body, updated_by = v_me
  where v.id = p_id and v.workspace_id = v_workspace and v.kind = p_kind
  returning v.id into v_id;
  if v_id is null then
    raise exception 'That item no longer exists' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;
revoke execute on function public.save_voice_item(uuid, text, text, text, text) from public, anon;
grant execute on function public.save_voice_item(uuid, text, text, text, text) to authenticated;

create function public.delete_voice_item(p_id uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(public.my_workspace_role(), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can change the company voice' using errcode = '42501';
  end if;
  delete from public.workspace_voice_items v where v.id = p_id and v.workspace_id = public.my_workspace_id();
end;
$$;
revoke execute on function public.delete_voice_item(uuid) from public, anon;
grant execute on function public.delete_voice_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cover
-- ---------------------------------------------------------------------------

-- Written by the member themselves and read by nothing yet: replying from someone's own number needs the worker to send from
-- another person's account, which is not built. Only the setting is stored.
alter table public.workspace_members add column allow_cover_reply boolean not null default false;

create function public.set_allow_cover_reply(p_allow boolean) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  update public.workspace_members m set allow_cover_reply = coalesce(p_allow, false)
  where m.user_id = (select auth.uid()) and m.status = 'active';
  if not found then
    raise exception 'You are not in a team' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.set_allow_cover_reply(boolean) from public, anon;
grant execute on function public.set_allow_cover_reply(boolean) to authenticated;

create table public.workspace_cover (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  absent_id uuid not null references auth.users (id) on delete cascade,
  cover_id uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,                    -- the cover has ended once now() reaches this
  ended_at timestamptz,                            -- set when it was ended early
  ended_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (absent_id <> cover_id),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '184 days')
);
create index workspace_cover_workspace_idx on public.workspace_cover (workspace_id, ends_at desc);
create index workspace_cover_absent_idx on public.workspace_cover (absent_id, workspace_id);
create index workspace_cover_cover_idx on public.workspace_cover (cover_id, workspace_id);

alter table public.workspace_cover enable row level security;
revoke all on public.workspace_cover from anon, authenticated;
grant select on public.workspace_cover to authenticated;
-- The absent member sees who covered and when, the covering member sees what they cover, an owner or admin sees all of them.
create policy "Read cover periods" on public.workspace_cover for select to authenticated
  using (
    workspace_id = public.my_workspace_id()
    and (absent_id = (select auth.uid()) or cover_id = (select auth.uid()) or public.my_workspace_role() in ('owner', 'admin'))
  );

-- The AI worker's read (service role). The company voice of the chat's workspace, still sealed, and only when the chat is a work
-- chat (threads.workspace_id is set, shared inbox chats included) of a workspace the person is an active member of, and the
-- person is the chat's agent, someone it is assigned to, or covering the agent. A personal chat has no workspace, so it gets
-- null and the draft is written exactly as it was before teams. Items are in a stable order, so the start of the prompt stays
-- the same from draft to draft.
create function public.company_voice_for_draft(p_user uuid, p_thread uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'workspace_id', t.workspace_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('kind', v.kind, 'slot', v.slot, 'title', v.title, 'body', v.body) order by v.kind, v.position, v.created_at, v.id)
      from public.workspace_voice_items v where v.workspace_id = t.workspace_id
    ), '[]'::jsonb))
  from public.threads t
  where t.id = p_thread and t.workspace_id is not null
    and exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = p_user and m.status = 'active')
    and (t.user_id = p_user
         or exists (select 1 from public.thread_assignments a where a.thread_id = t.id and a.assignee_id = p_user)
         or exists (
           select 1 from public.workspace_cover c
           where c.workspace_id = t.workspace_id and c.absent_id = t.user_id and c.cover_id = p_user and t.shared_by is distinct from 'account'
             and c.ended_at is null and c.starts_at <= now() and now() < c.ends_at))
$$;
revoke execute on function public.company_voice_for_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.company_voice_for_draft(uuid, uuid) to service_role;

-- Whether the signed-in person is covering p_absent in this workspace right now: a period that has started, not ended, not
-- ended early, with both people still active and the covering one not Compliance (which only reads through its log).
create function public.i_cover(p_workspace uuid, p_absent uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select p_workspace is not null and exists (
    select 1 from public.workspace_cover c
    where c.workspace_id = p_workspace and c.absent_id = p_absent and c.cover_id = (select auth.uid())
      and c.ended_at is null and c.starts_at <= now() and now() < c.ends_at
      and exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace and m.user_id = c.absent_id and m.status = 'active')
      and exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace and m.user_id = c.cover_id and m.status = 'active' and m.role <> 'compliance')
  )
$$;
revoke execute on function public.i_cover(uuid, uuid) from public, anon;
grant execute on function public.i_cover(uuid, uuid) to authenticated;

-- Step 5's, with one more way in: covering the chat's agent. A shared inbox chat is read through the inbox's access list.
create or replace function public.can_read_thread(p_thread uuid, p_workspace uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select p_workspace is not null and exists (
    select 1 from public.threads t
    where t.id = p_thread and t.workspace_id = p_workspace and p_workspace = public.my_workspace_id()
      and (
        exists (select 1 from public.thread_assignments a where a.thread_id = t.id and a.assignee_id = (select auth.uid()))
        or (t.shared_by is distinct from 'account' and public.i_cover(t.workspace_id, t.user_id))
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

-- Step 5's, so a covering member answers from their own account exactly as an assignee does.
create or replace function public.is_assignee(p_thread uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.thread_assignments a
    join public.threads t on t.id = a.thread_id and t.workspace_id = a.workspace_id
    join public.workspace_members m on m.workspace_id = a.workspace_id and m.user_id = a.assignee_id and m.status = 'active' and m.role <> 'compliance'
    where a.thread_id = p_thread and a.assignee_id = (select auth.uid())
  ) or exists (
    select 1 from public.threads t
    where t.id = p_thread and t.workspace_id is not null and t.shared_by is distinct from 'account' and public.i_cover(t.workspace_id, t.user_id)
  )
$$;

-- An owner or admin sets cover for anyone; a member sets it for themselves. Both must be active members, the covering one not
-- Compliance. It starts now or later and ends in the future, within about six months. The same two people cannot have
-- overlapping periods. Returns the period's id.
create function public.set_cover(p_absent uuid, p_cover uuid, p_starts timestamptz, p_ends timestamptz) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_workspace uuid := public.my_workspace_id();
  v_role text := public.my_workspace_role();
  v_id uuid;
begin
  if v_workspace is null then
    raise exception 'You are not in a team' using errcode = '42501';
  end if;
  if not (v_role in ('owner', 'admin') or p_absent = v_me) then
    raise exception 'Only an owner or admin can set cover for someone else' using errcode = '42501';
  end if;
  if p_absent is null or p_cover is null or p_absent = p_cover then
    raise exception 'Choose two different people' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = v_workspace and m.user_id = p_absent and m.status = 'active') then
    raise exception 'The person who is away is not in your team' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = v_workspace and m.user_id = p_cover and m.status = 'active') then
    raise exception 'The person covering is not in your team' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.workspace_members m where m.workspace_id = v_workspace and m.user_id = p_cover and m.role = 'compliance') then
    raise exception 'Compliance reads work chats through its own log and never replies, so it cannot cover' using errcode = '22023';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then
    raise exception 'The end must be after the start' using errcode = '22023';
  end if;
  if p_ends <= now() then
    raise exception 'The end date is in the past' using errcode = '22023';
  end if;
  if p_ends - p_starts > interval '184 days' or p_starts > now() + interval '1 year' then
    raise exception 'Cover can run for up to six months, starting within a year' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cover:' || v_workspace::text, 0));
  if exists (
    select 1 from public.workspace_cover c
    where c.workspace_id = v_workspace and c.absent_id = p_absent and c.cover_id = p_cover and c.ended_at is null
      and c.ends_at > now() and c.ends_at > p_starts and c.starts_at < p_ends
  ) then
    raise exception 'These two people already have cover over those dates' using errcode = '23505';
  end if;
  insert into public.workspace_cover (workspace_id, absent_id, cover_id, starts_at, ends_at, created_by)
  values (v_workspace, p_absent, p_cover, p_starts, p_ends, v_me)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.set_cover(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.set_cover(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- Ends a period that has not ended yet: an owner or admin, the person who is away, or the person covering. A period that has
-- not started is cancelled. The row stays, so the absent member keeps the record of who covered and when.
create function public.end_cover(p_id uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_row public.workspace_cover;
begin
  select c.* into v_row from public.workspace_cover c where c.id = p_id and c.workspace_id = public.my_workspace_id() for update;
  if not found then
    raise exception 'That cover period does not exist' using errcode = 'P0002';
  end if;
  if not (public.my_workspace_role() in ('owner', 'admin') or v_row.absent_id = v_me or v_row.cover_id = v_me) then
    raise exception 'Only an owner, an admin or the people involved can end cover' using errcode = '42501';
  end if;
  if v_row.ended_at is not null or v_row.ends_at <= now() then
    raise exception 'That cover has already ended' using errcode = '22023';
  end if;
  update public.workspace_cover c set ended_at = now(), ended_by = v_me where c.id = p_id;
end;
$$;
revoke execute on function public.end_cover(uuid) from public, anon;
grant execute on function public.end_cover(uuid) to authenticated;

-- Someone who leaves the team, or becomes Compliance while covering, ends the cover they were part of. The row's own check
-- (i_cover) already stops reading for anyone not active, so this only keeps the record honest and stops a returning member
-- from picking an old period up again.
create function public.members_end_cover() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  update public.workspace_cover c set ended_at = now(), ended_by = null
  where c.workspace_id = new.workspace_id and c.ended_at is null and c.ends_at > now()
    and ((c.absent_id = new.user_id and new.status <> 'active')
         or (c.cover_id = new.user_id and (new.status <> 'active' or new.role = 'compliance')));
  return null;
end;
$$;
create trigger members_end_cover after update of status, role on public.workspace_members
  for each row when (old.status is distinct from new.status or old.role is distinct from new.role)
  execute function public.members_end_cover();

-- Step 5's list, with the chats the person covers: the chats assigned to them and, while a cover period is in force, the work
-- chats of the person they cover for. cover_until is the end of the period for a covered chat, null for an assigned one.
drop function public.my_assigned_chats();
create function public.my_assigned_chats()
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
         t.share_label, t.last_message_preview, t.channel, t.shared_by, ac.inbox_name, t.last_message_at, public.thread_awaiting(t), mine.since,
         coalesce((
           select jsonb_agg(jsonb_build_object('user_id', o.assignee_id, 'name', public.person_name(o.assignee_id)) order by o.created_at)
           from public.thread_assignments o where o.thread_id = t.id
         ), '[]'::jsonb),
         mine.cover_end
  from mine
  join public.threads t on t.id = mine.thread_id
  left join public.accounts ac on ac.id = t.account_id and t.shared_by = 'account'
  where coalesce(public.my_workspace_role(), '') <> 'compliance' and t.status <> 'trash'
  order by t.last_message_at desc nulls last
$$;
revoke execute on function public.my_assigned_chats() from public, anon;
grant execute on function public.my_assigned_chats() to authenticated;

-- Step 5's, with a fifth way in ('cover') and when it ends. reply is 'own' for a covering member, as for an assignee.
create or replace function public.shared_chat_info(p_thread uuid) returns jsonb
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
      when t.shared_by is distinct from 'account' and public.i_cover(t.workspace_id, t.user_id) then 'cover'
      when t.shared_by = 'account' and public.user_can_reply_in_inbox(t.id, (select auth.uid())) then 'inbox'
      else 'compliance' end,
    'cover_ends', (
      select max(c.ends_at) from public.workspace_cover c
      where c.workspace_id = t.workspace_id and c.absent_id = t.user_id and c.cover_id = (select auth.uid())
        and c.ended_at is null and c.starts_at <= now() and now() < c.ends_at),
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

-- ---------------------------------------------------------------------------
-- The team's client list: links to chats, removals, and the owner's edits
-- ---------------------------------------------------------------------------

-- Which shared chats are with which client. Filled by the sync worker when a chat is shared (link_thread_clients), by the same
-- team blind indexes that match the client list. No content, no policies and no grants: the compliance export reads it through
-- begin_client_export, and nobody else reads it, so the Team Clients page stays names only.
create table public.workspace_contact_threads (
  workspace_contact_id uuid not null,
  workspace_id uuid not null,
  thread_id uuid not null references public.threads (id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (workspace_contact_id, thread_id),
  foreign key (workspace_contact_id, workspace_id) references public.workspace_contacts (id, workspace_id) on delete cascade
);
create index workspace_contact_threads_thread_idx on public.workspace_contact_threads (thread_id);

alter table public.workspace_contact_threads enable row level security;
revoke all on public.workspace_contact_threads from anon, authenticated;

-- Identities and companies an owner or admin removed from the list. upsert_workspace_contact skips them, so the next chat that
-- is shared (or the next follow-up for one already shared) does not add them straight back. No policies and no grants.
create table public.workspace_client_exclusions (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('identity', 'company')),
  value_index text not null,
  removed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, kind, value_index)
);

alter table public.workspace_client_exclusions enable row level security;
revoke all on public.workspace_client_exclusions from anon, authenticated;

-- Links a shared chat to every client holding any of these team indexes (the addresses and numbers of the people in it). The
-- chat must be shared in that workspace. The same call twice changes nothing. Worker only. Returns how many links were added.
create function public.link_thread_clients(p_workspace uuid, p_thread uuid, p_indexes text[]) returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(cardinality(p_indexes), 0) = 0
     or not exists (select 1 from public.threads t where t.id = p_thread and t.workspace_id = p_workspace) then
    return 0;
  end if;
  insert into public.workspace_contact_threads (workspace_contact_id, workspace_id, thread_id)
  select distinct i.workspace_contact_id, p_workspace, p_thread
  from public.workspace_contact_identities i
  where i.workspace_id = p_workspace and i.value_index = any (p_indexes)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.link_thread_clients(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.link_thread_clients(uuid, uuid, text[]) to service_role;

-- Step 4's, with one more rule: an identity or company an owner or admin removed is not added back. A client whose every
-- address was removed is not added at all.
create or replace function public.upsert_workspace_contact(
  p_workspace uuid, p_agent uuid, p_name text, p_company_name text, p_company_domain_index text, p_identities jsonb
) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_identities jsonb;
  v_company_name text := p_company_name;
  v_company_index text := p_company_domain_index;
begin
  if coalesce(p_name, '') = '' or jsonb_typeof(p_identities) is distinct from 'array' or jsonb_array_length(p_identities) = 0 then
    return null;
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace and m.user_id = p_agent and m.status = 'active') then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text, 0));

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_identities
  from jsonb_array_elements(p_identities) x
  where not exists (
    select 1 from public.workspace_client_exclusions e
    where e.workspace_id = p_workspace and e.kind = 'identity' and e.value_index = x ->> 'index');
  if jsonb_array_length(v_identities) = 0 then
    return null;
  end if;
  if v_company_index is not null and exists (
    select 1 from public.workspace_client_exclusions e where e.workspace_id = p_workspace and e.kind = 'company' and e.value_index = v_company_index) then
    v_company_name := null;
    v_company_index := null;
  end if;

  select i.workspace_contact_id into v_id
  from public.workspace_contact_identities i
  join public.workspace_contacts c on c.id = i.workspace_contact_id
  where i.workspace_id = p_workspace and i.value_index in (select x ->> 'index' from jsonb_array_elements(v_identities) x)
  order by c.created_at, c.id
  limit 1;

  if v_id is null then
    insert into public.workspace_contacts (workspace_id, name, company_name, company_domain_index)
    values (p_workspace, p_name, v_company_name, v_company_index)
    returning id into v_id;
  elsif v_company_name is not null or v_company_index is not null then
    update public.workspace_contacts c
    set company_name = coalesce(c.company_name, v_company_name), company_domain_index = coalesce(c.company_domain_index, v_company_index)
    where c.id = v_id and (c.company_name is null or c.company_domain_index is null);
  end if;

  insert into public.workspace_contact_identities (workspace_contact_id, workspace_id, kind, value_index, value)
  select v_id, p_workspace, x ->> 'kind', x ->> 'index', x ->> 'value'
  from jsonb_array_elements(v_identities) x
  where coalesce(x ->> 'index', '') <> '' and coalesce(x ->> 'value', '') <> ''
  on conflict (workspace_id, value_index) do nothing;

  insert into public.workspace_contact_agents (workspace_contact_id, workspace_id, user_id)
  values (v_id, p_workspace, p_agent)
  on conflict (workspace_contact_id, user_id) do update set left_team = false;

  if v_company_index is not null and coalesce(v_company_name, '') <> '' then
    insert into public.workspace_companies (workspace_id, domain_index, name)
    values (p_workspace, v_company_index, v_company_name)
    on conflict (workspace_id, domain_index) do nothing;
  end if;
  return v_id;
end;
$$;

-- Every edit below is for an owner or admin, on a client of their own workspace. Members keep the read-only list.
create function public.require_client_manager(p_client uuid) returns uuid
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_workspace uuid := public.my_workspace_id();
begin
  if coalesce(public.my_workspace_role(), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can change the team''s client list' using errcode = '42501';
  end if;
  if p_client is not null and not exists (select 1 from public.workspace_contacts c where c.id = p_client and c.workspace_id = v_workspace) then
    raise exception 'That client is not on your team''s list' using errcode = 'P0002';
  end if;
  return v_workspace;
end;
$$;
revoke execute on function public.require_client_manager(uuid) from public, anon, authenticated;

-- p_name is sealed with the team key.
create function public.rename_team_client(p_client uuid, p_name text) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid := public.require_client_manager(p_client);
begin
  if p_name is null or p_name not like 't1:%' or length(p_name) > 1000 then
    raise exception 'The name must be sealed with the team key first' using errcode = '22023';
  end if;
  update public.workspace_contacts c set name = p_name where c.id = p_client and c.workspace_id = v_workspace;
end;
$$;
revoke execute on function public.rename_team_client(uuid, text) from public, anon;
grant execute on function public.rename_team_client(uuid, text) to authenticated;

-- Sets the client's company (the name sealed t1), or clears it with a null name. p_domain_index may only be the index of a
-- client company the list already has, so naming a company by hand is a label and never makes a new rule: the sharing rule
-- matches the companies that arrived from real chats.
create function public.set_team_client_company(p_client uuid, p_company_name text, p_domain_index text default null) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid := public.require_client_manager(p_client);
begin
  if p_company_name is null then
    update public.workspace_contacts c set company_name = null, company_domain_index = null where c.id = p_client and c.workspace_id = v_workspace;
    return;
  end if;
  if p_company_name not like 't1:%' or length(p_company_name) > 1000 then
    raise exception 'The company name must be sealed with the team key first' using errcode = '22023';
  end if;
  if p_domain_index is not null and not exists (select 1 from public.workspace_companies k where k.workspace_id = v_workspace and k.domain_index = p_domain_index) then
    raise exception 'That company is not on the list' using errcode = '22023';
  end if;
  update public.workspace_contacts c set company_name = p_company_name, company_domain_index = p_domain_index
  where c.id = p_client and c.workspace_id = v_workspace;
end;
$$;
revoke execute on function public.set_team_client_company(uuid, text, text) from public, anon;
grant execute on function public.set_team_client_company(uuid, text, text) to authenticated;

-- Makes one active member (not Compliance) the agent who looks after a client, in place of whoever did. This is the name on
-- the list only: the chats stay with their own agents, and giving them to someone is Work Chats.
create function public.set_team_client_agent(p_client uuid, p_agent uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid := public.require_client_manager(p_client);
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = v_workspace and m.user_id = p_agent and m.status = 'active' and m.role <> 'compliance'
  ) then
    raise exception 'Choose an active member of your team who is not Compliance' using errcode = '22023';
  end if;
  delete from public.workspace_contact_agents a where a.workspace_contact_id = p_client and a.user_id <> p_agent;
  insert into public.workspace_contact_agents (workspace_contact_id, workspace_id, user_id)
  values (p_client, v_workspace, p_agent)
  on conflict (workspace_contact_id, user_id) do update set left_team = false;
end;
$$;
revoke execute on function public.set_team_client_agent(uuid, uuid) from public, anon;
grant execute on function public.set_team_client_agent(uuid, uuid) to authenticated;

-- Folds p_remove into p_keep: its addresses, its agents, its chat links and, when p_keep has none, its company. The kept client
-- keeps its name. Returns p_keep.
create function public.merge_team_clients(p_keep uuid, p_remove uuid) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid := public.require_client_manager(p_keep);
begin
  if p_remove is null or p_remove = p_keep then
    raise exception 'Choose two different clients' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspace_contacts c where c.id = p_remove and c.workspace_id = v_workspace) then
    raise exception 'That client is not on your team''s list' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text, 0));

  update public.workspace_contact_identities i set workspace_contact_id = p_keep
  where i.workspace_contact_id = p_remove and i.workspace_id = v_workspace;
  insert into public.workspace_contact_agents (workspace_contact_id, workspace_id, user_id, since, left_team)
  select p_keep, v_workspace, a.user_id, a.since, a.left_team from public.workspace_contact_agents a where a.workspace_contact_id = p_remove
  on conflict (workspace_contact_id, user_id) do nothing;
  insert into public.workspace_contact_threads (workspace_contact_id, workspace_id, thread_id, linked_at)
  select p_keep, v_workspace, l.thread_id, l.linked_at from public.workspace_contact_threads l where l.workspace_contact_id = p_remove
  on conflict do nothing;
  update public.workspace_contacts k
  set company_name = coalesce(k.company_name, r.company_name), company_domain_index = coalesce(k.company_domain_index, r.company_domain_index)
  from public.workspace_contacts r
  where k.id = p_keep and r.id = p_remove and (k.company_name is null or k.company_domain_index is null);
  delete from public.workspace_contacts c where c.id = p_remove and c.workspace_id = v_workspace;
  return p_keep;
end;
$$;
revoke execute on function public.merge_team_clients(uuid, uuid) from public, anon;
grant execute on function public.merge_team_clients(uuid, uuid) to authenticated;

-- Takes a client off the team list. Their addresses are remembered as removed, so the sharing rule stops matching them and the
-- worker does not add them back. No chat is unshared and nothing is deleted from one. Returns how many addresses were remembered.
create function public.remove_team_client(p_client uuid) returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid := public.require_client_manager(p_client);
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text, 0));
  insert into public.workspace_client_exclusions (workspace_id, kind, value_index, removed_by)
  select v_workspace, 'identity', i.value_index, (select auth.uid()) from public.workspace_contact_identities i where i.workspace_contact_id = p_client
  on conflict do nothing;
  get diagnostics v_count = row_count;
  delete from public.workspace_contacts c where c.id = p_client and c.workspace_id = v_workspace;
  return v_count;
end;
$$;
revoke execute on function public.remove_team_client(uuid) from public, anon;
grant execute on function public.remove_team_client(uuid) to authenticated;

-- Takes a client company off the list: the rule stops matching its domain, the worker does not add it back, and the clients
-- who had it lose the company label (they stay on the list). No chat is unshared.
create function public.remove_team_company(p_domain_index text) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid := public.require_client_manager(null);
begin
  if coalesce(p_domain_index, '') = '' then
    raise exception 'Choose a company' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text, 0));
  insert into public.workspace_client_exclusions (workspace_id, kind, value_index, removed_by)
  values (v_workspace, 'company', p_domain_index, (select auth.uid()))
  on conflict do nothing;
  delete from public.workspace_companies k where k.workspace_id = v_workspace and k.domain_index = p_domain_index;
  update public.workspace_contacts c set company_name = null, company_domain_index = null
  where c.workspace_id = v_workspace and c.company_domain_index = p_domain_index;
end;
$$;
revoke execute on function public.remove_team_company(text) from public, anon;
grant execute on function public.remove_team_company(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Compliance export
-- ---------------------------------------------------------------------------

-- The content-free log: who exported, which client (sealed t1, so the log still says who after a rename or a merge), when and
-- how many messages. messages stays null until the export finishes, so one that was started and never finished shows as that.
create table public.compliance_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_contact_id uuid references public.workspace_contacts (id) on delete set null,
  client_label text not null check (client_label like 't1:%' and length(client_label) <= 1000),
  chats integer not null default 0,
  messages integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index compliance_exports_workspace_idx on public.compliance_exports (workspace_id, started_at desc);

-- The chats an export covered, so each agent can be told which of theirs were included. Ids only.
create table public.compliance_export_chats (
  export_id uuid not null references public.compliance_exports (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  primary key (export_id, thread_id)
);
create index compliance_export_chats_thread_idx on public.compliance_export_chats (thread_id);

alter table public.compliance_exports enable row level security;
alter table public.compliance_export_chats enable row level security;
revoke all on public.compliance_exports, public.compliance_export_chats from anon, authenticated;

-- Who may export: only a Compliance member, while the workspace has strict sharing on. Owners and admins never read a work chat
-- that is not assigned to them (docs/PLAN.md, Teams, Decided), so an export is not a way round that; they see only the log.
create function public.require_export_role() returns uuid
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_workspace uuid := public.my_workspace_id();
begin
  if coalesce(public.my_workspace_role(), '') <> 'compliance' then
    raise exception 'Only Compliance can export a client''s work history' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = v_workspace and w.strict_sharing) then
    raise exception 'Exports need strict sharing to be on' using errcode = '42501';
  end if;
  return v_workspace;
end;
$$;
revoke execute on function public.require_export_role() from public, anon, authenticated;

-- The open export the caller is reading for: theirs, not finished, started in the last six hours, and they may still export.
create function public.export_gate(p_export uuid) returns public.compliance_exports
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_row public.compliance_exports;
begin
  select e.* into v_row from public.compliance_exports e
  where e.id = p_export and e.user_id = (select auth.uid()) and e.finished_at is null and e.started_at > now() - interval '6 hours';
  if not found then
    raise exception 'This export is not open' using errcode = '42501';
  end if;
  if public.require_export_role() is distinct from v_row.workspace_id then
    raise exception 'You can no longer export for this team' using errcode = '42501';
  end if;
  return v_row;
end;
$$;
revoke execute on function public.export_gate(uuid) from public, anon, authenticated;

-- Starts an export of one client's work history: writes the log row (and the list of chats it covers) before anything can be
-- read, and returns the chats, newest first, with what the browser needs to open them: the chat's label (sealed t1), channel,
-- who looks after it, the inbox's name for a shared inbox chat, when sharing began, and how many messages the team copy holds
-- (total) and how many are still waiting to be shared (pending, which the export does not contain). Only chats still shared in
-- this workspace appear. p_label is the client's name sealed t1, for the log.
create function public.begin_client_export(p_client uuid, p_label text) returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid := public.require_export_role();
  v_export uuid;
  v_chats jsonb;
  v_count integer;
begin
  if not exists (select 1 from public.workspace_contacts c where c.id = p_client and c.workspace_id = v_workspace) then
    raise exception 'That client is not on your team''s list' using errcode = 'P0002';
  end if;
  if p_label is null or p_label not like 't1:%' or length(p_label) > 1000 then
    raise exception 'The client name must be sealed with the team key first' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'thread_id', t.id, 'label', t.share_label, 'channel', t.channel, 'shared_by', t.shared_by,
           'agent_name', public.person_name(t.user_id), 'inbox_name', ac.inbox_name, 'shared_at', t.shared_at, 'share_from', t.share_from,
           'last_message_at', t.last_message_at,
           'total', (select count(*) from public.messages m where m.thread_id = t.id and m.workspace_id = t.workspace_id and (t.share_from is null or m.sent_at >= t.share_from)),
           'pending', (select count(*) from public.messages m where m.thread_id = t.id and m.workspace_id is null and (t.share_from is null or m.sent_at >= t.share_from))
         ) order by t.last_message_at desc nulls last, t.id), '[]'::jsonb),
         count(*)
  into v_chats, v_count
  from public.workspace_contact_threads l
  join public.threads t on t.id = l.thread_id and t.workspace_id = v_workspace
  left join public.accounts ac on ac.id = t.account_id and t.shared_by = 'account'
  where l.workspace_contact_id = p_client and l.workspace_id = v_workspace;
  if v_count = 0 then
    raise exception 'No shared chats are linked to this client yet' using errcode = 'P0002';
  end if;
  if v_count > 500 then
    raise exception 'This client has too many chats to export at once' using errcode = '22023';
  end if;

  insert into public.compliance_exports (workspace_id, user_id, workspace_contact_id, client_label, chats)
  values (v_workspace, (select auth.uid()), p_client, p_label, v_count)
  returning id into v_export;
  insert into public.compliance_export_chats (export_id, thread_id)
  select v_export, (c ->> 'thread_id')::uuid from jsonb_array_elements(v_chats) c;
  return jsonb_build_object('export_id', v_export, 'chats', v_chats);
end;
$$;
revoke execute on function public.begin_client_export(uuid, text) from public, anon;
grant execute on function public.begin_client_export(uuid, text) to authenticated;

-- A page of one exported chat's messages, oldest first, after (p_after_sent, p_after_id). Only while the export is open, only
-- for a chat it covers that is still shared, and only rows the team holds (workspace_id set) from the chat's Share From date
-- on: a personal chat has none, and nothing older than Share From is ever returned. The text is still sealed with the team
-- key. Email text comes as body_html only when there is no plain text. files are the attachment names, no bytes.
create function public.export_chat_messages(p_export uuid, p_thread uuid, p_after_sent timestamptz default null, p_after_id uuid default null, p_limit integer default 200)
  returns table (id uuid, sent_at timestamptz, direction text, sender_address text, to_addresses text[], subject text, body_text text,
                 body_html text, transcript text, quoted_text text, files jsonb)
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_export public.compliance_exports := public.export_gate(p_export);
begin
  if not exists (
    select 1 from public.compliance_export_chats c join public.threads t on t.id = c.thread_id
    where c.export_id = p_export and c.thread_id = p_thread and t.workspace_id = v_export.workspace_id
  ) then
    raise exception 'That chat is not part of this export' using errcode = '42501';
  end if;
  return query
    select m.id, m.sent_at, m.direction, m.sender_address, m.to_addresses, m.subject, m.body_text,
           case when coalesce(m.body_text, '') = '' then m.body_html end, m.transcript, m.provider_meta #>> '{quoted,text}',
           coalesce((select jsonb_agg(a.filename order by a.created_at, a.id) from public.attachments a where a.message_id = m.id and not a.hidden and a.filename is not null), '[]'::jsonb)
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.thread_id = p_thread and m.workspace_id = t.workspace_id and (t.share_from is null or m.sent_at >= t.share_from)
      and (p_after_sent is null or (m.sent_at, m.id) > (p_after_sent, p_after_id))
    order by m.sent_at, m.id
    limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;
revoke execute on function public.export_chat_messages(uuid, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.export_chat_messages(uuid, uuid, timestamptz, uuid, integer) to authenticated;

-- The team's notes on an exported chat (sealed t1), who wrote each and when.
create function public.export_chat_notes(p_export uuid, p_thread uuid)
  returns table (id uuid, user_name text, body text, created_at timestamptz)
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_export public.compliance_exports := public.export_gate(p_export);
begin
  if not exists (
    select 1 from public.compliance_export_chats c join public.threads t on t.id = c.thread_id
    where c.export_id = p_export and c.thread_id = p_thread and t.workspace_id = v_export.workspace_id
  ) then
    raise exception 'That chat is not part of this export' using errcode = '42501';
  end if;
  return query
    select n.id, public.person_name(n.user_id), n.body, n.created_at
    from public.thread_notes n
    where n.thread_id = p_thread and n.workspace_id = v_export.workspace_id
    order by n.created_at, n.id;
end;
$$;
revoke execute on function public.export_chat_notes(uuid, uuid) from public, anon;
grant execute on function public.export_chat_notes(uuid, uuid) to authenticated;

-- Closes the export and records how many messages were read. It cannot be finished twice, and reading stops with it.
create function public.finish_client_export(p_export uuid, p_messages integer) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_export public.compliance_exports := public.export_gate(p_export);
begin
  update public.compliance_exports e set messages = greatest(0, coalesce(p_messages, 0)), finished_at = now() where e.id = v_export.id;
end;
$$;
revoke execute on function public.finish_client_export(uuid, integer) from public, anon;
grant execute on function public.finish_client_export(uuid, integer) to authenticated;

-- The log, newest first: for owners and admins every export of the workspace, for Compliance their own. Who, which client
-- (sealed t1, for the browser to open), how many chats and messages, when. Never a word of any chat.
create function public.compliance_export_log()
  returns table (id uuid, user_id uuid, user_name text, client_label text, chats integer, messages integer, started_at timestamptz, finished_at timestamptz)
  language sql stable security definer set search_path = ''
as $$
  select e.id, e.user_id, public.person_name(e.user_id), e.client_label, e.chats, e.messages, e.started_at, e.finished_at
  from public.compliance_exports e
  where e.workspace_id = public.my_workspace_id()
    and (public.my_workspace_role() in ('owner', 'admin') or (public.my_workspace_role() = 'compliance' and e.user_id = (select auth.uid())))
  order by e.started_at desc
  limit 200
$$;
revoke execute on function public.compliance_export_log() from public, anon;
grant execute on function public.compliance_export_log() to authenticated;

-- What the agent is told, in What You Share: the days their own chats were part of a client export, newest first (the last 50).
-- A started export counts: the log row is written before anything is read.
create function public.my_exported_chats() returns table (thread_id uuid, exported_on date)
  language sql stable security definer set search_path = ''
as $$
  select x.thread_id, x.day
  from (
    select distinct c.thread_id, (e.started_at at time zone 'utc')::date as day
    from public.compliance_export_chats c
    join public.compliance_exports e on e.id = c.export_id
    join public.threads t on t.id = c.thread_id
    where t.user_id = (select auth.uid()) and e.workspace_id = public.my_workspace_id()
  ) x
  order by x.day desc, x.thread_id
  limit 50
$$;
revoke execute on function public.my_exported_chats() from public, anon;
grant execute on function public.my_exported_chats() to authenticated;
