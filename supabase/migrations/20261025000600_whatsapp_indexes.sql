-- Encryption, stage 2, step 4: WhatsApp matches people and chats on blind indexes. The sync worker sends,
-- with each number and privacy ID, its index (phone_index, lid_index), with each chat its index
-- (chat_index, chat_alt_index), and with each message its sender_index. A payload or call without them,
-- from a worker that has not restarted yet, still matches on the readable values as before.

-- whatsapp_contact: matches and stores identities by index. Otherwise the same as in
-- 20261024102000_whatsapp_contact_placeholder_names.sql.
create or replace function public.whatsapp_contact(p_user uuid, p_person jsonb, p_create boolean default true)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_phone text := nullif(p_person->>'phone', '');
  v_lid text := nullif(p_person->>'lid', '');
  v_phone_index text := nullif(p_person->>'phone_index', '');
  v_lid_index text := nullif(p_person->>'lid_index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_push text := nullif(btrim(coalesce(p_person->>'push_name', '')), '');
  v_contact uuid;
  v_new uuid;
  v_current text;
begin
  if v_phone is null and v_lid is null then
    return null;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user
    and ((v_phone is not null and ci.kind in ('whatsapp', 'phone')
          and case when v_phone_index is not null then ci.value_index = v_phone_index else ci.value = v_phone end)
      or (v_lid is not null and ci.kind = 'whatsapp'
          and case when v_lid_index is not null then ci.value_index = v_lid_index else ci.value = v_lid end))
  order by (ci.kind = 'whatsapp') desc, ci.created_at
  limit 1;

  if v_contact is null then
    if not p_create then
      return null;
    end if;
    insert into public.contacts (user_id, display_name)
    values (p_user, coalesce(v_name, v_push, v_phone, v_lid))
    returning id into v_new;
    v_contact := v_new;
  else
    select c.display_name into v_current from public.contacts c where c.id = v_contact;
    if v_name is not null and v_current is distinct from v_name
       and (coalesce(v_current, '') ~ '^(\+?[0-9]*|[0-9]+@lid)$' or v_current = v_push) then
      update public.contacts set display_name = v_name where id = v_contact;
    end if;
  end if;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  select p_user, v_contact, i.kind, i.value, i.value_index, 'whatsapp'
  from (values ('phone', v_phone, v_phone_index), ('whatsapp', v_phone, v_phone_index), ('whatsapp', v_lid, v_lid_index))
    as i (kind, value, value_index)
  where i.value is not null
  on conflict do nothing;

  if v_new is not null then
    -- Created at the same moment elsewhere: keep theirs.
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'whatsapp'
      and case when coalesce(v_phone_index, v_lid_index) is not null
        then ci.value_index = case when v_phone is not null then v_phone_index else v_lid_index end
        else ci.value = coalesce(v_phone, v_lid) end;
    if v_contact is distinct from v_new then
      delete from public.contacts where id = v_new;
    end if;
  end if;
  return v_contact;
end;
$$;

-- ingest_whatsapp: finds and moves chats by index, and stores the message's sender_index. Otherwise the
-- same as in 20261024090000_whatsapp_ingest.sql.
create or replace function public.ingest_whatsapp(p_account_id uuid, p_msg jsonb)
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
  v_chat text := p_msg->>'chat_jid';
  v_alt text := nullif(p_msg->>'chat_alt_jid', '');
  v_chat_index text := nullif(p_msg->>'chat_index', '');
  v_alt_index text := nullif(p_msg->>'chat_alt_index', '');
  v_group boolean := coalesce((p_msg->>'is_group')::boolean, false);
  v_group_name text := nullif(btrim(coalesce(p_msg->>'group_name', '')), '');
  v_inbound boolean := (p_msg->>'direction') = 'inbound';
  v_message uuid;
  v_attachments jsonb;
begin
  select a.user_id into v_user from public.accounts a where a.id = p_account_id;
  if v_user is null then
    raise exception 'unknown account %', p_account_id using errcode = 'P0002';
  end if;

  -- Seen before: history and live delivery overlap, and a sent reply is stored as soon as it goes out.
  select m.id, m.thread_id into v_existing
  from public.messages m
  where m.account_id = p_account_id and m.provider_message_id = p_msg->>'provider_message_id';
  if found then
    return jsonb_build_object('result', 'updated', 'message_id', v_existing.id, 'thread_id', v_existing.thread_id);
  end if;

  for v_person in select * from jsonb_array_elements(coalesce(p_msg->'participants', '[]'::jsonb)) loop
    v_contact := public.whatsapp_contact(v_user, v_person, true);
    if v_contact is not null then
      v_contacts := array_append(v_contacts, v_contact);
    end if;
  end loop;
  if v_inbound and jsonb_typeof(p_msg->'sender') = 'object' then
    v_sender := public.whatsapp_contact(v_user, p_msg->'sender', true);
    if v_sender is not null then
      v_contacts := array_append(v_contacts, v_sender);
    end if;
  end if;

  -- The conversation: by the chat's JID, else by its other JID, which then moves to the preferred one.
  select t.id into v_thread
  from public.threads t
  where t.account_id = p_account_id
    and case when v_chat_index is not null then t.provider_thread_index = v_chat_index else t.provider_thread_id = v_chat end;

  if v_thread is null and v_alt is not null then
    update public.threads t
    set provider_thread_id = v_chat, provider_thread_index = v_chat_index
    where t.account_id = p_account_id
      and case when v_alt_index is not null then t.provider_thread_index = v_alt_index else t.provider_thread_id = v_alt end
    returning t.id into v_thread;
  end if;

  if v_thread is null then
    -- Groups are opt-in for AI triage.
    insert into public.threads (user_id, account_id, channel, provider_thread_id, provider_thread_index, is_group, group_name, triage_enabled, status)
    values (v_user, p_account_id, 'whatsapp', v_chat, v_chat_index, v_group, v_group_name, not v_group,
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

-- whatsapp_map_lid and whatsapp_mark_read take the indexes as extra arguments. They are dropped and made
-- again so a call with only the old arguments still finds one function.
drop function public.whatsapp_map_lid(uuid, text, text, text);
create function public.whatsapp_map_lid(
  p_account_id uuid, p_lid_jid text, p_pn_jid text, p_phone text,
  -- The privacy ID's and number's indexes as people (contact_identities, messages.sender_index), and the
  -- one-to-one chat's under each (threads.provider_thread_index).
  p_lid_index text default null, p_phone_index text default null,
  p_lid_chat_index text default null, p_pn_chat_index text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select a.user_id into v_user from public.accounts a where a.id = p_account_id;
  if v_user is null or p_phone is null or p_lid_jid is null then
    return;
  end if;

  if exists (
    select 1 from public.contact_identities ci
    where ci.user_id = v_user and ci.kind = 'whatsapp'
      and case when p_lid_index is not null then ci.value_index = p_lid_index else ci.value = p_lid_jid end
  ) then
    perform public.whatsapp_contact(v_user, jsonb_build_object('phone', p_phone, 'lid', p_lid_jid, 'phone_index', p_phone_index, 'lid_index', p_lid_index), false);
  end if;

  update public.threads t
  set provider_thread_id = p_pn_jid, provider_thread_index = p_pn_chat_index
  where t.account_id = p_account_id
    and case when p_lid_chat_index is not null then t.provider_thread_index = p_lid_chat_index else t.provider_thread_id = p_lid_jid end
    and not exists (
      select 1 from public.threads o
      where o.account_id = p_account_id
        and case when p_pn_chat_index is not null then o.provider_thread_index = p_pn_chat_index else o.provider_thread_id = p_pn_jid end
    );

  update public.messages m
  set sender_address = p_phone, sender_index = p_phone_index
  where m.account_id = p_account_id
    and case when p_lid_index is not null then m.sender_index = p_lid_index else m.sender_address = p_lid_jid end;
end;
$$;

drop function public.whatsapp_mark_read(uuid, text[]);
create function public.whatsapp_mark_read(p_account_id uuid, p_chat_jids text[], p_chat_indexes text[] default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_thread uuid;
  v_count integer := 0;
begin
  for v_thread in
    select t.id from public.threads t
    where t.account_id = p_account_id and t.unread_count > 0
      and case when p_chat_indexes is not null then t.provider_thread_index = any (p_chat_indexes) else t.provider_thread_id = any (p_chat_jids) end
  loop
    update public.messages m
    set is_read = true,
        provider_meta = case when m.provider_meta->>'receipt' = 'pending'
          then m.provider_meta || '{"receipt": "phone"}'::jsonb else m.provider_meta end
    where m.thread_id = v_thread and m.direction = 'inbound' and not m.is_read;
    perform public.refresh_thread(v_thread);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.whatsapp_contact(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_contact(uuid, jsonb, boolean) to service_role;
revoke execute on function public.ingest_whatsapp(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp(uuid, jsonb) to service_role;
revoke execute on function public.whatsapp_map_lid(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_map_lid(uuid, text, text, text, text, text, text, text) to service_role;
revoke execute on function public.whatsapp_mark_read(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.whatsapp_mark_read(uuid, text[], text[]) to service_role;
