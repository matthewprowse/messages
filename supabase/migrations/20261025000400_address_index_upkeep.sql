-- Encryption, stage 2, step 2: keeping the blind indexes filled while the readable values are still the
-- ones written and matched on. The sync worker's indexer finds rows with no index, works the index out
-- (only it holds the keys) and writes it back through set_address_indexes. A change to a value clears its
-- index unless the same write sets a new one, so the indexer picks it up again: whatsapp_map_lid moving a
-- chat from its lid to its number, a new send-from address, or any writer that does not know about
-- indexes yet.

create or replace function public.clear_stale_address_index()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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
  end case;
  return new;
end;
$$;

create trigger contact_identities_stale_index before update of value on public.contact_identities for each row execute function public.clear_stale_address_index();
create trigger messages_stale_index before update of sender_address, to_addresses on public.messages for each row execute function public.clear_stale_address_index();
create trigger threads_stale_index before update of provider_thread_id on public.threads for each row execute function public.clear_stale_address_index();
create trigger unsubscribes_stale_index before update of sender_address on public.unsubscribes for each row execute function public.clear_stale_address_index();
create trigger organizations_stale_index before update of domain on public.organizations for each row execute function public.clear_stale_address_index();
create trigger priority_rules_stale_index before update of target on public.priority_rules for each row execute function public.clear_stale_address_index();
create trigger accounts_stale_index before update of address, send_addresses on public.accounts for each row execute function public.clear_stale_address_index();

-- Writes the indexes the worker worked out, for one table at a time. Each row carries the readable value
-- the index was taken of, and is only written if the row still holds it, so a value changed in the
-- meantime is left for the next pass. Returns how many rows were written.
create or replace function public.set_address_indexes(p_table text, p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  case p_table
    when 'contact_identities' then
      update public.contact_identities t set value_index = r.idx
      from jsonb_to_recordset(p_rows) as r (id uuid, value text, idx text)
      where t.id = r.id and t.value = r.value;
    when 'messages' then
      update public.messages t set sender_index = r.idx, to_indexes = r.to_idx
      from jsonb_to_recordset(p_rows) as r (id uuid, value text, to_value text[], idx text, to_idx text[])
      where t.id = r.id and t.sender_address is not distinct from r.value and t.to_addresses is not distinct from r.to_value;
    when 'threads' then
      update public.threads t set provider_thread_index = r.idx
      from jsonb_to_recordset(p_rows) as r (id uuid, value text, idx text)
      where t.id = r.id and t.provider_thread_id = r.value;
    when 'unsubscribes' then
      update public.unsubscribes t set sender_index = r.idx
      from jsonb_to_recordset(p_rows) as r (id uuid, value text, idx text)
      where t.id = r.id and t.sender_address = r.value;
    when 'organizations' then
      update public.organizations t set domain_index = r.idx
      from jsonb_to_recordset(p_rows) as r (id uuid, value text, idx text)
      where t.id = r.id and t.domain = r.value;
    when 'priority_rules' then
      update public.priority_rules t set target_index = r.idx
      from jsonb_to_recordset(p_rows) as r (id uuid, value text, idx text)
      where t.id = r.id and t.target = r.value;
    when 'accounts' then
      update public.accounts t set address_index = r.idx, send_address_indexes = r.to_idx
      from jsonb_to_recordset(p_rows) as r (id uuid, value text, to_value text[], idx text, to_idx text[])
      where t.id = r.id and t.address = r.value and t.send_addresses is not distinct from r.to_value;
    else
      raise exception 'no address index for %', p_table;
  end case;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.set_address_indexes(text, jsonb) from public, anon, authenticated;
grant execute on function public.set_address_indexes(text, jsonb) to service_role;
revoke execute on function public.clear_stale_address_index() from public, anon, authenticated;
