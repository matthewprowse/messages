-- Message embeddings, sealed. A vector says what a message means, so it no longer sits in the database
-- readable. Part A of two (part B is 20261102800100_drop_plaintext_embeddings.sql).
--
-- 1. message_embeddings.embedding_data: the vector as float32, sealed with the user's data key (AES-GCM,
--    the same format as other sealed bytes, field "embedding_data"), base64 text. A row is waiting in the
--    AI worker's queue while it is null. The plaintext column `embedding` and its HNSW index stay until
--    part B, so the old worker keeps drafting until the new one is deployed.
-- 2. reply_pairs(): given the ids of the nearest incoming messages (found by the AI worker over the
--    user's opened vectors, newest 3000), returns each with the reply the user sent: by In-Reply-To
--    first, else the next message sent. Same rows and same reply rule as similar_replies, without the
--    vector search or the similarity (the worker has the score).
-- 3. draft_context() no longer calls similar_replies: 'similar' is gone, 'latest_inbound_id' is added, and
--    the worker searches. Copied from 20261029100300_draft_facts.sql.
-- 4. embedded_message_count() counts a message as embedded when it has a sealed vector or, until part B,
--    a readable one, so the Settings count does not dip while the backfill runs.
--
-- ORDER: apply this file, deploy the AI worker, run the sealing backfill (python3 -m ai.seal_embeddings,
-- dry run first), run it again with --apply until it reports nothing left, then apply part B.

alter table public.message_embeddings add column embedding_data text;

create index message_embeddings_pending_sealed_idx on public.message_embeddings (sent_at desc) where embedding_data is null;
create index message_embeddings_user_sent_idx on public.message_embeddings (user_id, sent_at desc) where embedding_data is not null;

create or replace function public.reply_pairs(p_user uuid, p_ids uuid[])
returns table (
  inbound_message_id uuid,
  thread_id uuid,
  contact_id uuid,
  inbound_subject text,
  inbound_text text,
  inbound_sent_at timestamptz,
  reply_message_id uuid,
  reply_text text,
  reply_sent_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.thread_id, c.sender_contact_id, c.subject, c.body_text, c.sent_at, r.id, r.body_text, r.sent_at
  from public.messages c
  cross join lateral (
    select o.id, o.body_text, o.sent_at
    from public.messages o
    where o.thread_id = c.thread_id
      and o.user_id = p_user
      and o.direction = 'outbound'
      and o.body_text is not null
      and (
        o.in_reply_to = c.provider_message_id
        or (o.sent_at > c.sent_at and not exists (
          select 1 from public.messages n
          where n.thread_id = c.thread_id and n.direction = 'inbound'
            and n.sent_at > c.sent_at and n.sent_at < o.sent_at
        ))
      )
    order by (o.in_reply_to is distinct from c.provider_message_id), o.sent_at
    limit 1
  ) r
  where c.id = any (p_ids) and c.user_id = p_user and c.direction = 'inbound'
    and cardinality(p_ids) <= 200;
$$;

revoke execute on function public.reply_pairs(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reply_pairs(uuid, uuid[]) to service_role;

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
  v_channel text;
begin
  select jsonb_build_object('id', t.id, 'user_id', t.user_id, 'account_id', t.account_id, 'subject', t.subject,
                            'channel', t.channel, 'is_group', t.is_group, 'group_name', t.group_name),
         t.channel
  into v_thread, v_channel
  from public.threads t
  where t.id = p_thread and t.user_id = p_user;
  if v_thread is null then
    return jsonb_build_object('thread', null);
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.sent_at desc), '[]'::jsonb)
  into v_messages
  from (
    select m.id, m.direction, m.sender_contact_id, m.body_text, m.body_html, m.subject, m.sent_at, m.transcript,
           m.provider_meta -> 'quoted' as quoted, m.provider_meta -> 'media' ->> 'type' as media,
           (select coalesce(jsonb_agg(a.filename order by a.created_at), '[]'::jsonb)
            from public.attachments a where a.message_id = m.id and a.user_id = p_user and not a.hidden) as files
    from public.messages m
    where m.thread_id = p_thread and m.user_id = p_user
    order by m.sent_at desc
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
    -- Notes you marked Use in Drafts: facts a reply may need (fees, checklists, addresses), still sealed.
    -- Ordered by id so the start of the prompt stays the same from draft to draft.
    'facts', (
      select coalesce(jsonb_agg(jsonb_build_object('title', n.title, 'body', n.body) order by n.id), '[]'::jsonb)
      from (
        select id, title, body from public.notes
        where user_id = p_user and use_in_drafts
        order by id
        limit 15
      ) n
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
    -- Your sent messages on this channel only: a WhatsApp line is no example for an email, nor the other way.
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object('body_text', m.body_text, 'body_html', m.body_html) order by m.sent_at desc, m.id), '[]'::jsonb)
      from (
        select om.body_text, om.body_html, om.sent_at, om.id from public.messages om
        join public.threads ot on ot.id = om.thread_id
        where om.user_id = p_user and om.direction = 'outbound' and ot.channel = v_channel
        order by om.sent_at desc, om.id
        limit 8
      ) m
    ),
    -- Everyone who wrote in these messages by name, for group chats and threads with several people.
    'senders', (
      select coalesce(jsonb_object_agg(c.id, c.display_name), '{}'::jsonb)
      from public.contacts c
      where c.user_id = p_user and c.id in (
        select (e ->> 'sender_contact_id')::uuid from jsonb_array_elements(v_messages) e
        where e ->> 'sender_contact_id' is not null
      )
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
        select om.body_text, om.body_html, om.sent_at from public.messages om
        join public.threads ot on ot.id = om.thread_id
        where om.user_id = p_user and om.direction = 'outbound' and ot.channel = v_channel
          and om.thread_id in (
            select tp.thread_id from public.thread_participants tp
            where tp.contact_id = v_contact and tp.user_id = p_user and tp.thread_id <> p_thread
            limit 30
          )
        order by om.sent_at desc
        limit 3
      ) m
    ),
    -- Guided drafting's choices for it, still sealed: the worker drops a pre-draft when there are any.
    'choices', (select a.reply_choices from public.message_ai a where a.message_id = v_latest and a.user_id = p_user),
    -- The newest incoming message. The worker reads its vector and searches for similar replies itself
    -- (apps/ai/ai/similar.py): the vectors are sealed, so the database cannot.
    'latest_inbound_id', v_latest
  );
end;
$$;

revoke execute on function public.draft_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.draft_context(uuid, uuid) to service_role;

create or replace function public.embedded_message_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.message_embeddings
  where user_id = (select auth.uid()) and (embedding_data is not null or embedding is not null);
$$;

revoke execute on function public.embedded_message_count() from public, anon;
grant execute on function public.embedded_message_count() to authenticated;
