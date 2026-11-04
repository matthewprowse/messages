-- An email that reuses another email's Message-ID no longer takes over the stored one. ingest_email used to treat any
-- second email with the same Message-ID in the account as the first one seen again, and pointed the stored message's
-- provider_meta (where View Original and the deferred file fetch look) at the newcomer, which was never triaged or
-- shown. A sender could swap in a different original behind a message you had already read.
--
-- Now the place is refreshed only when it is the same email: the same place at the provider (Gmail id, Outlook id, or
-- IMAP folder, UIDVALIDITY and UID), or the same content somewhere else (moved to another folder). The worker sends
-- content_index, a keyed hash of what the email says (Date, From, subject, text, HTML and files), so the database
-- compares content without reading it. A message stored before this has no content_index: there the same Date is
-- taken as the same email, and its content_index is filled in. Any other email with that Message-ID is left out and
-- comes back as {"result": "duplicate"}; the stored message, its thread and its place are untouched.
--
-- Message-ID stays the dedupe key: replies, sent-copy linking and threading all match on it.
--
-- ingest_email is otherwise exactly 20261025000500_email_ingest_indexes.sql as patched by
-- 20261025000900_encrypted_address_safety.sql (recipients lowercased only while readable).

alter table public.messages add column if not exists content_index text;

comment on column public.messages.content_index is
  'Keyed hash of the email''s content (worker: ingest/normalize-email.ts contentHash under the user''s index key). Tells a moved copy from a different email reusing the Message-ID.';

create or replace function public.ingest_email(p_account_id uuid, p_mail jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_existing record;
  v_person jsonb;
  v_contact uuid;
  v_new_contact uuid;
  v_contacts jsonb := '{}'::jsonb;
  v_key text;
  v_sender_key text := coalesce(p_mail->>'sender_index', p_mail->>'sender_address');
  v_thread uuid;
  v_message uuid;
  v_refs text[];
  v_role text := p_mail->>'role';
  v_inbound boolean := (p_mail->>'direction') = 'inbound';
  v_meta jsonb := coalesce(p_mail->'provider_meta', '{}'::jsonb);
  v_content text := nullif(p_mail->>'content_index', '');
  v_same boolean;
begin
  select a.user_id into v_user from public.accounts a where a.id = p_account_id;
  if v_user is null then
    raise exception 'unknown account %', p_account_id using errcode = 'P0002';
  end if;

  -- Seen before (a re-sync, or the same email in another folder): refresh where it lives and its read
  -- state, only when either changed. Another email reusing the Message-ID changes nothing.
  select m.id, m.thread_id, m.provider_meta, m.content_index, m.sent_at into v_existing
  from public.messages m
  where m.account_id = p_account_id and m.provider_message_id = p_mail->>'provider_message_id';
  if found then
    v_same := coalesce(
      -- The same place at the provider.
      (v_meta->>'gmail_id' is not null and v_meta->>'gmail_id' = v_existing.provider_meta->>'gmail_id')
      or (v_meta->>'graph_id' is not null and v_meta->>'graph_id' = v_existing.provider_meta->>'graph_id')
      or (v_meta->>'uid' is not null and v_meta->>'uid' = v_existing.provider_meta->>'uid'
          and v_meta->>'folder' = v_existing.provider_meta->>'folder'
          and v_meta->>'uid_validity' is not distinct from v_existing.provider_meta->>'uid_validity')
      -- Somewhere else, saying exactly the same.
      or (v_content is not null and v_existing.content_index = v_content)
      -- Stored before content was compared (or sent by a worker that does not compare yet): the same Date.
      or ((v_existing.content_index is null or v_content is null) and v_existing.sent_at = (p_mail->>'sent_at')::timestamptz),
      false);
    if not v_same then
      return jsonb_build_object('result', 'duplicate');
    end if;

    if v_existing.content_index is null and v_content is not null then
      update public.messages m set content_index = v_content where m.id = v_existing.id;
    end if;

    update public.messages m
    set provider_meta = p_mail->'provider_meta', is_read = (p_mail->>'is_read')::boolean
    where m.id = v_existing.id
      and (m.provider_meta is distinct from p_mail->'provider_meta' or m.is_read is distinct from (p_mail->>'is_read')::boolean);
    if found then
      perform public.refresh_thread(v_existing.thread_id);
    end if;
    return jsonb_build_object('result', 'updated', 'message_id', v_existing.id, 'thread_id', v_existing.thread_id);
  end if;

  -- One contact per email address. New people get a contact, filed under their company; an existing
  -- identity is reused. People are matched by their address's index (by the address itself when the
  -- payload has none).
  for v_person in select * from jsonb_array_elements(coalesce(p_mail->'participants', '[]'::jsonb)) loop
    v_key := coalesce(v_person->>'index', v_person->>'address');
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = v_user and ci.kind = 'email'
      and case when v_person->>'index' is not null then ci.value_index = v_person->>'index' else ci.value = v_person->>'address' end;

    if v_contact is null then
      insert into public.contacts (user_id, display_name, organization_id)
      values (v_user, v_person->>'display_name', public.organization_for_index(v_user, v_person->'company'))
      returning id into v_new_contact;

      insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
      values (v_user, v_new_contact, 'email', v_person->>'address', v_person->>'index', 'header')
      on conflict do nothing
      returning contact_id into v_contact;

      if v_contact is null then
        -- Created at the same moment elsewhere: keep theirs.
        delete from public.contacts where id = v_new_contact;
        select ci.contact_id into v_contact
        from public.contact_identities ci
        where ci.user_id = v_user and ci.kind = 'email'
          and case when v_person->>'index' is not null then ci.value_index = v_person->>'index' else ci.value = v_person->>'address' end;
      end if;
    end if;

    v_contacts := v_contacts || jsonb_build_object(v_key, v_contact);
  end loop;

  -- The conversation: by root message first, then through any message this one replies to.
  select t.id into v_thread
  from public.threads t
  where t.account_id = p_account_id and t.provider_thread_id = p_mail->>'thread_root';

  if v_thread is null then
    v_refs := array(select jsonb_array_elements_text(coalesce(p_mail->'references', '[]'::jsonb)));
    if p_mail->>'in_reply_to' is not null then
      v_refs := array_append(v_refs, p_mail->>'in_reply_to');
    end if;
    select m.thread_id into v_thread
    from public.messages m
    where m.account_id = p_account_id and m.provider_message_id = any (v_refs)
    limit 1;
  end if;

  if v_thread is null then
    -- New conversations that start outside the inbox (your sent mail, archived mail) stay out of it.
    insert into public.threads (user_id, account_id, channel, provider_thread_id, provider_thread_index, subject, status)
    values (v_user, p_account_id, 'email', p_mail->>'thread_root', p_mail->>'thread_root_index', p_mail->>'subject',
            case when v_role = 'inbox' then 'inbox' else 'archived' end)
    on conflict (account_id, provider_thread_id) do nothing
    returning id into v_thread;

    if v_thread is null then
      select t.id into v_thread
      from public.threads t
      where t.account_id = p_account_id and t.provider_thread_id = p_mail->>'thread_root';
    end if;
  end if;

  insert into public.messages (
    user_id, account_id, thread_id, provider_message_id, direction, sender_contact_id, sender_address, sender_index, to_indexes,
    sent_at, subject, preview, body_text, body_html, in_reply_to, reference_ids, is_read, provider_meta,
    to_addresses, list_unsubscribe, list_unsubscribe_post, offers_unsubscribe, subject_kept, has_original, is_bulk,
    body_marks, content_index
  )
  values (
    v_user, p_account_id, v_thread, p_mail->>'provider_message_id', p_mail->>'direction',
    case when v_inbound then (v_contacts->>v_sender_key)::uuid end,
    p_mail->>'sender_address', p_mail->>'sender_index',
    case when p_mail ? 'to_indexes' then array(select jsonb_array_elements_text(p_mail->'to_indexes')) end,
    (p_mail->>'sent_at')::timestamptz, p_mail->>'subject', p_mail->>'preview',
    p_mail->>'body_text', p_mail->>'body_html', p_mail->>'in_reply_to',
    array(select jsonb_array_elements_text(coalesce(p_mail->'references', '[]'::jsonb))),
    (p_mail->>'is_read')::boolean, v_meta,
    array(select case when x like 'e1:%' then x else lower(x) end from jsonb_array_elements_text(coalesce(p_mail->'to_addresses', '[]'::jsonb)) as x),
    nullif(p_mail->>'list_unsubscribe', ''), coalesce((p_mail->>'list_unsubscribe_post')::boolean, false),
    coalesce((p_mail->>'offers_unsubscribe')::boolean, false), coalesce((p_mail->>'subject_kept')::boolean, false),
    coalesce((p_mail->>'has_original')::boolean, p_mail->>'body_html' is not null), coalesce((p_mail->>'is_bulk')::boolean, false),
    nullif(p_mail->>'body_marks', ''), v_content
  )
  on conflict (account_id, provider_message_id) do nothing
  returning id into v_message;

  if v_message is null then
    return jsonb_build_object('result', 'updated', 'thread_id', v_thread);
  end if;

  insert into public.attachments (user_id, message_id, filename, mime_type, kind, size_bytes)
  select v_user, v_message, a.filename, a.mime_type, a.kind, a.size_bytes
  from jsonb_to_recordset(coalesce(p_mail->'attachments', '[]'::jsonb))
    as a (filename text, mime_type text, kind text, size_bytes bigint);

  insert into public.thread_participants (thread_id, contact_id, user_id)
  select v_thread, value::uuid, v_user
  from jsonb_each_text(v_contacts)
  on conflict do nothing;

  perform public.refresh_thread(v_thread, v_role = 'inbox' and v_inbound);
  return jsonb_build_object('result', 'inserted', 'message_id', v_message, 'thread_id', v_thread);
end;
$$;

revoke execute on function public.ingest_email(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_email(uuid, jsonb) to service_role;
