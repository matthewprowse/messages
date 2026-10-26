-- Instagram direct messages, synced by the Python connector (apps/ai/ai/connectors/instagram) through
-- instagrapi. Direct threads are stored exactly like WhatsApp chats: threads with channel 'instagram',
-- messages, attachments, contacts and contact_identities, through ingest_instagram, which is
-- ingest_whatsapp (20261025000600_whatsapp_indexes.sql) with Instagram people in place of numbers.
-- Read receipts and reactions reuse whatsapp_mark_read, whatsapp_set_receipt and whatsapp_react, which
-- only ever look at the account and the message, not the channel.
--
-- 1. Two identity kinds: 'instagram' is the person's user pk (stable), 'instagram_username' their handle
--    (it can change, so an old one may stay beside a new one). Both sealed as addresses and matched on
--    their blind index (address_index of the value, the same as the sync worker's indexer works out).
-- 2. instagram_contact and ingest_instagram, plus the batch form for a thread's messages at once.
-- 3. instagram_sign_ins: the step a sign-in is waiting at (a code Instagram sent by email or SMS, or a
--    two-factor code) and the code typed in the app, handed from the web app to the connector. Service
--    role only, like account_credentials; the app reads it through /api/connect/instagram.
--
-- The session itself (instagrapi's settings, with its fixed device) is kept encrypted in
-- account_credentials.refreshed, which the connector writes without moving updated_at.

-- ---------------------------------------------------------------------------
-- 1. Identity kinds and source, added to whatever the checks allow now, so other connectors' kinds stay
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.contact_identities'::regclass and c.conname = 'contact_identities_kind_check';
  if v_def is not null and v_def not like '%''instagram''%' then
    alter table public.contact_identities drop constraint contact_identities_kind_check;
    execute 'alter table public.contact_identities add constraint contact_identities_kind_check '
      || regexp_replace(v_def, 'ARRAY\[', 'ARRAY[''instagram''::text, ''instagram_username''::text, ');
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.contact_identities'::regclass and c.conname = 'contact_identities_source_check';
  if v_def is not null and v_def not like '%''instagram''%' then
    alter table public.contact_identities drop constraint contact_identities_source_check;
    execute 'alter table public.contact_identities add constraint contact_identities_source_check '
      || regexp_replace(v_def, 'ARRAY\[', 'ARRAY[''instagram''::text, ');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. People and messages
-- ---------------------------------------------------------------------------

-- Finds the contact for an Instagram person by their pk, and adds the identities it lacks.
-- p_person: {pk, pk_index, username, username_index, display_name, handle}, pk and username sealed when
-- addresses are. display_name is their full name, handle their username as names are stored (plain, like
-- every contact name). A new contact is named by the first of them; display_name replaces a contact's name
-- only while that name is still the placeholder or their handle, so a name you gave them is kept.
create or replace function public.instagram_contact(p_user uuid, p_person jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_pk text := nullif(p_person->>'pk', '');
  v_pk_index text := nullif(p_person->>'pk_index', '');
  v_username text := nullif(p_person->>'username', '');
  v_username_index text := nullif(p_person->>'username_index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_handle text := nullif(btrim(coalesce(p_person->>'handle', '')), '');
  v_contact uuid;
  v_new uuid;
  v_current text;
begin
  if v_pk is null then
    return null;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user and ci.kind = 'instagram'
    and case when v_pk_index is not null then ci.value_index = v_pk_index else ci.value = v_pk end
  order by ci.created_at
  limit 1;

  if v_contact is null then
    insert into public.contacts (user_id, display_name)
    values (p_user, coalesce(v_name, v_handle, 'Instagram Contact'))
    returning id into v_new;
    v_contact := v_new;
  else
    select c.display_name into v_current from public.contacts c where c.id = v_contact;
    if v_name is not null and v_current is distinct from v_name
       and (v_current = 'Instagram Contact' or v_current = v_handle) then
      update public.contacts set display_name = v_name where id = v_contact;
    end if;
  end if;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  select p_user, v_contact, i.kind, i.value, i.value_index, 'instagram'
  from (values ('instagram', v_pk, v_pk_index), ('instagram_username', v_username, v_username_index))
    as i (kind, value, value_index)
  where i.value is not null
  on conflict do nothing;

  if v_new is not null then
    -- Created at the same moment elsewhere: keep theirs.
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'instagram'
      and case when v_pk_index is not null then ci.value_index = v_pk_index else ci.value = v_pk end;
    if v_contact is distinct from v_new then
      delete from public.contacts where id = v_new;
    end if;
  end if;
  return v_contact;
end;
$$;

-- Stores one Instagram direct message exactly once. The same payload shape as ingest_whatsapp, with
-- chat_jid the thread's ID and people in instagram_contact's shape; there is no other ID for a thread to
-- move from. Groups (more than one other person) are opt-in for AI triage, like WhatsApp groups.
create or replace function public.ingest_instagram(p_account_id uuid, p_msg jsonb)
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
  v_chat_index text := nullif(p_msg->>'chat_index', '');
  v_group boolean := coalesce((p_msg->>'is_group')::boolean, false);
  v_group_name text := nullif(btrim(coalesce(p_msg->>'group_name', '')), '');
  v_inbound boolean := (p_msg->>'direction') = 'inbound';
  v_message uuid;
  v_attachments jsonb;
begin
  select a.user_id into v_user from public.accounts a where a.id = p_account_id and a.provider = 'instagram';
  if v_user is null then
    raise exception 'unknown account %', p_account_id using errcode = 'P0002';
  end if;

  -- Seen before: every poll reads the newest messages again, and a sent reply is stored as soon as it goes out.
  select m.id, m.thread_id into v_existing
  from public.messages m
  where m.account_id = p_account_id and m.provider_message_id = p_msg->>'provider_message_id';
  if found then
    return jsonb_build_object('result', 'updated', 'message_id', v_existing.id, 'thread_id', v_existing.thread_id);
  end if;

  for v_person in select * from jsonb_array_elements(coalesce(p_msg->'participants', '[]'::jsonb)) loop
    v_contact := public.instagram_contact(v_user, v_person);
    if v_contact is not null then
      v_contacts := array_append(v_contacts, v_contact);
    end if;
  end loop;
  if v_inbound and jsonb_typeof(p_msg->'sender') = 'object' then
    v_sender := public.instagram_contact(v_user, p_msg->'sender');
    if v_sender is not null then
      v_contacts := array_append(v_contacts, v_sender);
    end if;
  end if;

  select t.id into v_thread
  from public.threads t
  where t.account_id = p_account_id
    and case when v_chat_index is not null then t.provider_thread_index = v_chat_index else t.provider_thread_id = v_chat end;

  if v_thread is null then
    insert into public.threads (user_id, account_id, channel, provider_thread_id, provider_thread_index, is_group, group_name, triage_enabled, status)
    values (v_user, p_account_id, 'instagram', v_chat, v_chat_index, v_group, v_group_name, not v_group,
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
    nullif(p_msg->>'sender_index', ''), '{}'::text[],
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

-- A thread's new messages in one request, oldest first, each in its own savepoint like ingest_whatsapp_batch.
create or replace function public.ingest_instagram_batch(p_account_id uuid, p_msgs jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_msg jsonb;
  v_out jsonb[] := '{}';
begin
  for v_msg in
    select e.value from jsonb_array_elements(coalesce(p_msgs, '[]'::jsonb)) with ordinality as e (value, n) order by e.n
  loop
    begin
      v_out := array_append(v_out, public.ingest_instagram(p_account_id, v_msg));
    exception when others then
      v_out := array_append(v_out, jsonb_build_object('result', 'error', 'code', sqlstate));
    end;
  end loop;
  return to_jsonb(v_out);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Sign-in steps
-- ---------------------------------------------------------------------------

create table public.instagram_sign_ins (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  /** code: Instagram sent a security code (a challenge). two_factor: the account has two-factor authentication on. */
  step text not null check (step in ('code', 'two_factor')),
  /** Where the code went, when Instagram says: email or sms. Two-factor codes may come from an authenticator app. */
  method text check (method in ('email', 'sms', 'app')),
  /** The code typed in the app, encrypted like account_credentials. Cleared as soon as the connector takes it. */
  code text,
  /** How many codes this step has asked for. A second one means Instagram did not accept the first. */
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.instagram_sign_ins for each row execute function public.set_updated_at();
alter table public.instagram_sign_ins enable row level security;

-- ---------------------------------------------------------------------------
-- Who may call what: the connector only, with the service role.
-- ---------------------------------------------------------------------------

revoke execute on function public.instagram_contact(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.instagram_contact(uuid, jsonb) to service_role;
revoke execute on function public.ingest_instagram(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_instagram(uuid, jsonb) to service_role;
revoke execute on function public.ingest_instagram_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_instagram_batch(uuid, jsonb) to service_role;
