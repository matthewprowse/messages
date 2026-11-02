-- Fixes from the review of the 8 to 14 November migrations. Every statement is safe to run again, and none of it assumes
-- 20261114100000_bulk_reads has or has not been applied.
--   1. The pending-draft cap also holds when a draft is updated to pending, not only when one is inserted.
--   2. Readable Bulk Email always gets its budget share and weekly limit, not only when Sorting and Junk had 5 to give.
--   3. threads.answered_at: a shared chat's reply is remembered on the chat, because the 30 day outbox retention deletes
--      the sent rows that thread_awaiting and the response stats counted on.
--   4. attachment_fetch_requests: a user can only ask (claimed_at and error empty), as for bulk_reads.
--   5. claim_share_job: two workers cannot both start a job for the same chat.
--   6. Indexes on foreign keys that had none.
--   7. A person cannot write the voice learning counters the AI worker owns.

-- ---------------------------------------------------------------------------
-- 1. Pending-draft cap on update
-- ---------------------------------------------------------------------------

create or replace function public.limit_pending_drafts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap constant integer := 20;
begin
  if new.status is distinct from 'pending' then
    return new;
  end if;
  -- A draft that was already pending is already counted: only becoming pending adds one.
  if tg_op = 'UPDATE' and old.status is not distinct from 'pending' then
    return new;
  end if;
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('drafts_pending:' || new.user_id::text, 0));
  if (select count(*) from public.drafts d where d.user_id = new.user_id and d.status = 'pending' and d.id <> new.id) >= v_cap then
    raise exception 'Too many drafts are waiting. Wait for the current ones to finish'
      using errcode = '23514', hint = 'At most 20 drafts can be pending at once.';
  end if;
  return new;
end;
$$;
revoke execute on function public.limit_pending_drafts() from public, anon, authenticated;

drop trigger if exists drafts_limit_pending on public.drafts;
create trigger drafts_limit_pending before insert or update of status on public.drafts
  for each row execute function public.limit_pending_drafts();

-- ---------------------------------------------------------------------------
-- 2. Bulk read budget share
-- ---------------------------------------------------------------------------

-- 5% for readable bulk mail, taken from the largest share (never more than it has, so no share goes below 0). Only when
-- the owner has no share for it yet, so a split set in Admin is left as it is.
do $$
declare
  v_shares jsonb;
  v_big text;
  v_take numeric;
begin
  select shares into v_shares from public.ai_budget limit 1;
  if v_shares is not null and not (v_shares ? 'bulk_read') then
    select f.key into v_big from jsonb_each_text(v_shares) f order by f.value::numeric desc, f.key limit 1;
    v_take := least(5, greatest(coalesce((v_shares ->> v_big)::numeric, 0), 0));
    if v_big is not null then
      v_shares := jsonb_set(v_shares, array[v_big], to_jsonb((v_shares ->> v_big)::numeric - v_take));
    end if;
    update public.ai_budget set shares = jsonb_set(v_shares, '{bulk_read}', to_jsonb(v_take));
  end if;
  update public.ai_budget set weekly_features = array_append(weekly_features, 'bulk_read') where not ('bulk_read' = any (weekly_features));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Answered shared chats outlive the outbox retention
-- ---------------------------------------------------------------------------

alter table public.threads add column if not exists answered_at timestamptz;

-- The time of the newest reply sent from someone's own account to a shared chat (outbox.for_thread_id), kept on the
-- chat. It only moves forward. Written by the trigger below; users cannot write it (threads has column grants).
create or replace function public.threads_note_answered() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'sent' and new.for_thread_id is not null then
    update public.threads t set answered_at = greatest(coalesce(t.answered_at, '-infinity'::timestamptz), coalesce(new.sent_at, now()))
    where t.id = new.for_thread_id and (t.answered_at is null or t.answered_at < coalesce(new.sent_at, now()));
  end if;
  return new;
end;
$$;
revoke execute on function public.threads_note_answered() from public, anon, authenticated;

drop trigger if exists outbox_note_answered on public.outbox;
create trigger outbox_note_answered after insert or update of status, sent_at on public.outbox
  for each row execute function public.threads_note_answered();

-- Replies already sent and not yet deleted by retention.
update public.threads t set answered_at = s.at
from (
  select o.for_thread_id as thread_id, max(o.sent_at) as at
  from public.outbox o where o.status = 'sent' and o.for_thread_id is not null and o.sent_at is not null
  group by o.for_thread_id
) s
where t.id = s.thread_id and (t.answered_at is null or t.answered_at < s.at);

-- 20261105100000's thread_awaiting, answered also when answered_at says so.
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
    and not (p_thread.answered_at is not null and p_thread.answered_at >= last.at)
    and not exists (
      select 1 from public.outbox o
      where o.for_thread_id = p_thread.id and o.status = 'sent' and o.sent_at >= last.at)
  from last
$$;
revoke execute on function public.thread_awaiting(public.threads) from public, anon, authenticated;

-- 20261105100000's team_response_stats, with the chat's answered_at as one more reply event.
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
    union all
    -- The newest reply, kept after the outbox row is deleted. It may repeat a row above, which changes nothing.
    select t.id, t.answered_at, 'outbound'
    from public.threads t join chats c on c.id = t.id
    where t.answered_at >= now() - interval '31 days'
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

-- ---------------------------------------------------------------------------
-- 4. attachment_fetch_requests: users only ask
-- ---------------------------------------------------------------------------

drop policy if exists "attachment_fetch_requests_insert_own" on public.attachment_fetch_requests;
create policy "attachment_fetch_requests_insert_own" on public.attachment_fetch_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and claimed_at is null and error is null
    and exists (select 1 from public.attachments a where a.id = attachment_id and a.user_id = (select auth.uid()))
  );

revoke all on public.attachment_fetch_requests from anon;
revoke update, truncate on public.attachment_fetch_requests from authenticated;

-- ---------------------------------------------------------------------------
-- 5. claim_share_job: one job per chat at a time, also under concurrency
-- ---------------------------------------------------------------------------

-- Same rules as 20261101120000's. Two workers could each pick a different job of one chat, since neither saw the
-- other's still uncommitted claim. Now the pick takes a lock per chat and checks again once it holds it, so the second
-- worker sees the first's claim and moves on to another job.
create or replace function public.claim_share_job() returns setof public.share_jobs
  language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_thread uuid;
  v_tried uuid[] := '{}';
begin
  loop
    select q.id, q.thread_id into v_id, v_thread from public.share_jobs q
    where q.attempts < 5
      and (q.status = 'queued'
           or (q.status = 'working' and q.started_at < now() - interval '10 minutes')
           or (q.status = 'failed' and q.finished_at < now() - interval '1 minute' * q.attempts))
      and not exists (
        select 1 from public.share_jobs w
        where w.thread_id = q.thread_id and w.id <> q.id and w.status = 'working' and w.started_at >= now() - interval '10 minutes')
      and q.id <> all (v_tried)
    order by q.created_at
    for update skip locked
    limit 1;
    if v_id is null then
      return;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('share_job:' || v_thread::text, 0));
    return query
      update public.share_jobs j
      set status = 'working', attempts = j.attempts + 1, started_at = now(), error = null
      where j.id = v_id
        and j.attempts < 5
        and (j.status = 'queued'
             or (j.status = 'working' and j.started_at < now() - interval '10 minutes')
             or (j.status = 'failed' and j.finished_at < now() - interval '1 minute' * j.attempts))
        and not exists (
          select 1 from public.share_jobs w
          where w.thread_id = j.thread_id and w.id <> j.id and w.status = 'working' and w.started_at >= now() - interval '10 minutes')
      returning j.*;
    if found then
      return;
    end if;
    v_tried := v_tried || v_id;
  end loop;
end;
$$;
revoke execute on function public.claim_share_job() from public, anon, authenticated;
grant execute on function public.claim_share_job() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Indexes on foreign keys (deleting a user, account or chat scans each of these)
-- ---------------------------------------------------------------------------

-- Only where the table and column exist and no whole-table index already starts with the column.
do $$
declare
  pair text[];
begin
  foreach pair slice 1 in array array[
    ['share_jobs', 'user_id'], ['share_jobs', 'workspace_id'], ['thread_notes', 'user_id'], ['thread_notes', 'workspace_id'],
    ['brief_parts', 'user_id'], ['compliance_exports', 'user_id'], ['workspace_activity', 'user_id'], ['instagram_sign_ins', 'user_id'],
    ['drafts', 'account_id'], ['drafts', 'contact_id'], ['ai_usage', 'account_id'], ['ai_usage', 'thread_id'],
    ['task_updates', 'account_id'], ['task_updates', 'task_id'], ['calendar_updates', 'account_id'], ['calendar_deletes', 'account_id'],
    ['unsubscribes', 'account_id'], ['threads', 'last_sender_contact_id'], ['outbox', 'draft_id']
  ] loop
    if to_regclass(format('public.%I', pair[1])) is not null
       and exists (select 1 from pg_attribute a where a.attrelid = format('public.%I', pair[1])::regclass and a.attname = pair[2] and not a.attisdropped)
       and not exists (
         select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
         where i.indrelid = format('public.%I', pair[1])::regclass and a.attname = pair[2] and i.indpred is null and i.indisvalid)
    then
      execute format('create index if not exists %I on public.%I (%I)', pair[1] || '_' || pair[2] || '_idx', pair[1], pair[2]);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Voice learning counters are the AI worker's
-- ---------------------------------------------------------------------------

-- profiles are writable by their owner (Own rows), and voice_learned_at / voice_learned_outbound tell the AI worker when
-- to learn the voice again, so a person could stall or force it. A trigger rather than a column grant: the web app
-- upserts profiles with whatever columns a settings screen sends, and a grant list would silently break every profile
-- column added later. From the app the two values keep what they had (a new row gets the defaults); the AI worker's
-- service role writes them as before.
create or replace function public.profiles_keep_voice_counters() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' then
    if tg_op = 'INSERT' then
      new.voice_learned_at := null;
      new.voice_learned_outbound := 0;
    else
      new.voice_learned_at := old.voice_learned_at;
      new.voice_learned_outbound := old.voice_learned_outbound;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_keep_voice_counters() from public, anon, authenticated;

drop trigger if exists profiles_keep_voice_counters on public.profiles;
create trigger profiles_keep_voice_counters before insert or update on public.profiles
  for each row execute function public.profiles_keep_voice_counters();
