-- Sharing a chat: step 3 of Teams (docs/PLAN.md, Teams). A work chat is encrypted with the team's key ("t1:"
-- values) and read only by the agent whose chat it is and whoever it is assigned to. With strict sharing on, the
-- Compliance role also reads every work chat. Owners and admins see a content-free list of the workspace's work
-- chats and assign them, and read the messages only once a chat is assigned to them.
--
--   * threads gain workspace_id (null = personal), shared_at, shared_by, share_from (null = the whole history) and
--     share_label, the client or group name sealed t1 so the owner's list can say who a chat is with. Messages,
--     message_ai and attachments gain workspace_id. A message older than share_from never gets one, so no policy
--     reaches it and it stays under the agent's own key. Meetings do not hang off a thread and are not touched.
--   * thread_assignments says who else reads a chat. Reading rows of a shared chat goes through can_read_thread,
--     which also checks the chat is still shared, so moving it back to personal cuts access at once, before the
--     worker has re-encrypted a single row.
--   * mark_thread_work and mark_thread_personal change a chat's state and queue a share_jobs row. The sync worker
--     claims it and re-encrypts the chat's rows (apps/worker/src/share), writing through share_write.
--   * New content in a shared chat is written e1 by every writer (the connectors, the AI worker's triage and
--     summaries). Triggers below notice it and queue a small follow-up job, one per chat at a time, and the worker
--     seals it. Writers need no change. A member who was removed shares nothing new: nothing is queued for them.
--   * workspace_activity keeps counts per member and week (chats shared, chats moved back) for the owner.
--
-- Not here, on purpose: team blind indexes and shared contacts (step 4); reassigning and replying as an assignee
-- (step 5, which adds write policies on threads and messages for assignees). Attachment files in storage are
-- stored as the provider sent them, not sealed, so they have no team form yet: an assignee reads them through the
-- storage policy below.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.threads
  add column workspace_id uuid references public.workspaces (id),
  add column shared_at timestamptz,
  add column shared_by text check (shared_by in ('rule', 'suggestion', 'agent', 'account')),
  add column share_from timestamptz,
  add column share_label text,
  add constraint threads_shared_together check (
    (workspace_id is null and shared_at is null and shared_by is null and share_from is null)
    or (workspace_id is not null and shared_at is not null and shared_by is not null)
  );
alter table public.messages add column workspace_id uuid references public.workspaces (id);
alter table public.message_ai add column workspace_id uuid references public.workspaces (id);
alter table public.attachments add column workspace_id uuid references public.workspaces (id);

create index threads_workspace_idx on public.threads (workspace_id) where workspace_id is not null;
create index messages_workspace_idx on public.messages (workspace_id) where workspace_id is not null;
create index message_ai_workspace_idx on public.message_ai (workspace_id) where workspace_id is not null;
create index attachments_workspace_idx on public.attachments (workspace_id) where workspace_id is not null;
-- The storage policy finds a shared file's row by its path.
create index attachments_shared_path_idx on public.attachments (storage_path) where workspace_id is not null;

-- ---------------------------------------------------------------------------
-- Who else reads a chat
-- ---------------------------------------------------------------------------

create table public.thread_assignments (
  thread_id uuid not null references public.threads (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id),
  assignee_id uuid not null references auth.users (id) on delete cascade,
  assigned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (thread_id, assignee_id)
);
create index thread_assignments_assignee_idx on public.thread_assignments (assignee_id);

alter table public.thread_assignments enable row level security;
revoke all on public.thread_assignments from anon, authenticated;
grant select on public.thread_assignments to authenticated;

-- Whether the signed-in person may read this shared chat, other than as the agent whose it is (the "Own rows"
-- policies cover that): they are in the chat's workspace and it is assigned to them, or they are Compliance and
-- the workspace is strict. p_workspace is the row's own workspace_id, and the chat must still be shared in it.
create function public.can_read_thread(p_thread uuid, p_workspace uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select p_workspace is not null and exists (
    select 1 from public.threads t
    where t.id = p_thread and t.workspace_id = p_workspace and p_workspace = public.my_workspace_id()
      and (
        exists (select 1 from public.thread_assignments a where a.thread_id = t.id and a.assignee_id = (select auth.uid()))
        or (public.my_workspace_role() = 'compliance'
            and exists (select 1 from public.workspaces w where w.id = t.workspace_id and w.strict_sharing))
      )
  )
$$;
revoke execute on function public.can_read_thread(uuid, uuid) from public, anon;
grant execute on function public.can_read_thread(uuid, uuid) to authenticated;

-- The same for a row that hangs off a message (message_ai, attachments).
create function public.can_read_message(p_message uuid, p_workspace uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.messages m where m.id = p_message and public.can_read_thread(m.thread_id, p_workspace))
$$;
revoke execute on function public.can_read_message(uuid, uuid) from public, anon;
grant execute on function public.can_read_message(uuid, uuid) to authenticated;

-- Additive to "Own rows". Writes stay with the agent; an assignee's replies come with step 5.
create policy "Shared threads" on public.threads for select to authenticated
  using (workspace_id is not null and public.can_read_thread(id, workspace_id));
create policy "Shared messages" on public.messages for select to authenticated
  using (workspace_id is not null and public.can_read_thread(thread_id, workspace_id));
create policy "Shared message AI" on public.message_ai for select to authenticated
  using (workspace_id is not null and public.can_read_message(message_id, workspace_id));
create policy "Shared attachments" on public.attachments for select to authenticated
  using (workspace_id is not null and public.can_read_message(message_id, workspace_id));
create policy "Read shared attachment files" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.attachments a
      where a.storage_path = name and a.workspace_id is not null and public.can_read_message(a.message_id, a.workspace_id)
    )
  );

-- The agent sees who else a chat is assigned to; an assignee sees their co-assignees; owners and admins see all.
create policy "Assignments of shared chats" on public.thread_assignments for select to authenticated
  using (
    workspace_id = public.my_workspace_id()
    and (
      assignee_id = (select auth.uid())
      or public.my_workspace_role() in ('owner', 'admin')
      or exists (select 1 from public.threads t where t.id = thread_id and t.user_id = (select auth.uid()))
      or public.can_read_thread(thread_id, workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- What still needs sealing
-- ---------------------------------------------------------------------------

-- A stored text that is neither empty nor already sealed with the team key.
create function public.needs_team_seal(p_value text) returns boolean
  language sql immutable set search_path = ''
as $$ select p_value is not null and p_value <> '' and p_value not like 't1:%' $$;

-- An address is only ever moved when it is sealed at all: a readable one stays as it is, because the database still
-- matches on readable addresses until ENCRYPT_ADDRESSES is on.
create function public.needs_team_seal_address(p_value text) returns boolean
  language sql immutable set search_path = ''
as $$ select coalesce(p_value like 'e1:%', false) $$;

-- A message's content fields, by what the worker re-encrypts (apps/worker/src/share/fields.ts has the same list):
-- its text, its sender and recipients, and the text of a WhatsApp quote. The JIDs in provider_meta stay under the
-- agent's key, because the worker needs them to send.
create function public.message_needs_team_seal(m public.messages) returns boolean
  language sql immutable set search_path = ''
as $$
  select public.needs_team_seal(m.subject) or public.needs_team_seal(m.preview) or public.needs_team_seal(m.body_text)
    or public.needs_team_seal(m.body_html) or public.needs_team_seal(m.list_unsubscribe) or public.needs_team_seal(m.body_marks)
    or public.needs_team_seal(m.transcript) or public.needs_team_seal_address(m.sender_address)
    or exists (select 1 from unnest(m.to_addresses) a where public.needs_team_seal_address(a))
    or public.needs_team_seal(m.provider_meta #>> '{quoted,text}')
$$;

-- The reverse, for moving a chat back: any of those fields sealed with the team key.
create function public.message_has_team_text(m public.messages) returns boolean
  language sql immutable set search_path = ''
as $$
  select m.subject like 't1:%' or m.preview like 't1:%' or m.body_text like 't1:%' or m.body_html like 't1:%'
    or m.list_unsubscribe like 't1:%' or m.body_marks like 't1:%' or m.transcript like 't1:%' or m.sender_address like 't1:%'
    or exists (select 1 from unnest(m.to_addresses) a where a like 't1:%')
    or (m.provider_meta #>> '{quoted,text}') like 't1:%'
$$;

-- A shared chat's own fields. Its subject names the chat, so it is always sealed. Its preview and summary come from
-- the latest message, so they are sealed only once that message is shared (on or after share_from): a chat shared
-- from today keeps the older preview under the agent's key until a shared message replaces it.
create function public.thread_needs_team_seal(t public.threads) returns boolean
  language sql immutable set search_path = ''
as $$
  select t.workspace_id is not null and (
    public.needs_team_seal(t.subject)
    or (coalesce(t.share_from is null or t.last_message_at >= t.share_from, false)
        and (public.needs_team_seal(t.last_message_preview) or public.needs_team_seal(t.summary)))
  )
$$;

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

-- One row per request to move a chat between the agent's key and the team's. direction to_work seals the chat's
-- rows from share_from with the team key and stamps workspace_id; to_personal seals them with the agent's key and
-- clears it. A follow-up is a to_work job queued by a trigger because new content arrived in a shared chat.
-- At most one job per chat waits at a time (a newer request replaces it); the worker works one per chat at a time.
create table public.share_jobs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id),
  direction text not null check (direction in ('to_work', 'to_personal')),
  share_from timestamptz,
  follow_up boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'working', 'done', 'failed')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index share_jobs_one_queued on public.share_jobs (thread_id) where status = 'queued';
create index share_jobs_thread_idx on public.share_jobs (thread_id, created_at desc);
create index share_jobs_open_idx on public.share_jobs (created_at) where status in ('queued', 'working', 'failed');

alter table public.share_jobs enable row level security;
revoke all on public.share_jobs from anon, authenticated;
grant select on public.share_jobs to authenticated;
create policy "Own share jobs" on public.share_jobs for select to authenticated using (user_id = (select auth.uid()));
-- The worker takes a new job at once, and the app shows Sharing while its own jobs run.
alter publication supabase_realtime add table public.share_jobs;

-- Queues a follow-up for a shared chat, unless one is already waiting (a running job does not count, so content
-- that lands after its last look gets another). Nothing is queued for a chat whose agent has left the team: what
-- they write from then on stays under their own key.
create function public.queue_share_followup(p_thread uuid) returns void
  language sql security definer set search_path = ''
as $$
  insert into public.share_jobs (thread_id, user_id, workspace_id, direction, share_from, follow_up)
  select t.id, t.user_id, t.workspace_id, 'to_work', t.share_from, true
  from public.threads t
  where t.id = p_thread and t.workspace_id is not null
    and exists (select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = t.user_id and m.status = 'active')
  on conflict (thread_id) where status = 'queued' do nothing
$$;
revoke execute on function public.queue_share_followup(uuid) from public, anon, authenticated;

-- The share job's own writes (share_write) set share.writing, so sealing a row never queues another job.
create function public.share_followup_on_message() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_thread public.threads;
begin
  if current_setting('share.writing', true) = 'on' then return null; end if;
  select t.* into v_thread from public.threads t where t.id = new.thread_id and t.workspace_id is not null;
  if not found or (v_thread.share_from is not null and new.sent_at < v_thread.share_from) then return null; end if;
  if tg_op = 'INSERT' or public.message_needs_team_seal(new) then
    perform public.queue_share_followup(new.thread_id);
  end if;
  return null;
end;
$$;
create trigger messages_share_insert after insert on public.messages for each row execute function public.share_followup_on_message();
create trigger messages_share_update
  after update of subject, preview, body_text, body_html, list_unsubscribe, body_marks, transcript, sender_address, to_addresses, provider_meta
  on public.messages for each row when (new.workspace_id is not null) execute function public.share_followup_on_message();

create function public.share_followup_on_message_ai() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_message record;
  v_thread public.threads;
begin
  if current_setting('share.writing', true) = 'on' then return null; end if;
  if not (public.needs_team_seal(new.summary) or public.needs_team_seal(new.reply_choices)) then return null; end if;
  select m.thread_id, m.sent_at into v_message from public.messages m where m.id = new.message_id;
  if not found then return null; end if;
  select t.* into v_thread from public.threads t where t.id = v_message.thread_id and t.workspace_id is not null;
  if found and (v_thread.share_from is null or v_message.sent_at >= v_thread.share_from) then
    perform public.queue_share_followup(v_thread.id);
  end if;
  return null;
end;
$$;
create trigger message_ai_share after insert or update of summary, reply_choices on public.message_ai
  for each row execute function public.share_followup_on_message_ai();

-- A new file of a shared message needs its workspace_id, so it is queued the same way.
create function public.share_followup_on_attachment() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_message record;
  v_thread public.threads;
begin
  if current_setting('share.writing', true) = 'on' then return null; end if;
  select m.thread_id, m.sent_at into v_message from public.messages m where m.id = new.message_id;
  if not found then return null; end if;
  select t.* into v_thread from public.threads t where t.id = v_message.thread_id and t.workspace_id is not null;
  if found and (v_thread.share_from is null or v_message.sent_at >= v_thread.share_from) then
    perform public.queue_share_followup(v_thread.id);
  end if;
  return null;
end;
$$;
create trigger attachments_share after insert on public.attachments for each row execute function public.share_followup_on_attachment();

-- refresh_thread and triage rewrite a shared chat's preview and summary from the latest message, in whichever key
-- the message still has.
create function public.share_followup_on_thread() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('share.writing', true) = 'on' then return null; end if;
  if public.thread_needs_team_seal(new) then perform public.queue_share_followup(new.id); end if;
  return null;
end;
$$;
create trigger threads_share_update after update of subject, last_message_preview, summary, last_message_at on public.threads
  for each row when (new.workspace_id is not null) execute function public.share_followup_on_thread();

-- ---------------------------------------------------------------------------
-- Activity: content-free counts per member and week, for the owner
-- ---------------------------------------------------------------------------

create table public.workspace_activity (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  week date not null,                                   -- the Monday of the week, UTC
  chats_shared integer not null default 0,
  chats_moved_back integer not null default 0,
  primary key (workspace_id, user_id, week)
);

alter table public.workspace_activity enable row level security;
revoke all on public.workspace_activity from anon, authenticated;
grant select on public.workspace_activity to authenticated;
-- Owners and admins read the whole workspace's counts, everyone else only their own.
create policy "Read activity counts" on public.workspace_activity for select to authenticated
  using (workspace_id = public.my_workspace_id() and (user_id = (select auth.uid()) or public.my_workspace_role() in ('owner', 'admin')));

create function public.bump_workspace_activity(p_workspace uuid, p_user uuid, p_shared integer, p_moved_back integer) returns void
  language sql security definer set search_path = ''
as $$
  insert into public.workspace_activity (workspace_id, user_id, week, chats_shared, chats_moved_back)
  values (p_workspace, p_user, date_trunc('week', now() at time zone 'utc')::date, p_shared, p_moved_back)
  on conflict (workspace_id, user_id, week) do update
    set chats_shared = public.workspace_activity.chats_shared + excluded.chats_shared,
        chats_moved_back = public.workspace_activity.chats_moved_back + excluded.chats_moved_back
$$;
revoke execute on function public.bump_workspace_activity(uuid, uuid, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Marking a chat as work, and moving it back
-- ---------------------------------------------------------------------------

-- Makes a chat a work chat and queues the job that seals it. The checks are the caller's: mark_thread_work makes
-- them for an agent, and the automatic sharing of step 4 (shared_by rule, suggestion or account) calls this
-- directly with the service role. Anything older than p_share_from stays under the agent's key.
create function public.queue_thread_share(p_thread uuid, p_user uuid, p_workspace uuid, p_share_from timestamptz, p_by text) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
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
revoke execute on function public.queue_thread_share(uuid, uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.queue_thread_share(uuid, uuid, uuid, timestamptz, text) to service_role;

-- An agent marks one of their own chats as work. p_share_from is how far back to share: null for the whole
-- history, or a time (today, or a chosen date). The chat is shared from this moment; the worker seals its rows.
create function public.mark_thread_work(p_thread uuid, p_share_from timestamptz default null) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_workspace uuid := public.my_workspace_id();
begin
  if v_workspace is null then
    raise exception 'Join a team to share chats' using errcode = '42501';
  end if;
  if p_share_from is not null and p_share_from > now() + interval '5 minutes' then
    raise exception 'Choose a date that is not in the future' using errcode = '22023';
  end if;
  if not exists (select 1 from public.threads t where t.id = p_thread and t.user_id = v_me) then
    raise exception 'You can only share your own chats' using errcode = '42501';
  end if;
  perform public.queue_thread_share(p_thread, v_me, v_workspace, p_share_from, 'agent');
end;
$$;
revoke execute on function public.mark_thread_work(uuid, timestamptz) from public, anon;
grant execute on function public.mark_thread_work(uuid, timestamptz) to authenticated;

-- Moves a work chat back to personal. The agent may do it any time unless the workspace is strict, and then only an
-- owner or admin can release it. A chat of someone who has left the team stays shared. The chat stops being
-- shared and its assignments end now; the worker then seals its rows with the agent's key again. The owner's
-- count goes up, and only the count.
create function public.mark_thread_personal(p_thread uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_thread public.threads;
  v_role text;
  v_strict boolean;
begin
  select t.* into v_thread from public.threads t where t.id = p_thread for update;
  if not found or v_thread.workspace_id is null then
    raise exception 'That chat is not shared' using errcode = 'P0002';
  end if;
  select m.role into v_role from public.workspace_members m
  where m.workspace_id = v_thread.workspace_id and m.user_id = v_me and m.status = 'active';
  if v_role is null then
    raise exception 'You are not in this chat''s team' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = v_thread.workspace_id and m.user_id = v_thread.user_id and m.status = 'active') then
    raise exception 'The person whose chat this is has left the team, so it stays shared' using errcode = '42501';
  end if;
  select w.strict_sharing into v_strict from public.workspaces w where w.id = v_thread.workspace_id;
  if v_strict then
    if v_role not in ('owner', 'admin') then
      raise exception 'Strict sharing is on, so only an owner or admin can release a work chat' using errcode = '42501';
    end if;
  elsif v_thread.user_id <> v_me then
    raise exception 'Only the person whose chat it is can move it back to personal' using errcode = '42501';
  end if;

  update public.threads t
  set workspace_id = null, shared_at = null, shared_by = null, share_from = null
  where t.id = p_thread;
  delete from public.thread_assignments a where a.thread_id = p_thread;
  delete from public.share_jobs j where j.thread_id = p_thread and j.status = 'queued';
  insert into public.share_jobs (thread_id, user_id, workspace_id, direction)
  values (p_thread, v_thread.user_id, v_thread.workspace_id, 'to_personal');
  perform public.bump_workspace_activity(v_thread.workspace_id, v_thread.user_id, 0, 1);
end;
$$;
revoke execute on function public.mark_thread_personal(uuid) from public, anon;
grant execute on function public.mark_thread_personal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assigning
-- ---------------------------------------------------------------------------

-- The person whose chat it is, or an owner or admin of its workspace, gives it to another active member, who can
-- then read it. Owners and admins may assign any work chat, themselves included. Step 5 builds the screens.
create function public.assign_thread(p_thread uuid, p_assignee uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_thread public.threads;
  v_role text;
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
  if not exists (select 1 from public.workspace_members m where m.workspace_id = v_thread.workspace_id and m.user_id = p_assignee and m.status = 'active') then
    raise exception 'That person is not in your team' using errcode = 'P0002';
  end if;
  insert into public.thread_assignments (thread_id, workspace_id, assignee_id, assigned_by)
  values (p_thread, v_thread.workspace_id, p_assignee, v_me)
  on conflict (thread_id, assignee_id) do nothing;
end;
$$;
revoke execute on function public.assign_thread(uuid, uuid) from public, anon;
grant execute on function public.assign_thread(uuid, uuid) to authenticated;

-- Takes a chat back from someone. The agent, an owner or admin can; an assignee can hand one back themselves.
create function public.unassign_thread(p_thread uuid, p_assignee uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_thread public.threads;
  v_role text;
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
  if not (v_thread.user_id = v_me or v_role in ('owner', 'admin') or p_assignee = v_me) then
    raise exception 'Only the person whose chat it is, an owner or an admin can do that' using errcode = '42501';
  end if;
  delete from public.thread_assignments a where a.thread_id = p_thread and a.assignee_id = p_assignee;
end;
$$;
revoke execute on function public.unassign_thread(uuid, uuid) from public, anon;
grant execute on function public.unassign_thread(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The two lists
-- ---------------------------------------------------------------------------

-- Owners and admins: the workspace's work chats with no content. Who it is with (the label, sealed t1 for the
-- browser to open with the team key), who looks after it, when it was shared, when it last moved, whether the client
-- is waiting for a reply and who it is assigned to. Empty for anyone else. This is how an owner finds a chat to assign.
create function public.work_chats()
  returns table (thread_id uuid, agent_id uuid, agent_name text, share_label text, channel text, shared_at timestamptz,
                 last_message_at timestamptz, awaiting_reply boolean, assignee_ids uuid[])
  language sql stable security definer set search_path = ''
as $$
  select t.id, t.user_id, coalesce(nullif(p.display_name, ''), u.email::text), t.share_label, t.channel, t.shared_at,
         t.last_message_at, (t.last_message_at is not null and not t.last_from_me),
         coalesce((select array_agg(a.assignee_id order by a.created_at) from public.thread_assignments a where a.thread_id = t.id), '{}')
  from public.threads t
  join auth.users u on u.id = t.user_id
  left join public.profiles p on p.user_id = t.user_id
  where coalesce(public.my_workspace_role(), '') in ('owner', 'admin') and t.workspace_id = public.my_workspace_id()
  order by t.last_message_at desc nulls last
$$;
revoke execute on function public.work_chats() from public, anon;
grant execute on function public.work_chats() to authenticated;

-- The agent's own: what they share, who each chat is assigned to, and whether sharing is still going on. state is
-- sharing while the job that seals it runs (or waits to be tried again), failed once it has given up, else shared.
create function public.my_shared_chats()
  returns table (thread_id uuid, share_label text, channel text, shared_at timestamptz, shared_by text, share_from timestamptz,
                 last_message_at timestamptz, state text, assignees jsonb)
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
         ), '[]'::jsonb)
  from public.threads t
  where t.user_id = (select auth.uid()) and t.workspace_id is not null
  order by t.shared_at desc
$$;
revoke execute on function public.my_shared_chats() from public, anon;
grant execute on function public.my_shared_chats() to authenticated;

-- ---------------------------------------------------------------------------
-- The sync worker's side (service role only)
-- ---------------------------------------------------------------------------

-- Takes the oldest job that can run: queued, or one a crashed worker left working for over 10 minutes, or one that
-- failed and has waited a minute for each attempt (five attempts at most). One job per chat at a time.
create function public.claim_share_job() returns setof public.share_jobs
  language sql security definer set search_path = ''
as $$
  update public.share_jobs j
  set status = 'working', attempts = j.attempts + 1, started_at = now(), error = null
  where j.id = (
    select q.id from public.share_jobs q
    where q.attempts < 5
      and (q.status = 'queued'
           or (q.status = 'working' and q.started_at < now() - interval '10 minutes')
           or (q.status = 'failed' and q.finished_at < now() - interval '1 minute' * q.attempts))
      and not exists (
        select 1 from public.share_jobs w
        where w.thread_id = q.thread_id and w.id <> q.id and w.status = 'working' and w.started_at >= now() - interval '10 minutes')
    order by q.created_at
    for update skip locked
    limit 1)
  returning j.*
$$;
revoke execute on function public.claim_share_job() from public, anon, authenticated;
grant execute on function public.claim_share_job() to service_role;

-- The rows of a chat that a job still has to change, a page at a time in id order. For to_work: rows from the chat's
-- share_from on that are not yet in its workspace or still hold text in another key. For to_personal: rows still in
-- a workspace or holding team text. Same predicates as the triggers above, so the two always agree.
create function public.share_pending_messages(p_thread uuid, p_direction text, p_after uuid, p_limit integer)
  returns setof public.messages
  language sql stable set search_path = ''
as $$
  select m.* from public.messages m join public.threads t on t.id = m.thread_id
  where m.thread_id = p_thread and (p_after is null or m.id > p_after)
    and case p_direction
      when 'to_work' then t.workspace_id is not null and (t.share_from is null or m.sent_at >= t.share_from)
                          and (m.workspace_id is distinct from t.workspace_id or public.message_needs_team_seal(m))
      else t.workspace_id is null and (m.workspace_id is not null or public.message_has_team_text(m))
    end
  order by m.id limit p_limit
$$;

create function public.share_pending_message_ai(p_thread uuid, p_direction text, p_after uuid, p_limit integer)
  returns setof public.message_ai
  language sql stable set search_path = ''
as $$
  select ai.* from public.message_ai ai
  join public.messages m on m.id = ai.message_id
  join public.threads t on t.id = m.thread_id
  where m.thread_id = p_thread and (p_after is null or ai.message_id > p_after)
    and case p_direction
      when 'to_work' then t.workspace_id is not null and (t.share_from is null or m.sent_at >= t.share_from)
                          and (ai.workspace_id is distinct from t.workspace_id or public.needs_team_seal(ai.summary) or public.needs_team_seal(ai.reply_choices))
      else t.workspace_id is null and (ai.workspace_id is not null or ai.summary like 't1:%' or ai.reply_choices like 't1:%')
    end
  order by ai.message_id limit p_limit
$$;

create function public.share_pending_attachments(p_thread uuid, p_direction text, p_after uuid, p_limit integer)
  returns setof public.attachments
  language sql stable set search_path = ''
as $$
  select a.* from public.attachments a
  join public.messages m on m.id = a.message_id
  join public.threads t on t.id = m.thread_id
  where m.thread_id = p_thread and (p_after is null or a.id > p_after)
    and case p_direction
      when 'to_work' then t.workspace_id is not null and (t.share_from is null or m.sent_at >= t.share_from) and a.workspace_id is distinct from t.workspace_id
      else t.workspace_id is null and a.workspace_id is not null
    end
  order by a.id limit p_limit
$$;

revoke execute on function public.share_pending_messages(uuid, text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.share_pending_message_ai(uuid, text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.share_pending_attachments(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.share_pending_messages(uuid, text, uuid, integer) to service_role;
grant execute on function public.share_pending_message_ai(uuid, text, uuid, integer) to service_role;
grant execute on function public.share_pending_attachments(uuid, text, uuid, integer) to service_role;

-- Writes what the worker re-encrypted. p_rows is [{id, expect {column: value as read}, set {column: new value}}]
-- (the key of a message_ai row is its message_id, sent as id). A row is written only while every column it changes
-- still holds what the worker read, so a transcript or a reaction that landed meanwhile is never overwritten; that
-- row is picked up again by the follow-up job its change queued. Rows outside the chat are never touched, and
-- nothing is written once the chat has changed state (shared or moved back) since the job started: p_workspace is
-- the workspace this write is for, null when moving back. workspace_id may only be set to p_workspace or cleared.
-- The values of an address do not change, only their key, so their blind indexes are left as they are.
-- Returns how many rows were written.
create function public.share_write(p_thread uuid, p_workspace uuid, p_table text, p_rows jsonb) returns integer
  language plpgsql set search_path = ''
as $$
declare
  v_columns text[] := case p_table
    when 'threads' then array['subject', 'last_message_preview', 'summary', 'share_label']
    when 'messages' then array['subject', 'preview', 'body_text', 'body_html', 'list_unsubscribe', 'body_marks', 'transcript', 'sender_address', 'to_addresses', 'provider_meta', 'workspace_id']
    when 'message_ai' then array['summary', 'reply_choices', 'workspace_id']
    when 'attachments' then array['workspace_id']
  end;
  v_key text := case p_table when 'message_ai' then 'message_id' else 'id' end;
  v_scope text := case p_table
    when 'threads' then 't.id = $2'
    when 'messages' then 't.thread_id = $2'
    else 'exists (select 1 from public.messages m where m.id = t.message_id and m.thread_id = $2)'
  end;
  v_row jsonb;
  v_set text;
  v_match text;
  v_count integer := 0;
  v_done integer;
begin
  if v_columns is null then
    raise exception 'no shared content in %', p_table;
  end if;
  if not exists (select 1 from public.threads th where th.id = p_thread and th.workspace_id is not distinct from p_workspace) then
    return 0;
  end if;
  perform set_config('share.writing', 'on', true);
  perform set_config('messages.keep_address_index', 'on', true);
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if (v_row->'set') ? 'workspace_id' and (v_row->'set'->>'workspace_id') is not null
       and (v_row->'set'->>'workspace_id')::uuid is distinct from p_workspace then
      raise exception 'a row can only be placed in the workspace the job is for';
    end if;
    select string_agg(format('%I = (jsonb_populate_record(null::public.%I, $1->''set'')).%I', k, p_table, k), ', '),
           string_agg(format('coalesce(to_jsonb(t.%I), ''null''::jsonb) = coalesce($1->''expect''->%L, ''null''::jsonb)', k, k), ' and ')
    into v_set, v_match
    from jsonb_object_keys(v_row->'set') as k
    where k = any (v_columns);
    if v_set is null then
      continue;
    end if;
    execute format('update public.%I t set %s where t.%I = ($1->>''id'')::uuid and %s and %s', p_table, v_set, v_key, v_scope, v_match)
      using v_row, p_thread;
    get diagnostics v_done = row_count;
    v_count := v_count + v_done;
  end loop;
  perform set_config('share.writing', 'off', true);
  perform set_config('messages.keep_address_index', 'off', true);
  return v_count;
end;
$$;
revoke execute on function public.share_write(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.share_write(uuid, uuid, text, jsonb) to service_role;
