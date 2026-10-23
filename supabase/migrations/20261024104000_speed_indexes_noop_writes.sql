-- Speed: indexes for the queries the app, worker and AI run most, and no writes that change nothing.
-- Every write to threads or messages also reaches open browsers through Realtime, so skipping no-op
-- writes saves both the database work and the refetches they caused.

-- ---------------------------------------------------------------------------
-- 1. Indexes
-- ---------------------------------------------------------------------------

-- Mail from one sender in one account, newest first: unsubscribing and junk marking. Production only has
-- the sender_contact_id index of the same old name (messages_sender_idx); this one never got built.
create index if not exists messages_sender_address_idx on public.messages (account_id, sender_address, sent_at desc);

-- A user's mail by direction, newest first: draft writing (your recent sent mail), the voice learner,
-- company summaries and the contact linker's signature scan. It also serves every user_id lookup, so the
-- single-column index it replaces goes.
create index if not exists messages_user_direction_sent_idx on public.messages (user_id, direction, sent_at desc);
drop index if exists public.messages_user_idx;

-- The AI triage poll: the newest incoming mail first.
create index if not exists messages_inbound_recent_idx on public.messages (sent_at desc) where direction = 'inbound';

-- Where a message lives on the mail server: iCloud by folder and UID, Gmail by its message ID. Looked up on
-- every flag change, every inbox reconcile and every Gmail history poll.
create index if not exists messages_imap_place_idx on public.messages (account_id, (provider_meta->>'folder'), (provider_meta->>'uid'));
create index if not exists messages_gmail_id_idx on public.messages (account_id, (provider_meta->>'gmail_id'));

-- The conversation list, newest first, under row-level security on user_id.
create index if not exists threads_recent_idx on public.threads (user_id, last_message_at desc nulls last);

-- Files not stored yet, which each connector's catch-up pass looks for.
create index if not exists attachments_missing_file_idx on public.attachments (message_id) where storage_path is null;

-- Feedback on a conversation, newest first. An earlier migration meant to build this, but an index of the
-- same name (thread_id only) already existed, so it never was.
create index if not exists feedback_thread_recent_idx on public.feedback (thread_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. refresh_thread: write only when something changed
-- ---------------------------------------------------------------------------

create or replace function public.refresh_thread(p_thread_id uuid, p_resurface boolean default false)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_latest record;
  v_unread integer;
begin
  select m.sent_at, m.preview into v_latest
  from public.messages m
  where m.thread_id = p_thread_id
  order by m.sent_at desc
  limit 1;

  select count(*) into v_unread
  from public.messages m
  where m.thread_id = p_thread_id and m.direction = 'inbound' and not m.is_read;

  update public.threads t
  set last_message_at = v_latest.sent_at,
      last_message_preview = v_latest.preview,
      unread_count = v_unread,
      status = case when p_resurface then 'inbox' else t.status end
  where t.id = p_thread_id
    and (t.last_message_at, t.last_message_preview, t.unread_count, t.status)
      is distinct from (v_latest.sent_at, v_latest.preview, v_unread, case when p_resurface then 'inbox' else t.status end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. ingest_email: no-op re-syncs stay read-only, and the unsubscribe header comes in the same call
-- ---------------------------------------------------------------------------

-- Same as before, except:
-- * a message seen again is updated (and its conversation refreshed) only when where it lives or its read
--   state actually changed;
-- * p_mail may carry list_unsubscribe and list_unsubscribe_post, stored with the new message, so the
--   worker no longer needs a second request for them.
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
  v_thread uuid;
  v_message uuid;
  v_refs text[];
  v_role text := p_mail->>'role';
  v_inbound boolean := (p_mail->>'direction') = 'inbound';
begin
  select a.user_id into v_user from public.accounts a where a.id = p_account_id;
  if v_user is null then
    raise exception 'unknown account %', p_account_id using errcode = 'P0002';
  end if;

  -- Seen before (a re-sync, or the same email in another folder): refresh where it lives and its read
  -- state, only when either changed.
  select m.id, m.thread_id into v_existing
  from public.messages m
  where m.account_id = p_account_id and m.provider_message_id = p_mail->>'provider_message_id';
  if found then
    update public.messages m
    set provider_meta = p_mail->'provider_meta', is_read = (p_mail->>'is_read')::boolean
    where m.id = v_existing.id
      and (m.provider_meta is distinct from p_mail->'provider_meta' or m.is_read is distinct from (p_mail->>'is_read')::boolean);
    if found then
      perform public.refresh_thread(v_existing.thread_id);
    end if;
    return jsonb_build_object('result', 'updated', 'message_id', v_existing.id, 'thread_id', v_existing.thread_id);
  end if;

  -- One contact per email address. New people get a contact; an existing identity is reused.
  for v_person in select * from jsonb_array_elements(coalesce(p_mail->'participants', '[]'::jsonb)) loop
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = v_user and ci.kind = 'email' and ci.value = v_person->>'address';

    if v_contact is null then
      insert into public.contacts (user_id, display_name)
      values (v_user, v_person->>'display_name')
      returning id into v_new_contact;

      insert into public.contact_identities (user_id, contact_id, kind, value, source)
      values (v_user, v_new_contact, 'email', v_person->>'address', 'header')
      on conflict (user_id, kind, value) do nothing
      returning contact_id into v_contact;

      if v_contact is null then
        -- Created at the same moment elsewhere: keep theirs.
        delete from public.contacts where id = v_new_contact;
        select ci.contact_id into v_contact
        from public.contact_identities ci
        where ci.user_id = v_user and ci.kind = 'email' and ci.value = v_person->>'address';
      end if;
    end if;

    v_contacts := v_contacts || jsonb_build_object(v_person->>'address', v_contact);
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
    insert into public.threads (user_id, account_id, channel, provider_thread_id, subject, status)
    values (v_user, p_account_id, 'email', p_mail->>'thread_root', p_mail->>'subject',
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
    user_id, account_id, thread_id, provider_message_id, direction, sender_contact_id, sender_address,
    sent_at, subject, preview, body_text, body_html, in_reply_to, reference_ids, is_read, provider_meta,
    to_addresses, list_unsubscribe, list_unsubscribe_post
  )
  values (
    v_user, p_account_id, v_thread, p_mail->>'provider_message_id', p_mail->>'direction',
    case when v_inbound then (v_contacts->>(p_mail->>'sender_address'))::uuid end,
    p_mail->>'sender_address', (p_mail->>'sent_at')::timestamptz, p_mail->>'subject', p_mail->>'preview',
    p_mail->>'body_text', p_mail->>'body_html', p_mail->>'in_reply_to',
    array(select jsonb_array_elements_text(coalesce(p_mail->'references', '[]'::jsonb))),
    (p_mail->>'is_read')::boolean, coalesce(p_mail->'provider_meta', '{}'::jsonb),
    array(select lower(x) from jsonb_array_elements_text(coalesce(p_mail->'to_addresses', '[]'::jsonb)) as x),
    nullif(p_mail->>'list_unsubscribe', ''), coalesce((p_mail->>'list_unsubscribe_post')::boolean, false)
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
revoke execute on function public.refresh_thread(uuid, boolean) from public, anon, authenticated;
grant execute on function public.refresh_thread(uuid, boolean) to service_role;
