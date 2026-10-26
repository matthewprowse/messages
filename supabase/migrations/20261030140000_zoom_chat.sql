-- Zoom Team Chat: storing a chat message, the way ingest_whatsapp stores a WhatsApp one. The sync worker polls
-- Zoom (apps/worker/src/zoom/chat.ts) and sends each message here once; a message seen again is left as it is.
--
-- A conversation is one Zoom chat on channel 'zoom': a 1:1 chat keyed by the other person's email (or Zoom ID),
-- a group chat by its channel ID, stored sealed in provider_thread_id and found by provider_thread_index. People
-- are matched by email, on the address's blind index, like ingest_email: someone you already email is the same
-- contact in Zoom.
--
-- p_msg: provider_message_id, chat_id, chat_index, is_group, group_name, resurface (bring an archived
--   conversation back, for new incoming messages), sent_at, direction, is_read, sender ({address, index,
--   display_name} for an inbound message), sender_address, sender_index, participants ([{address, index,
--   display_name}], the other person in a 1:1 chat), preview, body_text, provider_meta.

-- The contact for one email address, found by its index (by the address itself when there is none) or created.
create or replace function public.zoom_chat_contact(p_user uuid, p_person jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_address text := nullif(p_person->>'address', '');
  v_index text := nullif(p_person->>'index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_contact uuid;
  v_new uuid;
begin
  if v_address is null then
    return null;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user and ci.kind = 'email'
    and case when v_index is not null then ci.value_index = v_index else ci.value = v_address end;
  if v_contact is not null then
    return v_contact;
  end if;

  -- A new contact is never named by an encrypted address.
  insert into public.contacts (user_id, display_name)
  values (p_user, coalesce(v_name, case when v_address not like 'e1:%' then v_address end, 'Zoom Contact'))
  returning id into v_new;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  values (p_user, v_new, 'email', v_address, v_index, 'header')
  on conflict do nothing
  returning contact_id into v_contact;

  if v_contact is null then
    -- Created at the same moment elsewhere: keep theirs.
    delete from public.contacts where id = v_new;
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'email'
      and case when v_index is not null then ci.value_index = v_index else ci.value = v_address end;
  end if;
  return v_contact;
end;
$$;

create or replace function public.ingest_zoom_chat(p_account_id uuid, p_msg jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_existing record;
  v_person jsonb;
  v_contact uuid;
  v_sender uuid;
  v_contacts uuid[] := '{}';
  v_thread uuid;
  v_chat text := p_msg->>'chat_id';
  v_chat_index text := nullif(p_msg->>'chat_index', '');
  v_group boolean := coalesce((p_msg->>'is_group')::boolean, false);
  v_group_name text := nullif(btrim(coalesce(p_msg->>'group_name', '')), '');
  v_inbound boolean := (p_msg->>'direction') = 'inbound';
  v_message uuid;
begin
  select a.user_id into v_user from public.accounts a where a.id = p_account_id and a.provider = 'zoom';
  if v_user is null then
    raise exception 'unknown zoom account %', p_account_id using errcode = 'P0002';
  end if;

  -- Seen before: polls overlap, and a sent reply is stored as soon as it goes out.
  select m.id, m.thread_id into v_existing
  from public.messages m
  where m.account_id = p_account_id and m.provider_message_id = p_msg->>'provider_message_id';
  if found then
    return jsonb_build_object('result', 'updated', 'message_id', v_existing.id, 'thread_id', v_existing.thread_id);
  end if;

  for v_person in select * from jsonb_array_elements(coalesce(p_msg->'participants', '[]'::jsonb)) loop
    v_contact := public.zoom_chat_contact(v_user, v_person);
    if v_contact is not null then
      v_contacts := array_append(v_contacts, v_contact);
    end if;
  end loop;
  if v_inbound and jsonb_typeof(p_msg->'sender') = 'object' then
    v_sender := public.zoom_chat_contact(v_user, p_msg->'sender');
    if v_sender is not null then
      v_contacts := array_append(v_contacts, v_sender);
    end if;
  end if;

  select t.id into v_thread
  from public.threads t
  where t.account_id = p_account_id
    and case when v_chat_index is not null then t.provider_thread_index = v_chat_index else t.provider_thread_id = v_chat end;

  if v_thread is null then
    -- Groups are opt-in for AI triage, as for WhatsApp.
    insert into public.threads (user_id, account_id, channel, provider_thread_id, provider_thread_index, is_group, group_name, triage_enabled, status)
    values (v_user, p_account_id, 'zoom', v_chat, v_chat_index, v_group, v_group_name, not v_group, 'inbox')
    on conflict do nothing
    returning id into v_thread;

    if v_thread is null then
      select t.id into v_thread
      from public.threads t
      where t.account_id = p_account_id
        and case when v_chat_index is not null then t.provider_thread_index = v_chat_index else t.provider_thread_id = v_chat end;
    end if;
  elsif v_group and v_group_name is not null then
    update public.threads set group_name = v_group_name where id = v_thread and group_name is distinct from v_group_name;
  end if;

  insert into public.messages (
    user_id, account_id, thread_id, provider_message_id, direction, sender_contact_id, sender_address,
    sender_index, to_indexes, sent_at, preview, body_text, is_read, provider_meta
  )
  values (
    v_user, p_account_id, v_thread, p_msg->>'provider_message_id', p_msg->>'direction',
    case when v_inbound then v_sender end, nullif(p_msg->>'sender_address', ''),
    nullif(p_msg->>'sender_index', ''), case when p_msg ? 'chat_index' then '{}'::text[] end,
    (p_msg->>'sent_at')::timestamptz, p_msg->>'preview', p_msg->>'body_text',
    coalesce((p_msg->>'is_read')::boolean, false), coalesce(p_msg->'provider_meta', '{}'::jsonb)
  )
  on conflict (account_id, provider_message_id) do nothing
  returning id into v_message;

  if v_message is null then
    return jsonb_build_object('result', 'updated', 'thread_id', v_thread);
  end if;

  insert into public.thread_participants (thread_id, contact_id, user_id)
  select distinct v_thread, c, v_user
  from unnest(v_contacts) as c
  on conflict do nothing;

  perform public.refresh_thread(v_thread, coalesce((p_msg->>'resurface')::boolean, false));
  return jsonb_build_object('result', 'inserted', 'message_id', v_message, 'thread_id', v_thread);
end;
$$;

revoke execute on function public.zoom_chat_contact(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.zoom_chat_contact(uuid, jsonb) to service_role;
revoke execute on function public.ingest_zoom_chat(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_zoom_chat(uuid, jsonb) to service_role;
