-- Encryption, stage 2: the outbox keeps who a message is to and from encrypted too. The browser seals
-- them as it queues a message and the worker opens them to send, so the insert policy accepts an encrypted
-- number for a new WhatsApp chat (the worker checks it). encrypt_addresses_write can now re-store existing
-- outbox rows. Otherwise the same as in 20261023300000_new_anything.sql and 20261025001000.

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
      -- A new WhatsApp chat: your own WhatsApp account, one phone number (checked by the worker once it is
      -- encrypted), no subject or From address.
      or (outbox.thread_id is null
        and cardinality(outbox.to_addresses) = 1
        and (outbox.to_addresses[1] ~ '^\+[1-9][0-9]{6,14}$' or outbox.to_addresses[1] like 'e1:%')
        and outbox.subject is null
        and outbox.from_address is null
        and exists (
          select 1 from public.accounts a
          where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider = 'whatsapp'
        ))
    )
  );

create or replace function public.encrypt_addresses_write(p_table text, p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_columns text[] := case p_table
    when 'contact_identities' then array['value']
    when 'messages' then array['sender_address', 'to_addresses', 'provider_meta']
    when 'threads' then array['provider_thread_id']
    when 'unsubscribes' then array['sender_address']
    when 'organizations' then array['domain']
    when 'priority_rules' then array['target']
    when 'accounts' then array['address', 'send_addresses']
    when 'address_book_cards' then array['emails', 'phones']
    when 'outbox' then array['to_addresses', 'from_address']
  end;
  v_row jsonb;
  v_set text;
  v_match text;
  v_count integer := 0;
  v_done integer;
begin
  if v_columns is null then
    raise exception 'no addresses in %', p_table;
  end if;
  perform set_config('messages.keep_address_index', 'on', true);
  for v_row in select * from jsonb_array_elements(p_rows) loop
    select string_agg(format('%I = (jsonb_populate_record(null::public.%I, $1->''set'')).%I', k, p_table, k), ', '),
           string_agg(format('to_jsonb(t.%I) = $1->''expect''->%L', k, k), ' and ')
    into v_set, v_match
    from jsonb_object_keys(v_row->'set') as k
    where k = any (v_columns);
    if v_set is null then
      continue;
    end if;
    execute format('update public.%I t set %s where t.id = ($1->>''id'')::uuid and %s', p_table, v_set, v_match) using v_row;
    get diagnostics v_done = row_count;
    v_count := v_count + v_done;
  end loop;
  perform set_config('messages.keep_address_index', 'off', true);
  return v_count;
end;
$$;

revoke execute on function public.encrypt_addresses_write(text, jsonb) from public, anon, authenticated;
grant execute on function public.encrypt_addresses_write(text, jsonb) to service_role;
