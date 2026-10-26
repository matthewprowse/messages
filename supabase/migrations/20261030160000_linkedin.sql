-- LinkedIn messages, synced by the sync worker (apps/worker/src/connectors/linkedin.ts) through its LinkedIn
-- helper (apps/linkedin). Conversations are stored exactly like WhatsApp chats: threads with channel
-- 'linkedin', their messages, and a contact for each person with their profile URN as a contact identity of
-- kind 'linkedin'.
-- ingest_linkedin is ingest_whatsapp (20261025000600_whatsapp_indexes.sql) with LinkedIn's one identity in
-- place of a phone number and privacy ID, and no chat that moves between two IDs.
--
-- Encrypted the same way as WhatsApp: the conversation ID (threads.provider_thread_id, provider_meta.chat) and
-- profile URNs (contact_identities.value, messages.sender_address) under the address field when addresses are
-- encrypted, matched on their blind indexes; message text under body and preview.

alter table public.contact_identities drop constraint if exists contact_identities_kind_check;
alter table public.contact_identities add constraint contact_identities_kind_check
  check (kind in ('email', 'phone', 'whatsapp', 'linkedin'));

alter table public.contact_identities drop constraint if exists contact_identities_source_check;
alter table public.contact_identities add constraint contact_identities_source_check
  check (source in ('header', 'address_book', 'signature', 'whatsapp', 'manual', 'linkedin'));

-- A LinkedIn person: {urn, urn_index, display_name}. Found by their profile URN's index (or the URN itself
-- from a caller without indexes), else created. A name only replaces a bare URN placeholder, so a name you
-- set or one from your address book is kept.
create or replace function public.linkedin_contact(p_user uuid, p_person jsonb, p_create boolean default true)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_urn text := nullif(p_person->>'urn', '');
  v_index text := nullif(p_person->>'urn_index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_contact uuid;
  v_new uuid;
  v_current text;
begin
  if v_urn is null then
    return null;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user and ci.kind = 'linkedin'
    and case when v_index is not null then ci.value_index = v_index else ci.value = v_urn end
  order by ci.created_at
  limit 1;

  if v_contact is null then
    if not p_create then
      return null;
    end if;
    insert into public.contacts (user_id, display_name)
    values (p_user, coalesce(v_name, 'LinkedIn Member'))
    returning id into v_new;
    v_contact := v_new;
  else
    select c.display_name into v_current from public.contacts c where c.id = v_contact;
    if v_name is not null and v_current is distinct from v_name
       and (coalesce(v_current, '') in ('', 'LinkedIn Member') or v_current like 'urn:li:%') then
      update public.contacts set display_name = v_name where id = v_contact;
    end if;
  end if;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  values (p_user, v_contact, 'linkedin', v_urn, v_index, 'linkedin')
  on conflict do nothing;

  if v_new is not null then
    -- Created at the same moment elsewhere: keep theirs.
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'linkedin'
      and case when v_index is not null then ci.value_index = v_index else ci.value = v_urn end;
    if v_contact is distinct from v_new then
      delete from public.contacts where id = v_new;
    end if;
  end if;
  return v_contact;
end;
$$;

-- Stores one LinkedIn message exactly once, with its conversation, people and file names. The payload is
-- ingest_whatsapp's with chat_jid as chat_id and people as linkedin_contact takes them.
create or replace function public.ingest_linkedin(p_account_id uuid, p_msg jsonb)
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
  v_attachments jsonb;
begin
  select a.user_id into v_user from public.accounts a where a.id = p_account_id and a.provider = 'linkedin';
  if v_user is null then
    raise exception 'unknown account %', p_account_id using errcode = 'P0002';
  end if;

  -- Seen before: every poll reads a conversation's latest messages again, and a sent reply is stored at once.
  select m.id, m.thread_id into v_existing
  from public.messages m
  where m.account_id = p_account_id and m.provider_message_id = p_msg->>'provider_message_id';
  if found then
    return jsonb_build_object('result', 'updated', 'message_id', v_existing.id, 'thread_id', v_existing.thread_id);
  end if;

  for v_person in select * from jsonb_array_elements(coalesce(p_msg->'participants', '[]'::jsonb)) loop
    v_contact := public.linkedin_contact(v_user, v_person, true);
    if v_contact is not null then
      v_contacts := array_append(v_contacts, v_contact);
    end if;
  end loop;
  if v_inbound and jsonb_typeof(p_msg->'sender') = 'object' then
    v_sender := public.linkedin_contact(v_user, p_msg->'sender', true);
    if v_sender is not null then
      v_contacts := array_append(v_contacts, v_sender);
    end if;
  end if;

  select t.id into v_thread
  from public.threads t
  where t.account_id = p_account_id
    and case when v_chat_index is not null then t.provider_thread_index = v_chat_index else t.provider_thread_id = v_chat end;

  if v_thread is null then
    -- Group conversations are opt-in for AI triage, like WhatsApp groups.
    insert into public.threads (user_id, account_id, channel, provider_thread_id, provider_thread_index, is_group, group_name, triage_enabled, status)
    values (v_user, p_account_id, 'linkedin', v_chat, v_chat_index, v_group, v_group_name, not v_group,
            case when p_msg->>'status' = 'archived' then 'archived' else 'inbox' end)
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

  with inserted as (
    insert into public.attachments (user_id, message_id, filename, mime_type, kind, size_bytes)
    select v_user, v_message, a.filename, a.mime_type, a.kind, a.size_bytes
    from jsonb_to_recordset(coalesce(p_msg->'attachments', '[]'::jsonb))
      as a (filename text, mime_type text, kind text, size_bytes bigint)
    returning id
  )
  select jsonb_agg(id) into v_attachments from inserted;

  insert into public.thread_participants (thread_id, contact_id, user_id)
  select distinct v_thread, c, v_user
  from unnest(v_contacts) as c
  on conflict do nothing;

  perform public.refresh_thread(v_thread, coalesce((p_msg->>'resurface')::boolean, false));
  return jsonb_build_object(
    'result', 'inserted', 'message_id', v_message, 'thread_id', v_thread,
    'attachment_ids', coalesce(v_attachments, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.linkedin_contact(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.linkedin_contact(uuid, jsonb, boolean) to service_role;
revoke execute on function public.ingest_linkedin(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_linkedin(uuid, jsonb) to service_role;
