-- Automatic sharing and suggestions: step 4 of Teams (docs/PLAN.md, Teams). The team keeps one client list, and a
-- chat with a client is shared by a rule (or suggested, under strict sharing). Chats the AI thinks are work are
-- suggested to the agent alone.
--
--   * workspace_contacts is the team's client list. A client's name and company are sealed with the team key (t1),
--     and its addresses, numbers and company domain are matched by team blind indexes (the same normalisation as a
--     user's, under the team's own index key), so the database never reads them. The sync worker fills it when a
--     chat is shared (apps/worker/src/share/clients.ts). Every active member of the workspace reads it (names,
--     companies and the agent who looks after each client), and never any message: those stay with the chat.
--   * workspace_companies is the team's client companies, by domain index. Someone new from a client company is
--     matched by it.
--   * workspace_contact_agents says who looks after a client. left_team is set while that person is out of the team.
--   * The rule pass (apps/worker/src/share/rules.ts) matches a chat's people against the two lists and calls
--     apply_team_rule: with strict sharing off the chat is shared at once (shared_by rule, whole history) and the
--     agent is told; with it on, the chat is only suggested, because accepting cannot be undone and is the agent's
--     choice. suggest_work_chats suggests chats triage marked as work. Both set threads.share_suggestion.
--   * threads.share_opt_out is set when a chat is moved back to personal, so a rule never shares it again, and
--     share_suggestion 'dismissed' (Not Work) is respected by the rule too. share_match is the client or company
--     the rule matched, sealed t1, for the line "Shared because Acme is a team client".
--
-- Writing the lists is only for the service role (the worker) and the functions below; nobody writes them directly.

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------

alter table public.threads
  add column share_opt_out boolean not null default false,
  add column share_suggestion text check (share_suggestion in ('suggested', 'dismissed')),
  add column share_match text,
  add constraint threads_suggestion_is_personal check (workspace_id is null or share_suggestion is null);

create index threads_suggested_idx on public.threads (user_id) where share_suggestion = 'suggested';
-- The sweep reads each member's recent chats that nothing has decided yet.
create index threads_unshared_recent_idx on public.threads (user_id, last_message_at desc)
  where workspace_id is null and not share_opt_out;

-- A chat that becomes shared has no suggestion left to answer, and its match is kept only when the rule shared it.
-- One that goes back to personal is never shared by a rule again, and loses its match.
create function public.threads_share_state() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  if new.workspace_id is not null then
    new.share_suggestion := null;
    if new.shared_by is distinct from 'rule' then new.share_match := null; end if;
  elsif old.workspace_id is not null then
    new.share_opt_out := true;
    new.share_suggestion := null;
    new.share_match := null;
  end if;
  return new;
end;
$$;
create trigger threads_share_state before update of workspace_id on public.threads
  for each row execute function public.threads_share_state();

-- ---------------------------------------------------------------------------
-- The team's client list
-- ---------------------------------------------------------------------------

create table public.workspace_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,                    -- sealed t1
  company_name text,                     -- sealed t1
  company_domain_index text,             -- team blind index of the company's domain
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index workspace_contacts_workspace_idx on public.workspace_contacts (workspace_id);
create index workspace_contacts_company_idx on public.workspace_contacts (workspace_id, company_domain_index)
  where company_domain_index is not null;
create trigger set_updated_at before update on public.workspace_contacts for each row execute function public.set_updated_at();

-- One row per address, number or chat ID a client is known by. Two clients never share one: the first to claim it
-- keeps it.
create table public.workspace_contact_identities (
  workspace_contact_id uuid not null,
  workspace_id uuid not null,
  kind text not null,
  value_index text not null,             -- team blind index of the value
  value text not null,                   -- sealed t1
  created_at timestamptz not null default now(),
  primary key (workspace_id, value_index),
  foreign key (workspace_contact_id, workspace_id) references public.workspace_contacts (id, workspace_id) on delete cascade
);
create index workspace_contact_identities_contact_idx on public.workspace_contact_identities (workspace_contact_id);

-- The agent (or agents) who look after a client: whoever shared a chat with them. left_team marks someone who has
-- left, so the owner can see the client needs a new agent.
create table public.workspace_contact_agents (
  workspace_contact_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  since timestamptz not null default now(),
  left_team boolean not null default false,
  primary key (workspace_contact_id, user_id),
  foreign key (workspace_contact_id, workspace_id) references public.workspace_contacts (id, workspace_id) on delete cascade
);
create index workspace_contact_agents_user_idx on public.workspace_contact_agents (user_id);

create table public.workspace_companies (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  domain_index text not null,            -- team blind index of the company's domain
  name text not null,                    -- sealed t1
  created_at timestamptz not null default now(),
  primary key (workspace_id, domain_index)
);

alter table public.workspace_contacts enable row level security;
alter table public.workspace_contact_identities enable row level security;
alter table public.workspace_contact_agents enable row level security;
alter table public.workspace_companies enable row level security;
revoke all on public.workspace_contacts, public.workspace_contact_identities, public.workspace_contact_agents, public.workspace_companies from anon, authenticated;
grant select on public.workspace_contacts, public.workspace_contact_identities, public.workspace_contact_agents, public.workspace_companies to authenticated;

-- Any active member reads their workspace's lists. There is no write policy: the worker uses the service role.
create policy "Members read team clients" on public.workspace_contacts for select to authenticated
  using (workspace_id = public.my_workspace_id());
create policy "Members read team client identities" on public.workspace_contact_identities for select to authenticated
  using (workspace_id = public.my_workspace_id());
create policy "Members read team client agents" on public.workspace_contact_agents for select to authenticated
  using (workspace_id = public.my_workspace_id());
create policy "Members read team client companies" on public.workspace_companies for select to authenticated
  using (workspace_id = public.my_workspace_id());

-- A member who leaves is marked on every client they looked after, and unmarked if they come back.
create function public.workspace_agents_follow_member() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  update public.workspace_contact_agents a set left_team = (new.status <> 'active')
  where a.workspace_id = new.workspace_id and a.user_id = new.user_id and a.left_team is distinct from (new.status <> 'active');
  return null;
end;
$$;
create trigger workspace_agents_follow_member after update of status on public.workspace_members
  for each row when (old.status is distinct from new.status) execute function public.workspace_agents_follow_member();

-- ---------------------------------------------------------------------------
-- The worker's side (service role only)
-- ---------------------------------------------------------------------------

-- Adds a client to the list, or adds to the one it already is. p_identities is [{kind, index, value}] with the team
-- index and the value sealed t1. The client is the one that already holds any of the indexes (the oldest when
-- several do), else a new one. Its addresses are added, its company is filled in when it had none, and the agent is
-- linked (or marked as back). The company joins the client companies. Nothing happens for someone who is not an
-- active member, so an agent who has left adds no one. Returns the client's id, null when nothing was added.
-- The same call twice changes nothing, and the lock makes two at once safe.
create function public.upsert_workspace_contact(
  p_workspace uuid, p_agent uuid, p_name text, p_company_name text, p_company_domain_index text, p_identities jsonb
) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce(p_name, '') = '' or jsonb_typeof(p_identities) is distinct from 'array' or jsonb_array_length(p_identities) = 0 then
    return null;
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace and m.user_id = p_agent and m.status = 'active') then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text, 0));

  select i.workspace_contact_id into v_id
  from public.workspace_contact_identities i
  join public.workspace_contacts c on c.id = i.workspace_contact_id
  where i.workspace_id = p_workspace and i.value_index in (select x ->> 'index' from jsonb_array_elements(p_identities) x)
  order by c.created_at, c.id
  limit 1;

  if v_id is null then
    insert into public.workspace_contacts (workspace_id, name, company_name, company_domain_index)
    values (p_workspace, p_name, p_company_name, p_company_domain_index)
    returning id into v_id;
  elsif p_company_name is not null or p_company_domain_index is not null then
    update public.workspace_contacts c
    set company_name = coalesce(c.company_name, p_company_name), company_domain_index = coalesce(c.company_domain_index, p_company_domain_index)
    where c.id = v_id and (c.company_name is null or c.company_domain_index is null);
  end if;

  insert into public.workspace_contact_identities (workspace_contact_id, workspace_id, kind, value_index, value)
  select v_id, p_workspace, x ->> 'kind', x ->> 'index', x ->> 'value'
  from jsonb_array_elements(p_identities) x
  where coalesce(x ->> 'index', '') <> '' and coalesce(x ->> 'value', '') <> ''
  on conflict (workspace_id, value_index) do nothing;

  insert into public.workspace_contact_agents (workspace_contact_id, workspace_id, user_id)
  values (v_id, p_workspace, p_agent)
  on conflict (workspace_contact_id, user_id) do update set left_team = false;

  if p_company_domain_index is not null and coalesce(p_company_name, '') <> '' then
    insert into public.workspace_companies (workspace_id, domain_index, name)
    values (p_workspace, p_company_domain_index, p_company_name)
    on conflict (workspace_id, domain_index) do nothing;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.upsert_workspace_contact(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_workspace_contact(uuid, uuid, text, text, text, jsonb) to service_role;

-- The rule found that a chat is with a team client (or someone from a client company). p_match is who, sealed t1.
-- With strict sharing off the chat is shared now, from the start (shared_by rule), and the agent is told in the thread
-- header. With it on the chat is only suggested: accepting cannot be undone, so it stays the agent's choice. Groups
-- are never shared by the rule, only suggested by the category, and a chat the agent moved back to personal or said
-- is not work is left alone. Returns shared, suggested, or null when the chat was not eligible.
create function public.apply_team_rule(p_thread uuid, p_match text) returns text
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

  if v_strict then
    update public.threads t set share_suggestion = 'suggested', share_match = p_match where t.id = p_thread;
    return 'suggested';
  end if;
  update public.threads t set share_match = p_match where t.id = p_thread;
  perform public.queue_thread_share(p_thread, v_thread.user_id, v_workspace, null, 'rule');
  return 'shared';
end;
$$;
revoke execute on function public.apply_team_rule(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_team_rule(uuid, text) to service_role;

-- Suggests a member's chats that triage marked as work (never newsletters or notifications, which have their own
-- categories), from p_since on, to the agent alone. A chat that is already shared, was moved back, or was
-- dismissed is left alone. A suggestion stays until the agent answers it. Returns how many were suggested.
create function public.suggest_work_chats(p_user uuid, p_since timestamptz) returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.threads t set share_suggestion = 'suggested'
  where t.user_id = p_user and t.workspace_id is null and not t.share_opt_out and t.share_suggestion is null
    and t.category = 'work' and not t.junk and t.status <> 'trash' and t.last_message_at >= p_since
    and exists (select 1 from public.workspace_members m where m.user_id = p_user and m.status = 'active');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.suggest_work_chats(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.suggest_work_chats(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- The agent's side
-- ---------------------------------------------------------------------------

-- Not Work: the agent turns a suggestion down. Neither the category nor the rule suggests this chat again.
create function public.dismiss_share_suggestion(p_thread uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  update public.threads t set share_suggestion = 'dismissed', share_match = null
  where t.id = p_thread and t.user_id = (select auth.uid()) and t.workspace_id is null and t.share_suggestion = 'suggested';
  if not found then
    raise exception 'That chat is not suggested' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.dismiss_share_suggestion(uuid) from public, anon;
grant execute on function public.dismiss_share_suggestion(uuid) to authenticated;

-- Mark as Work for chats Konva suggested, one or many (the review after joining). Each must be the agent's own chat
-- and still suggested; others in the list are skipped. p_share_from is how far back to share, as in mark_thread_work.
-- Returns how many were shared.
create function public.accept_share_suggestions(p_threads uuid[], p_share_from timestamptz default null) returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_workspace uuid := public.my_workspace_id();
  v_thread uuid;
  v_count integer := 0;
begin
  if v_workspace is null then
    raise exception 'Join a team to share chats' using errcode = '42501';
  end if;
  if p_share_from is not null and p_share_from > now() + interval '5 minutes' then
    raise exception 'Choose a date that is not in the future' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_threads), 0) > 500 then
    raise exception 'Share fewer chats at a time' using errcode = '22023';
  end if;
  foreach v_thread in array coalesce(p_threads, '{}') loop
    if exists (
      select 1 from public.threads t
      where t.id = v_thread and t.user_id = v_me and t.workspace_id is null and t.share_suggestion = 'suggested'
    ) then
      perform public.queue_thread_share(v_thread, v_me, v_workspace, p_share_from, 'suggestion');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.accept_share_suggestions(uuid[], timestamptz) from public, anon;
grant execute on function public.accept_share_suggestions(uuid[], timestamptz) to authenticated;

-- The Contacts page's Team Clients: every client the team looks after, with the company (sealed t1, for the browser
-- to open with the team key) and who looks after them. Empty for anyone not in a team. No messages: a chat is read
-- only by its agent and whoever it is assigned to.
create function public.team_clients()
  returns table (id uuid, name text, company_name text, agents jsonb)
  language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, c.company_name,
         coalesce((
           select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', coalesce(nullif(p.display_name, ''), u.email), 'left', a.left_team) order by a.since)
           from public.workspace_contact_agents a
           join auth.users u on u.id = a.user_id
           left join public.profiles p on p.user_id = a.user_id
           where a.workspace_contact_id = c.id
         ), '[]'::jsonb)
  from public.workspace_contacts c
  where c.workspace_id = public.my_workspace_id()
  order by c.created_at desc
$$;
revoke execute on function public.team_clients() from public, anon;
grant execute on function public.team_clients() to authenticated;
