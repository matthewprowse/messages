-- Encryption, stage 1: a message's subject, preview, bodies and unsubscribe header can now be stored
-- encrypted, so the database can no longer search them. Two checks that did now read flags the sync
-- worker sets from the readable text before it encrypts:
-- * offers_unsubscribe: the body mentions unsubscribing (it marked the conversation a subscription).
-- * subject_kept: the subject reads like a receipt, invoice or ticket (it keeps a PDF in a junk
--   conversation visible).
-- Both are filled in here from the text stored so far, which is still readable.

alter table public.messages add column offers_unsubscribe boolean not null default false;
alter table public.messages add column subject_kept boolean not null default false;

update public.messages set offers_unsubscribe = true
where direction = 'inbound' and not offers_unsubscribe
  and (body_html ilike '%unsubscribe%' or body_text ilike '%unsubscribe%');

update public.messages set subject_kept = true
where not subject_kept and subject is not null and subject not like 'e1:%'
  and subject ~* '(receipt|invoice|ticket|statement|booking|itinerary|confirmation|reservation|boarding|voucher|order|tax|bill|payslip|payment|purchase|quotation|quote|rechnung|factura|factuur|recibo)';

-- ingest_email stores the two flags from the payload.
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
    to_addresses, list_unsubscribe, list_unsubscribe_post, offers_unsubscribe, subject_kept
  )
  values (
    v_user, p_account_id, v_thread, p_mail->>'provider_message_id', p_mail->>'direction',
    case when v_inbound then (v_contacts->>(p_mail->>'sender_address'))::uuid end,
    p_mail->>'sender_address', (p_mail->>'sent_at')::timestamptz, p_mail->>'subject', p_mail->>'preview',
    p_mail->>'body_text', p_mail->>'body_html', p_mail->>'in_reply_to',
    array(select jsonb_array_elements_text(coalesce(p_mail->'references', '[]'::jsonb))),
    (p_mail->>'is_read')::boolean, coalesce(p_mail->'provider_meta', '{}'::jsonb),
    array(select lower(x) from jsonb_array_elements_text(coalesce(p_mail->'to_addresses', '[]'::jsonb)) as x),
    nullif(p_mail->>'list_unsubscribe', ''), coalesce((p_mail->>'list_unsubscribe_post')::boolean, false),
    coalesce((p_mail->>'offers_unsubscribe')::boolean, false), coalesce((p_mail->>'subject_kept')::boolean, false)
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

-- A conversation becomes a subscription when an incoming message has an unsubscribe header or offers a
-- way out in its body.
create or replace function public.subscription_on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'inbound' and (new.list_unsubscribe is not null or new.offers_unsubscribe) then
    update public.threads set subscription = true where id = new.thread_id and not subscription;
  end if;
  return null;
end;
$$;

revoke execute on function public.subscription_on_message_insert() from public, anon, authenticated;
drop function public.message_marks_subscription(text, text, text, text);

-- The attachment rules read whether the subject looks like a receipt from the flag, passing a word the
-- rule's pattern matches in place of the subject.
create or replace function public.refresh_attachment_junk(p_thread_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.attachments a
  set hidden = x.junk, hidden_reason = case when x.junk then 'junk' end
  from (
    select a2.id,
      public.attachment_is_junk(a2.kind, a2.filename, case when m.subject_kept then 'receipt' end, m.direction, t.junk, t.category)
        and lower(coalesce(a2.mime_type, '')) not in ('text/calendar', 'application/ics') as junk
    from public.attachments a2
    join public.messages m on m.id = a2.message_id
    join public.threads t on t.id = m.thread_id
    where t.id = p_thread_id
  ) x
  where a.id = x.id
    and (a.hidden_reason is null or a.hidden_reason = 'junk')
    and a.hidden is distinct from x.junk;
$$;

create or replace function public.attachment_junk_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hidden_reason is null then
    select public.attachment_is_junk(new.kind, new.filename, case when m.subject_kept then 'receipt' end, m.direction, t.junk, t.category)
      and lower(coalesce(new.mime_type, '')) not in ('text/calendar', 'application/ics')
    into new.hidden
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.id = new.message_id;
    new.hidden := coalesce(new.hidden, false);
    if new.hidden then new.hidden_reason := 'junk'; end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.refresh_attachment_junk(uuid) from public, anon, authenticated;
revoke execute on function public.attachment_junk_on_insert() from public, anon, authenticated;
grant execute on function public.refresh_attachment_junk(uuid) to service_role;
