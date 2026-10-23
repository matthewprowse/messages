-- Encryption, stage 2, step 7: the one-off backfill that encrypts the addresses stored so far
-- (apps/worker/scripts/encrypt-addresses.ts). Temporary: dropped once it has run.
--
-- encrypt_addresses_write writes new values for one table, a row only when its columns still hold exactly
-- what the script read, so a row changed mid-run is left for the next run. The value
-- does not change, only how it is stored, so its blind index stays: the function tells
-- clear_stale_address_index to leave indexes alone for its own writes.

create or replace function public.clear_stale_address_index()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The backfill re-stores the same values encrypted: their indexes are still right.
  if current_setting('messages.keep_address_index', true) = 'on' then
    return new;
  end if;
  case tg_table_name
    when 'contact_identities' then
      if new.value is distinct from old.value and new.value_index is not distinct from old.value_index then new.value_index := null; end if;
    when 'messages' then
      if new.sender_address is distinct from old.sender_address and new.sender_index is not distinct from old.sender_index then new.sender_index := null; new.to_indexes := null; end if;
      if new.to_addresses is distinct from old.to_addresses and new.to_indexes is not distinct from old.to_indexes then new.to_indexes := null; end if;
    when 'threads' then
      if new.provider_thread_id is distinct from old.provider_thread_id and new.provider_thread_index is not distinct from old.provider_thread_index then new.provider_thread_index := null; end if;
    when 'unsubscribes' then
      if new.sender_address is distinct from old.sender_address and new.sender_index is not distinct from old.sender_index then new.sender_index := null; end if;
    when 'organizations' then
      if new.domain is distinct from old.domain and new.domain_index is not distinct from old.domain_index then new.domain_index := null; end if;
    when 'priority_rules' then
      if new.target is distinct from old.target and new.target_index is not distinct from old.target_index then new.target_index := null; end if;
    when 'accounts' then
      if new.address is distinct from old.address and new.address_index is not distinct from old.address_index then new.address_index := null; end if;
      if new.send_addresses is distinct from old.send_addresses and new.send_address_indexes is not distinct from old.send_address_indexes then new.send_address_indexes := null; end if;
    when 'address_book_cards' then
      if (new.emails is distinct from old.emails or new.phones is distinct from old.phones)
         and new.email_indexes is not distinct from old.email_indexes then
        new.email_indexes := null; new.phone_indexes := null;
      end if;
  end case;
  return new;
end;
$$;

-- p_rows: [{id, expect {column: value as read}, set {column: new value}}]. Only the address columns of each
-- table can be set. Returns how many rows were written.
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
