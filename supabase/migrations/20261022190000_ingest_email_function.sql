-- Faster email import: everything for one email happens in a single database call.
-- Before this, the worker made about ten round trips per email (contacts, thread lookup, insert,
-- attachments, participants, thread refresh), which dominated import time.

-- Each message keeps its own one-line preview, worked out by the worker. When an email has no readable
-- text (an image-only newsletter, say) the worker falls back to the subject.
alter table public.messages add column if not exists preview text;

update public.messages
set preview = coalesce(
  nullif(left(trim(regexp_replace(split_part(coalesce(body_text, ''), E'\n>', 1), '\s+', ' ', 'g')), 160), ''),
  subject
)
where preview is null;

-- Recomputes what the conversation list shows: latest time and preview, and the unread count.
-- p_resurface brings an archived conversation back to the inbox, used when new mail arrives there.
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
  where t.id = p_thread_id;
end;
$$;

-- Stores one email exactly once and returns {"result": "inserted" | "updated", ...}.
-- p_mail is built by the worker:
--   provider_message_id, thread_root, in_reply_to, references[], subject, sent_at, direction, is_read,
--   sender_address, preview, body_text, body_html, provider_meta, role ('inbox' | 'sent' | 'archive'),
--   participants[] {address, display_name}  (everyone but you; the sender, if inbound, comes first)
--   attachments[] {filename, mime_type, kind, size_bytes}
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

  -- Seen before (a re-sync, or the same email in another folder): refresh where it lives and its read state.
  select m.id, m.thread_id into v_existing
  from public.messages m
  where m.account_id = p_account_id and m.provider_message_id = p_mail->>'provider_message_id';
  if found then
    update public.messages
    set provider_meta = p_mail->'provider_meta', is_read = (p_mail->>'is_read')::boolean
    where id = v_existing.id;
    perform public.refresh_thread(v_existing.thread_id);
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
    sent_at, subject, preview, body_text, body_html, in_reply_to, reference_ids, is_read, provider_meta
  )
  values (
    v_user, p_account_id, v_thread, p_mail->>'provider_message_id', p_mail->>'direction',
    case when v_inbound then (v_contacts->>(p_mail->>'sender_address'))::uuid end,
    p_mail->>'sender_address', (p_mail->>'sent_at')::timestamptz, p_mail->>'subject', p_mail->>'preview',
    p_mail->>'body_text', p_mail->>'body_html', p_mail->>'in_reply_to',
    array(select jsonb_array_elements_text(coalesce(p_mail->'references', '[]'::jsonb))),
    (p_mail->>'is_read')::boolean, coalesce(p_mail->'provider_meta', '{}'::jsonb)
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

-- Only the worker (service role) may call these. They are not part of the app's public API.
revoke execute on function public.refresh_thread(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.ingest_email(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.refresh_thread(uuid, boolean) to service_role;
grant execute on function public.ingest_email(uuid, jsonb) to service_role;

-- Bring existing conversation previews in line with the stored message previews.
update public.threads t
set last_message_preview = latest.preview
from (
  select distinct on (m.thread_id) m.thread_id, m.preview
  from public.messages m
  order by m.thread_id, m.sent_at desc
) latest
where latest.thread_id = t.id;
