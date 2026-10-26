-- Saved facts for drafting. A note marked Use in Drafts (in the note's menu) is given to the AI with
-- every draft, so a reply can quote a fee, a checklist or an address as you wrote it. draft_context
-- returns them as 'facts', sealed; the worker opens them with the note fields. Copied from
-- 20261029100200_draft_context_channels.sql with 'facts' added.
alter table public.notes add column use_in_drafts boolean not null default false;

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
