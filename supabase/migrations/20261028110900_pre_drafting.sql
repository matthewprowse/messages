-- Pre-drafting: a draft written before it is asked for, so it is in the reply box when you open the
-- conversation (docs/PLAN.md, Pre-Drafting). The app asks with request_auto_draft while it is open:
-- about 30 seconds after a conversation's last new message, and when you open one with no draft.
--
-- 1. drafts.auto marks a pre-draft and for_message_id is the message it answers, one draft per message,
--    so two open devices make one. A pre-draft that goes stale becomes 'expired', never 'discarded':
--    learning reads discarded drafts as ones you threw away, and you never saw this one.
-- 2. request_auto_draft checks which conversations qualify and the cap of 30 a day, then adds it.
-- 3. A newer message in the conversation, theirs or yours from anywhere, expires its pre-draft.
-- 4. draft_context also returns the latest incoming message's guided drafting choices (sealed), so the
--    worker can drop a pre-draft for a message that needs your decision, without asking the model.
--
-- Additive: the app and worker before this never call request_auto_draft or read the new columns.

-- 1. Columns and status.
alter table public.drafts add column auto boolean not null default false;
alter table public.drafts add column for_message_id uuid references public.messages (id) on delete set null;
alter table public.drafts drop constraint drafts_status_check;
alter table public.drafts add constraint drafts_status_check
  check (status in ('pending', 'active', 'sent', 'discarded', 'failed', 'expired'));
create unique index drafts_auto_message_idx on public.drafts (for_message_id) where auto;
create index drafts_auto_user_idx on public.drafts (user_id, created_at) where auto;

-- 2. Asking for a pre-draft. Returns the new draft's id, or null when the conversation does not
-- qualify (the app asks again on its next change, and nothing is added).
create or replace function public.request_auto_draft(p_thread uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_msg record;
  v_id uuid;
begin
  -- Settings, Auto-Draft Replies (profiles.auto_draft_top) turned off: no pre-drafts.
  if v_user is null or not exists (select 1 from public.profiles p where p.user_id = v_user and p.auto_draft_top) then
    return null;
  end if;
  -- One to one, yours, not junk or deleted, and triaged.
  if not exists (
    select 1 from public.threads t
    where t.id = p_thread and t.user_id = v_user and not t.is_group and not t.junk and t.triage_enabled and t.status <> 'trash'
  ) then
    return null;
  end if;
  -- The latest message is theirs and under 7 days old.
  select m.id, m.direction, m.sent_at into v_msg
  from public.messages m
  where m.thread_id = p_thread and m.user_id = v_user
  order by m.sent_at desc
  limit 1;
  if v_msg.id is null or v_msg.direction <> 'inbound' or v_msg.sent_at < now() - interval '7 days' then
    return null;
  end if;
  -- Triage has read it: someone writing to you, not a newsletter, notification or junk.
  if not exists (
    select 1 from public.message_ai a
    where a.message_id = v_msg.id and not a.junk and (a.needs_reply or a.category in ('personal', 'work', 'needs_reply'))
  ) then
    return null;
  end if;
  -- Nothing asked for, discarded or written since it arrived, and nothing still being written.
  if exists (
    select 1 from public.drafts d
    where d.thread_id = p_thread and (d.status = 'pending' or d.created_at > v_msg.sent_at or d.for_message_id = v_msg.id)
  ) then
    return null;
  end if;
  -- At most 30 written by the model in the last 24 hours. One dropped before the model ran is free.
  if (
    select count(*) from public.drafts d
    where d.user_id = v_user and d.auto and d.model is not null and d.created_at > now() - interval '24 hours'
  ) >= 30 then
    return null;
  end if;
  insert into public.drafts (user_id, thread_id, tone, status, auto, for_message_id)
  values (v_user, p_thread, 'default', 'pending', true, v_msg.id)
  on conflict (for_message_id) where auto do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.request_auto_draft(uuid) from public, anon;
grant execute on function public.request_auto_draft(uuid) to authenticated;

-- 3. A newer message expires the conversation's pre-draft, whether it is theirs (a new draft answers it)
-- or yours (answered, from this app or your phone). A message older than the one answered, as a sync
-- can store, changes nothing. A pre-draft you sent from the app still becomes 'sent' when learned from.
create or replace function public.expire_auto_drafts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.drafts d
  set status = 'expired', updated_at = now()
  from public.messages answered
  where d.auto and d.status in ('pending', 'active') and answered.id = d.for_message_id
    and exists (select 1 from inserted i where i.thread_id = d.thread_id and i.sent_at > answered.sent_at);
  return null;
end;
$$;

revoke execute on function public.expire_auto_drafts() from public, anon, authenticated;

create trigger messages_expire_auto_drafts
  after insert on public.messages
  referencing new table as inserted
  for each statement execute function public.expire_auto_drafts();

-- 4. draft_context, as in 20261028110700_draft_context, with 'choices'.
create or replace function public.draft_context(p_user uuid, p_thread uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_thread jsonb;
  v_messages jsonb;
  v_contact uuid;
  v_latest uuid;
  v_embedding extensions.vector(768);
begin
  select jsonb_build_object('id', t.id, 'user_id', t.user_id, 'account_id', t.account_id, 'subject', t.subject)
  into v_thread
  from public.threads t
  where t.id = p_thread and t.user_id = p_user;
  if v_thread is null then
    return jsonb_build_object('thread', null);
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.sent_at desc), '[]'::jsonb)
  into v_messages
  from (
    select id, direction, sender_contact_id, body_text, body_html, subject, sent_at, transcript
    from public.messages
    where thread_id = p_thread and user_id = p_user
    order by sent_at desc
    limit 12
  ) m;

  select (e ->> 'sender_contact_id')::uuid into v_contact
  from jsonb_array_elements(v_messages) with ordinality as x(e, n)
  where e ->> 'direction' = 'inbound' and e ->> 'sender_contact_id' is not null
  order by n
  limit 1;

  select (e ->> 'id')::uuid into v_latest
  from jsonb_array_elements(v_messages) with ordinality as x(e, n)
  where e ->> 'direction' = 'inbound'
  order by n
  limit 1;

  if v_latest is not null then
    select embedding into v_embedding
    from public.message_embeddings
    where message_id = v_latest and user_id = p_user;
  end if;

  return jsonb_build_object(
    'thread', v_thread,
    'messages', v_messages,
    'profile', (
      select jsonb_build_object('display_name', p.display_name, 'about', p.about)
      from public.profiles p where p.user_id = p_user
    ),
    -- A stable order keeps the start of the prompt the same, so Gemini bills it at the cached rate.
    'rules', (
      select coalesce(jsonb_agg(jsonb_build_object('rule', r.rule, 'scope', r.scope, 'contact_id', r.contact_id)
                                order by r.support_count desc, r.id), '[]'::jsonb)
      from (
        select rule, scope, contact_id, support_count, id from public.style_rules
        where user_id = p_user and enabled
        order by support_count desc, id
        limit 40
      ) r
    ),
    'examples', (
      select coalesce(jsonb_agg(jsonb_build_object('situation', w.situation, 'body', w.body) order by w.created_at, w.id), '[]'::jsonb)
      from (
        select situation, body, created_at, id from public.writing_examples
        where user_id = p_user
        order by created_at, id
        limit 5
      ) w
    ),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object('body_text', m.body_text, 'body_html', m.body_html) order by m.sent_at desc, m.id), '[]'::jsonb)
      from (
        select body_text, body_html, sent_at, id from public.messages
        where user_id = p_user and direction = 'outbound'
        order by sent_at desc, id
        limit 8
      ) m
    ),
    'contact', (
      select jsonb_build_object(
        'id', c.id, 'display_name', c.display_name, 'relationship', c.relationship, 'style_note', c.style_note,
        'ai_summary', c.ai_summary,
        'organizations', case when o.id is null then null else jsonb_build_object('name', o.name, 'summary', o.summary) end
      )
      from public.contacts c
      left join public.organizations o on o.id = c.organization_id and o.user_id = p_user
      where c.id = v_contact and c.user_id = p_user
    ),
    'to_them', (
      select coalesce(jsonb_agg(jsonb_build_object('body_text', m.body_text, 'body_html', m.body_html) order by m.sent_at desc), '[]'::jsonb)
      from (
        select body_text, body_html, sent_at from public.messages
        where user_id = p_user and direction = 'outbound'
          and thread_id in (
            select tp.thread_id from public.thread_participants tp
            where tp.contact_id = v_contact and tp.user_id = p_user and tp.thread_id <> p_thread
            limit 30
          )
        order by sent_at desc
        limit 3
      ) m
    ),
    -- Guided drafting's choices for it, still sealed: the worker drops a pre-draft when there are any.
    'choices', (select a.reply_choices from public.message_ai a where a.message_id = v_latest and a.user_id = p_user),
    'similar', case when v_embedding is null then null else (
      select coalesce(jsonb_agg(to_jsonb(s) - 'n' order by s.n), '[]'::jsonb)
      from public.similar_replies(p_user, v_embedding, 6, p_thread) with ordinality as s(
        inbound_message_id, thread_id, contact_id, inbound_subject, inbound_text, inbound_sent_at,
        reply_message_id, reply_text, reply_sent_at, similarity, n
      )
    ) end
  );
end;
$$;

revoke execute on function public.draft_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.draft_context(uuid, uuid) to service_role;
