-- Store less: an email's HTML is no longer kept. View Original fetches it from Gmail or iCloud when you
-- open it, through email_originals, and what the app needed the stored HTML for is worked out by the sync
-- worker as the email arrives:
-- * has_original: the email has an HTML version, so View Original is offered.
-- * is_bulk: it is a newsletter or marketing email (the app shows a short preview and leads with the original).
-- * body_text holds readable text taken from the HTML when the email's own text part is missing or junk.
-- Existing emails are moved over by apps/worker/scripts/drop-stored-html.ts.

alter table public.messages add column has_original boolean not null default false;
alter table public.messages add column is_bulk boolean not null default false;
update public.messages set has_original = true where body_html is not null;

-- A request to see one email as it was sent. The app adds it; the sync worker fetches the email from the
-- provider and fills in html, encrypted with the user's key (field "html"); the app reads it and the row
-- is deleted after an hour. html is never kept beyond that.
create table public.email_originals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'working', 'done', 'failed')),
  html text,
  error text,
  created_at timestamptz not null default now()
);

create index email_originals_pending_idx on public.email_originals (created_at) where status = 'queued';
create index email_originals_message_idx on public.email_originals (message_id);

alter table public.email_originals enable row level security;

create policy "Read own originals" on public.email_originals for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Ask for originals of own email" on public.email_originals for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued' and html is null and error is null
    and exists (select 1 from public.messages m where m.id = message_id and m.user_id = (select auth.uid()))
  );

create policy "Clear own originals" on public.email_originals for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.email_originals from anon;
revoke update, truncate on public.email_originals from authenticated;

alter publication supabase_realtime add table public.email_originals;

-- ingest_email stores the two new flags. A worker from before this change sends neither: has_original then
-- follows whether HTML came with the email.
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
    to_addresses, list_unsubscribe, list_unsubscribe_post, offers_unsubscribe, subject_kept, has_original, is_bulk
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
    coalesce((p_mail->>'offers_unsubscribe')::boolean, false), coalesce((p_mail->>'subject_kept')::boolean, false),
    coalesce((p_mail->>'has_original')::boolean, p_mail->>'body_html' is not null), coalesce((p_mail->>'is_bulk')::boolean, false)
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
