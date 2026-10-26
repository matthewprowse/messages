-- Google Chat: direct messages, group chats and named spaces, stored as conversations on channel 'google_chat'
-- by the google_meet account, which also brings in Meet transcripts. The same storage as WhatsApp chats
-- (public.ingest_whatsapp): one thread per space, found by its blind index, with each message stored once and
-- the people in it matched to contacts. People are matched by email address, as email matches them; someone
-- whose address Google does not give keeps the contact their earlier Chat messages were filed under, found by
-- the blind index of their Google user ID in messages.sender_index. No table changes.
--
-- The payload (p_msg), written by apps/worker/src/connectors/google-meet.ts:
--   provider_message_id  the message's name, spaces/{space}/messages/{message}
--   space, space_index   the space's name (sealed as an address) and its chat index
--   is_group, group_name a named space's or group chat's; group_name only for named spaces
--   sent_at, direction, is_read, resurface, preview, body_text (sealed), provider_meta
--   sender_address, sender_index   users/{id} (sealed) and its address index
--   sender, participants  people: {address, index, display_name, user_index}; address is their email (sealed)

-- The contact for one Chat person, made when new. Returns null for nobody.
create or replace function public.google_chat_contact(p_user uuid, p_account_id uuid, p_person jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_address text := nullif(p_person->>'address', '');
  v_index text := nullif(p_person->>'index', '');
  v_user_index text := nullif(p_person->>'user_index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_contact uuid;
  v_new uuid;
  v_current text;
begin
  if v_address is null and v_user_index is null then
    return null;
  end if;

  if v_address is not null then
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'email'
      and case when v_index is not null then ci.value_index = v_index else ci.value = v_address end;
  end if;

  if v_contact is null and v_user_index is not null then
    select m.sender_contact_id into v_contact
    from public.messages m
    where m.account_id = p_account_id and m.sender_index = v_user_index and m.sender_contact_id is not null
    order by m.sent_at desc
    limit 1;
  end if;

  if v_contact is null then
    insert into public.contacts (user_id, display_name)
    values (p_user, coalesce(v_name, ''))
    returning id into v_new;
    v_contact := v_new;
  else
    select c.display_name into v_current from public.contacts c where c.id = v_contact;
    if v_name is not null and v_current is distinct from v_name and public.contact_name_is_placeholder(v_current) then
      update public.contacts set display_name = v_name where id = v_contact;
    end if;
  end if;

  if v_address is not null then
    insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
    values (p_user, v_contact, 'email', v_address, v_index, 'header')
    on conflict do nothing;

    if v_new is not null then
      -- Created at the same moment elsewhere: keep theirs.
      select ci.contact_id into v_contact
      from public.contact_identities ci
      where ci.user_id = p_user and ci.kind = 'email'
        and case when v_index is not null then ci.value_index = v_index else ci.value = v_address end;
      if v_contact is distinct from v_new then
        delete from public.contacts where id = v_new;
      end if;
    end if;
  end if;
  return v_contact;
end;
$$;

-- Stores one Chat message exactly once, in its space's conversation. Like public.ingest_whatsapp.
create or replace function public.ingest_google_chat(p_account_id uuid, p_msg jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_provider text;
  v_existing record;
  v_person jsonb;
  v_contact uuid;
  v_sender uuid;
  v_contacts uuid[] := '{}';
  v_thread uuid;
  v_space text := p_msg->>'space';
  v_space_index text := nullif(p_msg->>'space_index', '');
  v_group boolean := coalesce((p_msg->>'is_group')::boolean, false);
  v_group_name text := nullif(btrim(coalesce(p_msg->>'group_name', '')), '');
  v_inbound boolean := (p_msg->>'direction') = 'inbound';
  v_message uuid;
begin
  select a.user_id, a.provider into v_user, v_provider from public.accounts a where a.id = p_account_id;
  if v_user is null then
    raise exception 'unknown account %', p_account_id using errcode = 'P0002';
  end if;
  if v_provider <> 'google_meet' then
    raise exception 'account % is not a Google Meet and Chat account', p_account_id using errcode = '22023';
  end if;

  -- Seen before: polls overlap, and a sent reply is stored as soon as it goes out.
  select m.id, m.thread_id into v_existing
  from public.messages m
  where m.account_id = p_account_id and m.provider_message_id = p_msg->>'provider_message_id';
  if found then
    return jsonb_build_object('result', 'updated', 'message_id', v_existing.id, 'thread_id', v_existing.thread_id);
  end if;

  for v_person in select * from jsonb_array_elements(coalesce(p_msg->'participants', '[]'::jsonb)) loop
    v_contact := public.google_chat_contact(v_user, p_account_id, v_person);
    if v_contact is not null then
      v_contacts := array_append(v_contacts, v_contact);
    end if;
  end loop;
  if v_inbound and jsonb_typeof(p_msg->'sender') = 'object' then
    v_sender := public.google_chat_contact(v_user, p_account_id, p_msg->'sender');
    if v_sender is not null then
      v_contacts := array_append(v_contacts, v_sender);
    end if;
  end if;

  select t.id into v_thread
  from public.threads t
  where t.account_id = p_account_id
    and case when v_space_index is not null then t.provider_thread_index = v_space_index else t.provider_thread_id = v_space end;

  if v_thread is null then
    -- Groups are opt-in for AI triage, as WhatsApp groups are.
    insert into public.threads (user_id, account_id, channel, provider_thread_id, provider_thread_index, is_group, group_name, triage_enabled, status)
    values (v_user, p_account_id, 'google_chat', v_space, v_space_index, v_group, v_group_name, not v_group,
            case when p_msg->>'status' = 'archived' then 'archived' else 'inbox' end)
    on conflict do nothing
    returning id into v_thread;

    if v_thread is null then
      select t.id into v_thread
      from public.threads t
      where t.account_id = p_account_id
        and case when v_space_index is not null then t.provider_thread_index = v_space_index else t.provider_thread_id = v_space end;
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
    nullif(p_msg->>'sender_index', ''), '{}'::text[],
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

revoke execute on function public.google_chat_contact(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.google_chat_contact(uuid, uuid, jsonb) to service_role;
revoke execute on function public.ingest_google_chat(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_google_chat(uuid, jsonb) to service_role;
