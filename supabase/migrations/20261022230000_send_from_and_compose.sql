-- Sending from the right address, and starting new conversations.
-- 1. accounts.send_addresses: every address an account can send from (Gmail "Send mail as", iCloud+
--    custom domains). The worker fills it for Gmail; for iCloud you list them yourself in Settings.
-- 2. messages.to_addresses: who an email was sent to, so a reply defaults to sending from that address.
-- 3. outbox.from_address, and new emails in the outbox (no conversation yet, just an account and recipients).
-- 4. style_rules.source: where a learned rule came from, so the Personalisation page can group them.

-- ---------------------------------------------------------------------------
-- 1. Send addresses
-- ---------------------------------------------------------------------------

alter table public.accounts add column send_addresses text[] not null default '{}';

-- Addresses are compared lowercase everywhere, so store them that way: trimmed, lowercase, no blanks or
-- repeats, first spelling kept in order. Doing it here means neither the app nor the worker can get it wrong.
-- Only Gmail's list is the worker's to write; app users may edit it on iCloud accounts only.
create or replace function public.normalise_send_addresses()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.send_addresses := array(
    select lower(btrim(u.a))
    from unnest(new.send_addresses) with ordinality as u (a, i)
    where btrim(u.a) <> ''
    group by lower(btrim(u.a))
    order by min(u.i)
  );
  if tg_op = 'UPDATE' and current_user = 'authenticated' and new.provider <> 'icloud'
     and new.send_addresses is distinct from old.send_addresses then
    raise exception 'send addresses can only be edited on iCloud accounts' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger normalise_send_addresses before insert or update of send_addresses on public.accounts
  for each row execute function public.normalise_send_addresses();

-- App users could update every column of their own accounts. They only need two: status (Disconnect) and
-- send_addresses (the iCloud list). The "Own rows" policy still limits them to their own accounts.
revoke update on public.accounts from authenticated;
grant update (status, send_addresses) on public.accounts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who each email was sent to (To and Cc, lowercase). Older mail stays empty and falls back to the
--    account's own address.
-- ---------------------------------------------------------------------------

alter table public.messages add column to_addresses text[] not null default '{}';

-- Same as before, plus to_addresses from p_mail.
-- p_mail is built by the worker:
--   provider_message_id, thread_root, in_reply_to, references[], subject, sent_at, direction, is_read,
--   sender_address, preview, body_text, body_html, provider_meta, role ('inbox' | 'sent' | 'archive'),
--   to_addresses[] (To and Cc),
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
    sent_at, subject, preview, body_text, body_html, in_reply_to, reference_ids, is_read, provider_meta,
    to_addresses
  )
  values (
    v_user, p_account_id, v_thread, p_mail->>'provider_message_id', p_mail->>'direction',
    case when v_inbound then (v_contacts->>(p_mail->>'sender_address'))::uuid end,
    p_mail->>'sender_address', (p_mail->>'sent_at')::timestamptz, p_mail->>'subject', p_mail->>'preview',
    p_mail->>'body_text', p_mail->>'body_html', p_mail->>'in_reply_to',
    array(select jsonb_array_elements_text(coalesce(p_mail->'references', '[]'::jsonb))),
    (p_mail->>'is_read')::boolean, coalesce(p_mail->'provider_meta', '{}'::jsonb),
    array(select lower(x) from jsonb_array_elements_text(coalesce(p_mail->'to_addresses', '[]'::jsonb)) as x)
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

-- Still worker only. create or replace keeps grants, but say it again so this file stands on its own.
revoke execute on function public.ingest_email(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_email(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Outbox: a From address, and new emails
-- ---------------------------------------------------------------------------

-- A reply names its conversation. A new email has none yet: it names the account to send from and its
-- recipients, and the worker fills in thread_id once the sent copy is stored, so the app can open it.
-- from_address null means the default; the worker only honours an address the account can send from.
alter table public.outbox alter column thread_id drop not null;
alter table public.outbox add column account_id uuid references public.accounts (id) on delete cascade;
alter table public.outbox add column to_addresses text[] not null default '{}';
alter table public.outbox add column subject text;
alter table public.outbox add column from_address text;
alter table public.outbox add constraint outbox_shape_check check (
  thread_id is not null
  or (account_id is not null and cardinality(to_addresses) > 0)
);

create index outbox_account_idx on public.outbox (account_id);

-- Columns are qualified with outbox. because threads also has account_id.
drop policy "Queue replies in own conversations" on public.outbox;
create policy "Queue replies in own conversations" on public.outbox for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and error is null
    and provider_message_id is null
    and sent_at is null
    and (outbox.draft_id is null or exists (
      select 1 from public.drafts d where d.id = outbox.draft_id and d.user_id = (select auth.uid())
    ))
    and (
      -- A reply: your own conversation, and if an account is named it must be that conversation's.
      (outbox.thread_id is not null and exists (
        select 1 from public.threads t
        where t.id = outbox.thread_id and t.user_id = (select auth.uid())
          and (outbox.account_id is null or t.account_id = outbox.account_id)
      ))
      -- A new email: one of your own email accounts.
      or (outbox.thread_id is null and exists (
        select 1 from public.accounts a
        where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider in ('icloud', 'gmail')
      ))
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Where a style rule came from: your edits to drafts, your sent mail, or typed in by you.
-- ---------------------------------------------------------------------------

alter table public.style_rules add column source text not null default 'edits'
  check (source in ('edits', 'sent_mail', 'manual'));
