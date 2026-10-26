-- Microsoft Teams chats (provider teams, channel teams). A chat is stored like a WhatsApp chat: one
-- conversation per chat, found by the chat's index, with groups opt-in for AI triage. People are matched by
-- email address like email's, since Teams knows everyone by their work address. The sync worker sends,
-- with each person, their address's index and company (as ingest_email takes them), and with each message
-- its chat's index. Meetings and their transcripts use the shared meetings tables and need nothing here.

-- The contact for a Teams person, found by their address's index or created under their company.
create or replace function public.teams_contact(p_user uuid, p_person jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_address text := nullif(p_person->>'address', '');
  v_index text := nullif(p_person->>'index', '');
  v_contact uuid;
  v_new uuid;
begin
  if v_address is null or v_index is null then
    return null;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user and ci.kind = 'email' and ci.value_index = v_index
  limit 1;
  if v_contact is not null then
    return v_contact;
  end if;

  insert into public.contacts (user_id, display_name, organization_id)
  values (p_user, coalesce(nullif(btrim(coalesce(p_person->>'display_name', '')), ''), v_address),
          public.organization_for_index(p_user, p_person->'company'))
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
    where ci.user_id = p_user and ci.kind = 'email' and ci.value_index = v_index
    limit 1;
  end if;
  return v_contact;
end;
$$;

-- Stores one Teams message exactly once. Seen again (polls overlap, and a sent reply is stored as soon as
-- it goes out), an edit, deletion or reaction made in Teams since replaces its text and provider_meta,
-- found by provider_meta.modified, and a message read in Teams since is marked read.
create or replace function public.ingest_teams(p_account_id uuid, p_msg jsonb)
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
  v_read boolean := coalesce((p_msg->>'is_read')::boolean, false);
  v_message uuid;
begin
  select a.user_id into v_user from public.accounts a where a.id = p_account_id;
  if v_user is null then
    raise exception 'unknown account %', p_account_id using errcode = 'P0002';
  end if;
  if v_chat is null or v_chat_index is null then
    raise exception 'teams message without a chat' using errcode = '22023';
  end if;

  select m.id, m.thread_id, m.is_read, m.provider_meta->>'modified' as modified into v_existing
  from public.messages m
  where m.account_id = p_account_id and m.provider_message_id = p_msg->>'provider_message_id';
  if found then
    if v_existing.modified is distinct from p_msg->'provider_meta'->>'modified' then
      update public.messages m
      set body_text = p_msg->>'body_text', preview = p_msg->>'preview', body_marks = nullif(p_msg->>'body_marks', ''),
          provider_meta = coalesce(p_msg->'provider_meta', '{}'::jsonb), is_read = m.is_read or v_read
      where m.id = v_existing.id;
      perform public.refresh_thread(v_existing.thread_id);
    elsif v_read and not v_existing.is_read then
      update public.messages set is_read = true where id = v_existing.id;
      perform public.refresh_thread(v_existing.thread_id);
    end if;
    return jsonb_build_object('result', 'updated', 'message_id', v_existing.id, 'thread_id', v_existing.thread_id);
  end if;

  for v_person in select * from jsonb_array_elements(coalesce(p_msg->'participants', '[]'::jsonb)) loop
    v_contact := public.teams_contact(v_user, v_person);
    if v_contact is not null then
      v_contacts := array_append(v_contacts, v_contact);
    end if;
  end loop;
  if v_inbound and jsonb_typeof(p_msg->'sender') = 'object' then
    v_sender := public.teams_contact(v_user, p_msg->'sender');
    if v_sender is not null then
      v_contacts := array_append(v_contacts, v_sender);
    end if;
  end if;

  select t.id into v_thread
  from public.threads t
  where t.account_id = p_account_id and t.provider_thread_index = v_chat_index;

  if v_thread is null then
    -- Groups are opt-in for AI triage, as for WhatsApp.
    insert into public.threads (user_id, account_id, channel, provider_thread_id, provider_thread_index, is_group, group_name, triage_enabled, status)
    values (v_user, p_account_id, 'teams', v_chat, v_chat_index, v_group, v_group_name, not v_group,
            case when p_msg->>'status' = 'archived' then 'archived' else 'inbox' end)
    on conflict do nothing
    returning id into v_thread;

    if v_thread is null then
      select t.id into v_thread
      from public.threads t
      where t.account_id = p_account_id and t.provider_thread_index = v_chat_index;
    end if;
  elsif v_group and v_group_name is not null then
    update public.threads set group_name = v_group_name where id = v_thread and group_name is distinct from v_group_name;
  end if;

  insert into public.messages (
    user_id, account_id, thread_id, provider_message_id, direction, sender_contact_id, sender_address,
    sender_index, to_indexes, sent_at, preview, body_text, body_marks, is_read, provider_meta
  )
  values (
    v_user, p_account_id, v_thread, p_msg->>'provider_message_id', p_msg->>'direction',
    case when v_inbound then v_sender end, nullif(p_msg->>'sender_address', ''),
    nullif(p_msg->>'sender_index', ''), '{}'::text[],
    (p_msg->>'sent_at')::timestamptz, p_msg->>'preview', p_msg->>'body_text', nullif(p_msg->>'body_marks', ''),
    v_read, coalesce(p_msg->'provider_meta', '{}'::jsonb)
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

-- A chat read in Teams (its read point moved on) is read here too, up to that point. Returns how many
-- messages changed. Nothing is ever sent to Teams from here.
create or replace function public.teams_mark_read(p_account_id uuid, p_chat_index text, p_until timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_thread uuid;
  v_count integer := 0;
begin
  select t.id into v_thread
  from public.threads t
  where t.account_id = p_account_id and t.provider_thread_index = p_chat_index and t.unread_count > 0;
  if v_thread is null then
    return 0;
  end if;
  update public.messages m
  set is_read = true
  where m.thread_id = v_thread and m.direction = 'inbound' and not m.is_read and m.sent_at <= p_until;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.refresh_thread(v_thread);
  end if;
  return v_count;
end;
$$;

revoke execute on function public.teams_contact(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.teams_contact(uuid, jsonb) to service_role;
revoke execute on function public.ingest_teams(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_teams(uuid, jsonb) to service_role;
revoke execute on function public.teams_mark_read(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.teams_mark_read(uuid, text, timestamptz) to service_role;
