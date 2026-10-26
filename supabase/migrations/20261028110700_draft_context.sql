-- Everything a draft's prompt needs, in one call. The AI worker read it in three or four rounds of
-- separate requests (the conversation, then the person and similar replies, which depend on it), and
-- each round is a trip to the database of a quarter to half a second: well over a second of a draft's
-- wait, before the model was even asked.
--
-- Returns jsonb with the same rows the worker read before, text still sealed (the worker opens it):
--   thread       id, user_id, account_id, subject; null when it is not p_user's (then nothing else)
--   messages     the latest 12 in the conversation, newest first
--   profile, rules, examples, recent (their latest 8 sent emails)
--   contact      who sent the latest incoming message that has a sender, with their company
--   to_them      their latest 3 sent emails to that person in other conversations
--   similar      similar_replies for the latest incoming message, or null when it has no vector yet
--                (mail nobody has answered is not embedded), so the worker embeds it and searches itself
--
-- Apply before deploying the AI worker that calls it: the worker before it does not use it.
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
