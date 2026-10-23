-- WhatsApp: linking from the web app or the terminal, and storing messages in one database call each.
--
-- * The worker links as a WhatsApp Web style device (Baileys). While linking it writes the QR code to
--   accounts.qr_code, or a pairing code to accounts.pairing_code when you asked for one by phone number.
--   Both are cleared once the device is linked.
-- * One conversation per WhatsApp chat. Its provider_thread_id is the chat's JID: a phone number JID
--   (447700900123@s.whatsapp.net) where known, else a privacy ID (...@lid), else a group (...@g.us).
-- * People get 'phone' and 'whatsapp' identities in E.164 (+447700900123). Someone known only by a
--   privacy ID gets a 'whatsapp' identity with that ID until WhatsApp says which number it is.

-- ---------------------------------------------------------------------------
-- 1. Linking
-- ---------------------------------------------------------------------------

alter table public.accounts add column pairing_phone text check (pairing_phone ~ '^[0-9]{7,15}$');
alter table public.accounts add column pairing_code text;

comment on column public.accounts.qr_code is 'WhatsApp QR code text while linking. Cleared once linked.';
comment on column public.accounts.pairing_phone is 'WhatsApp: the number, digits only, to link with a pairing code instead of the QR code.';
comment on column public.accounts.pairing_code is 'WhatsApp: the code to type on your phone while linking. Cleared once linked.';

-- Starts linking (or reconnecting) your WhatsApp account. Creates the account the first time. Touching
-- account_credentials makes the worker restart the connector within 30 seconds; for WhatsApp that row
-- holds no secret, the session itself lives encrypted in whatsapp_auth_keys.
create or replace function public.request_whatsapp_link(p_user uuid, p_phone text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_account uuid;
  v_status text;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
begin
  if v_phone is not null and v_phone !~ '^[0-9]{7,15}$' then
    raise exception 'Enter the full number with its country code.' using errcode = '22023';
  end if;

  select a.id, a.status into v_account, v_status
  from public.accounts a
  where a.user_id = p_user and a.provider = 'whatsapp'
  order by a.created_at
  limit 1;

  if v_account is null then
    insert into public.accounts (user_id, provider, label, address, status)
    values (p_user, 'whatsapp', 'WhatsApp', '', 'connecting')
    returning id into v_account;
  elsif v_status in ('connected', 'syncing') then
    raise exception 'WhatsApp is already linked.' using errcode = '55000';
  end if;

  update public.accounts
  set status = 'connecting',
      status_detail = 'Starting. The code appears within 30 seconds while the worker is running.',
      qr_code = null,
      pairing_code = null,
      pairing_phone = v_phone
  where id = v_account;

  insert into public.account_credentials (account_id, ciphertext, updated_at)
  values (v_account, 'whatsapp:session-in-whatsapp_auth_keys', now())
  on conflict (account_id) do update set updated_at = now();

  return v_account;
end;
$$;

-- The web app's way in: always for the signed-in user.
create or replace function public.link_whatsapp(p_phone text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  return public.request_whatsapp_link((select auth.uid()), p_phone);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. People
-- ---------------------------------------------------------------------------

-- Finds the contact for a WhatsApp person, by phone number or privacy ID, and adds any identity it lacks.
-- p_person: {phone: '+44...' | null, lid: '...@lid' | null, display_name, push_name}
-- display_name is the best name known: the one saved on your phone, else the one they set themselves.
-- It replaces a contact's name only when that name is a bare number or ID, or the self-set name.
-- With p_create false, people not already known are left alone and null is returned.
create or replace function public.whatsapp_contact(p_user uuid, p_person jsonb, p_create boolean default true)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_phone text := nullif(p_person->>'phone', '');
  v_lid text := nullif(p_person->>'lid', '');
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
    and ((v_phone is not null and ci.kind in ('whatsapp', 'phone') and ci.value = v_phone)
      or (v_lid is not null and ci.kind = 'whatsapp' and ci.value = v_lid))
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
       and coalesce(v_current, '') in ('', coalesce(v_phone, ''), coalesce(v_lid, ''), coalesce(v_push, '')) then
      update public.contacts set display_name = v_name where id = v_contact;
    end if;
  end if;

  insert into public.contact_identities (user_id, contact_id, kind, value, source)
  select p_user, v_contact, i.kind, i.value, 'whatsapp'
  from (values ('phone', v_phone), ('whatsapp', v_phone), ('whatsapp', v_lid)) as i (kind, value)
  where i.value is not null
  on conflict (user_id, kind, value) do nothing;

  if v_new is not null then
    -- Created at the same moment elsewhere: keep theirs.
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'whatsapp' and ci.value = coalesce(v_phone, v_lid);
    if v_contact is distinct from v_new then
      delete from public.contacts where id = v_new;
    end if;
  end if;
  return v_contact;
end;
$$;

-- Names learned from your phone's contacts after people are already stored. Never creates anyone.
-- p_people: [{phone, lid, display_name, push_name}]. Returns how many contacts were looked at.
create or replace function public.whatsapp_contact_names(p_account_id uuid, p_people jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_person jsonb;
  v_count integer := 0;
begin
  select a.user_id into v_user from public.accounts a where a.id = p_account_id;
  for v_person in select * from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) loop
    if public.whatsapp_contact(v_user, v_person, false) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- WhatsApp revealed the number behind a privacy ID: the contact gains the number, and a one-to-one chat
-- stored under the ID moves to the number (unless a chat under the number already exists).
create or replace function public.whatsapp_map_lid(p_account_id uuid, p_lid_jid text, p_pn_jid text, p_phone text)
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

  if exists (select 1 from public.contact_identities ci where ci.user_id = v_user and ci.kind = 'whatsapp' and ci.value = p_lid_jid) then
    perform public.whatsapp_contact(v_user, jsonb_build_object('phone', p_phone, 'lid', p_lid_jid), false);
  end if;

  update public.threads t
  set provider_thread_id = p_pn_jid
  where t.account_id = p_account_id and t.provider_thread_id = p_lid_jid
    and not exists (select 1 from public.threads o where o.account_id = p_account_id and o.provider_thread_id = p_pn_jid);

  update public.messages m
  set sender_address = p_phone
  where m.account_id = p_account_id and m.sender_address = p_lid_jid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Messages
-- ---------------------------------------------------------------------------

-- Stores one WhatsApp message exactly once and returns
-- {"result": "inserted" | "updated", message_id, thread_id, attachment_ids[]}.
-- p_msg is built by the worker:
--   provider_message_id, chat_jid, chat_alt_jid (the chat's other JID, phone or privacy ID, if known),
--   is_group, group_name, status ('inbox' | 'archived', for a new conversation), resurface (bring an
--   archived conversation back, for new incoming messages), sent_at, direction, is_read,
--   sender {phone, lid, display_name, push_name} (who wrote an incoming message), sender_address,
--   participants[] {phone, lid, display_name, push_name}, preview, body_text, provider_meta,
--   attachments[] {filename, mime_type, kind, size_bytes}
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
  where t.account_id = p_account_id and t.provider_thread_id = v_chat;

  if v_thread is null and v_alt is not null then
    update public.threads t
    set provider_thread_id = v_chat
    where t.account_id = p_account_id and t.provider_thread_id = v_alt
    returning t.id into v_thread;
  end if;

  if v_thread is null then
    -- Groups are opt-in for AI triage.
    insert into public.threads (user_id, account_id, channel, provider_thread_id, is_group, group_name, triage_enabled, status)
    values (v_user, p_account_id, 'whatsapp', v_chat, v_group, v_group_name, not v_group,
            case when p_msg->>'status' = 'archived' then 'archived' else 'inbox' end)
    on conflict (account_id, provider_thread_id) do nothing
    returning id into v_thread;

    if v_thread is null then
      select t.id into v_thread
      from public.threads t
      where t.account_id = p_account_id and t.provider_thread_id = v_chat;
    end if;
  elsif v_group and v_group_name is not null then
    update public.threads set group_name = v_group_name where id = v_thread and group_name is distinct from v_group_name;
  end if;

  insert into public.messages (
    user_id, account_id, thread_id, provider_message_id, direction, sender_contact_id, sender_address,
    sent_at, preview, body_text, is_read, provider_meta
  )
  values (
    v_user, p_account_id, v_thread, p_msg->>'provider_message_id', p_msg->>'direction',
    case when v_inbound then v_sender end, nullif(p_msg->>'sender_address', ''),
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

-- An edit or a deletion made in WhatsApp. Null body or preview leaves it as it is; p_meta is merged into
-- provider_meta. Returns false when the message is not stored.
create or replace function public.whatsapp_update_message(
  p_account_id uuid, p_provider_message_id text, p_body text, p_preview text, p_meta jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_thread uuid;
begin
  update public.messages m
  set body_text = coalesce(p_body, m.body_text),
      preview = coalesce(p_preview, m.preview),
      provider_meta = m.provider_meta || coalesce(p_meta, '{}'::jsonb)
  where m.account_id = p_account_id and m.provider_message_id = p_provider_message_id
  returning m.thread_id into v_thread;
  if v_thread is null then
    return false;
  end if;
  perform public.refresh_thread(v_thread);
  return true;
end;
$$;

-- A reaction, kept on the message it reacts to as provider_meta.reactions {"<who>": "<emoji>"}, where
-- who is 'me', a phone number or a privacy ID. An empty emoji removes that person's reaction.
create or replace function public.whatsapp_react(p_account_id uuid, p_provider_message_id text, p_sender text, p_emoji text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_found boolean;
begin
  update public.messages m
  set provider_meta = jsonb_set(
    m.provider_meta,
    '{reactions}',
    case when coalesce(p_emoji, '') = ''
      then coalesce(m.provider_meta->'reactions', '{}'::jsonb) - p_sender
      else coalesce(m.provider_meta->'reactions', '{}'::jsonb) || jsonb_build_object(p_sender, p_emoji)
    end
  )
  where m.account_id = p_account_id and m.provider_message_id = p_provider_message_id
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

-- Chats read on your phone are read here too. Returns how many conversations changed.
create or replace function public.whatsapp_mark_read(p_account_id uuid, p_chat_jids text[])
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
    where t.account_id = p_account_id and t.provider_thread_id = any (p_chat_jids) and t.unread_count > 0
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

-- Records whether a read receipt went to WhatsApp for these messages: 'sent', or 'skipped' when read
-- receipts are off in Settings.
create or replace function public.whatsapp_set_receipt(p_account_id uuid, p_message_ids uuid[], p_state text)
returns void
language sql
set search_path = ''
as $$
  update public.messages m
  set provider_meta = m.provider_meta || jsonb_build_object('receipt', p_state)
  where m.account_id = p_account_id and m.id = any (p_message_ids);
$$;

-- ---------------------------------------------------------------------------
-- 4. Who may call what
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.request_whatsapp_link(uuid, text)',
    'public.whatsapp_contact(uuid, jsonb, boolean)',
    'public.whatsapp_contact_names(uuid, jsonb)',
    'public.whatsapp_map_lid(uuid, text, text, text)',
    'public.ingest_whatsapp(uuid, jsonb)',
    'public.whatsapp_update_message(uuid, text, text, text, jsonb)',
    'public.whatsapp_react(uuid, text, text, text)',
    'public.whatsapp_mark_read(uuid, text[])',
    'public.whatsapp_set_receipt(uuid, uuid[], text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

revoke execute on function public.link_whatsapp(text) from public, anon;
grant execute on function public.link_whatsapp(text) to authenticated;
