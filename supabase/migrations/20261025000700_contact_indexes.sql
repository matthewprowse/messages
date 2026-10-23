-- Encryption, stage 2, step 5: adding, importing, merging and splitting contacts match on blind indexes.
-- The callers (the browser for create_contact and split_contact, the sync worker for the rest) work out
-- each address's index and company, and check addresses are well formed, before calling: once addresses
-- are encrypted the database cannot. Values that are still readable are checked here as before.

-- Address book cards keep the indexes of their emails and numbers, so a merged contact's cards can be
-- found without reading them.
alter table public.address_book_cards add column email_indexes text[], add column phone_indexes text[];
create index address_book_cards_email_indexes_idx on public.address_book_cards using gin (email_indexes);
create index address_book_cards_phone_indexes_idx on public.address_book_cards using gin (phone_indexes);

-- ---------------------------------------------------------------------------
-- create_contact: p_identities [{kind: 'email' | 'phone', value, index}], from the browser, which has
-- lowercased addresses, put numbers in E.164, removed repeats and checked them. p_organization is the
-- company for the first address ({index, domain, name}, see organization_for_index), or null.
-- ---------------------------------------------------------------------------
drop function public.create_contact(text, text[], text[], text);
create function public.create_contact(p_name text, p_identities jsonb, p_company text, p_organization jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_ids jsonb;
  v_bad text;
  v_taken record;
  v_new uuid;
begin
  if v_user is null then
    raise exception 'Sign in to add contacts.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Add a name.' using errcode = '22023';
  end if;
  if length(v_name) > 120 or length(coalesce(v_company, '')) > 120 then
    raise exception 'Keep the name and company to 120 characters or fewer.' using errcode = '22023';
  end if;

  -- One row per address or number, repeats removed.
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'value', value, 'index', idx)), '[]'::jsonb) into v_ids
  from (
    select distinct on (i.kind, i.idx) i.kind, i.value, i.idx
    from jsonb_to_recordset(coalesce(p_identities, '[]'::jsonb)) as i (kind text, value text, idx text)
    where i.kind in ('email', 'phone') and nullif(i.value, '') is not null and nullif(i.idx, '') is not null
  ) s;

  if (select count(*) from jsonb_to_recordset(v_ids) as i (kind text) where kind = 'email') > 20
     or (select count(*) from jsonb_to_recordset(v_ids) as i (kind text) where kind = 'phone') > 20 then
    raise exception 'Add 20 addresses and 20 numbers or fewer.' using errcode = '22023';
  end if;
  -- Readable values are checked here too; encrypted ones were checked by the browser.
  select value into v_bad from jsonb_to_recordset(v_ids) as i (kind text, value text)
  where value not like 'e1:%'
    and ((kind = 'email' and value !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') or (kind = 'phone' and value !~ '^\+[1-9][0-9]{6,14}$'))
  limit 1;
  if v_bad is not null then
    raise exception 'Check %.', v_bad using errcode = '22023';
  end if;

  -- A number held as someone's WhatsApp is theirs too, so it counts as taken. The contact's id goes in
  -- the detail, so the app can open them.
  select c.id, c.display_name into v_taken
  from public.contact_identities ci
  join public.contacts c on c.id = ci.contact_id
  join jsonb_to_recordset(v_ids) as n (kind text, index text) on n.index = ci.value_index
    and (ci.kind = n.kind or (n.kind = 'phone' and ci.kind = 'whatsapp'))
  where ci.user_id = v_user
  order by ci.created_at
  limit 1;
  if v_taken.id is not null then
    raise exception 'One of these already belongs to %.', v_taken.display_name
      using errcode = '23505', detail = v_taken.id::text;
  end if;

  insert into public.contacts (user_id, display_name, company, organization_id)
  values (v_user, v_name, v_company, public.organization_for_index(v_user, p_organization))
  returning id into v_new;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  select v_user, v_new, i.kind, i.value, i.index, 'manual' from jsonb_to_recordset(v_ids) as i (kind text, value text, index text);

  return v_new;
end;
$$;

revoke execute on function public.create_contact(text, jsonb, text, jsonb) from public, anon;
grant execute on function public.create_contact(text, jsonb, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- import_address_book_cards: each card carries identities [{kind, value, index}] (lowercase emails and
-- E.164 numbers, checked by the worker), the company for its first email, and the name to use when the
-- card has none. Cards in the old shape (emails[], phones[]) are still read.
-- ---------------------------------------------------------------------------
create or replace function public.import_address_book_cards(p_user uuid, p_cards jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_card jsonb;
  v_contact uuid;
  v_name text;
  v_ids jsonb;
  v_created integer := 0;
  v_named integer := 0;
begin
  for v_card in select * from jsonb_array_elements(coalesce(p_cards, '[]'::jsonb)) loop
    v_name := nullif(btrim(coalesce(v_card->>'name', '')), '');
    if jsonb_typeof(v_card->'identities') = 'array' then
      v_ids := v_card->'identities';
    else
      v_ids := coalesce((
        select jsonb_agg(jsonb_build_object('kind', 'email', 'value', lower(btrim(e)))) from jsonb_array_elements_text(coalesce(v_card->'emails', '[]'::jsonb)) as e where e like '%@%'
      ), '[]'::jsonb) || coalesce((
        select jsonb_agg(jsonb_build_object('kind', 'phone', 'value', p)) from jsonb_array_elements_text(coalesce(v_card->'phones', '[]'::jsonb)) as p where p ~ '^\+[1-9][0-9]{6,14}$'
      ), '[]'::jsonb);
    end if;
    if jsonb_array_length(v_ids) = 0 then
      continue;
    end if;

    v_contact := nullif(v_card->>'contact_id', '')::uuid;
    if v_contact is not null and not exists (select 1 from public.contacts c where c.id = v_contact and c.user_id = p_user) then
      continue;
    end if;

    if v_contact is null then
      -- Someone may have arrived with one of these since the worker looked: use them, never a duplicate.
      select ci.contact_id into v_contact
      from public.contact_identities ci
      join jsonb_to_recordset(v_ids) as i (kind text, value text, index text)
        on case when i.index is not null then ci.value_index = i.index else ci.value = i.value end
        and (ci.kind = i.kind or (i.kind = 'phone' and ci.kind = 'whatsapp'))
      where ci.user_id = p_user
      limit 1;
    end if;

    if v_contact is null then
      insert into public.contacts (user_id, display_name, organization_id)
      values (p_user, coalesce(v_name, nullif(v_card->>'fallback_name', ''), v_ids->0->>'value'), public.organization_for_index(p_user, v_card->'company'))
      returning id into v_contact;
      v_created := v_created + 1;
    elsif v_name is not null then
      update public.contacts set display_name = v_name where id = v_contact and display_name is distinct from v_name;
      if found then
        v_named := v_named + 1;
      end if;
    end if;

    insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
    select p_user, v_contact, i.kind, i.value, i.index, 'address_book'
    from jsonb_to_recordset(v_ids) as i (kind text, value text, index text)
    on conflict do nothing;
  end loop;
  return jsonb_build_object('created', v_created, 'named', v_named);
end;
$$;

revoke execute on function public.import_address_book_cards(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_address_book_cards(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- merge_contacts and split_contact are long; only the parts that read addresses change, so they are
-- patched in place from their current definitions (20261023200000_contact_merging.sql and its fixes).
-- ---------------------------------------------------------------------------
create function pg_temp.patched(p_def text, p_old text, p_new text)
returns text
language plpgsql
as $$
begin
  if position(p_old in p_def) = 0 then
    raise exception 'patch target not found: %', left(p_old, 80);
  end if;
  return replace(p_def, p_old, p_new);
end;
$$;

-- merge_contacts: the automatic-merge safety net finds your own addresses and numbers by index.
do $$
declare
  v_def text := pg_get_functiondef('public.merge_contacts'::regproc);
begin
  v_def := pg_temp.patched(v_def,
'        and ci.value in (
          select lower(s.addr)
          from public.accounts a
          cross join lateral unnest(array_append(a.send_addresses, a.address)) as s (addr)
          where a.user_id = v_user
        )',
'        and (ci.value_index in (
          select s.idx
          from public.accounts a
          cross join lateral unnest(array_append(coalesce(a.send_address_indexes, ''{}''), a.address_index)) as s (idx)
          where a.user_id = v_user and s.idx is not null
        ) or ci.value in (
          select lower(s.addr)
          from public.accounts a
          cross join lateral unnest(array_append(a.send_addresses, a.address)) as s (addr)
          where a.user_id = v_user
        ))');
  execute v_def;
end;
$$;

-- split_contact: takes the new contact's company (p_organization) and the indexes of the one-to-one
-- chats under the moved numbers (p_chat_indexes) from the browser, and moves messages by sender_index and
-- to_indexes. Called without them, it works out the company and chats from readable values as before.
do $$
declare
  v_def text := pg_get_functiondef('public.split_contact'::regproc);
begin
  v_def := pg_temp.patched(v_def,
    'p_name text, p_user uuid DEFAULT NULL::uuid)',
    'p_name text, p_user uuid DEFAULT NULL::uuid, p_organization jsonb DEFAULT NULL::jsonb, p_chat_indexes text[] DEFAULT NULL::text[])');
  v_def := pg_temp.patched(v_def, '  v_values text[];', '  v_values text[];
  v_indexes text[];
  v_email_indexes text[];
  v_left_email_indexes text[];');
  v_def := pg_temp.patched(v_def,
'  select coalesce(array_agg(ci.value) filter (where ci.kind = ''email''), ''{}'')
  into v_left_emails',
'  select array_agg(ci.value_index), coalesce(array_agg(ci.value_index) filter (where ci.kind = ''email''), ''{}'')
  into v_indexes, v_email_indexes
  from public.contact_identities ci
  where ci.contact_id = p_contact and ci.id = any (p_identity_ids);

  select coalesce(array_agg(ci.value_index) filter (where ci.kind = ''email''), ''{}'')
  into v_left_email_indexes
  from public.contact_identities ci
  where ci.contact_id = p_contact and not (ci.id = any (p_identity_ids));

  select coalesce(array_agg(ci.value) filter (where ci.kind = ''email''), ''{}'')
  into v_left_emails');
  v_def := pg_temp.patched(v_def,
    'case when v_first_email is not null then public.organization_for_address(v_user, v_first_email) end',
    'coalesce(public.organization_for_index(v_user, p_organization), case when p_organization is null and v_first_email is not null then public.organization_for_address(v_user, v_first_email) end)');
  v_def := pg_temp.patched(v_def,
    'where m.sender_contact_id = p_contact and lower(m.sender_address) = any (v_values);',
    'where m.sender_contact_id = p_contact and (m.sender_index = any (v_indexes) or lower(m.sender_address) = any (v_values));');
  v_def := pg_temp.patched(v_def,
    'select t.id, t.channel, t.is_group, t.provider_thread_id',
    'select t.id, t.channel, t.is_group, t.provider_thread_id, t.provider_thread_index');
  v_def := pg_temp.patched(v_def,
    'v_moved_in := v_chat = any (v_values)',
    'v_moved_in := (p_chat_indexes is not null and v_t.provider_thread_index = any (p_chat_indexes))
        or (p_chat_indexes is null and v_chat = any (v_values))');
  v_def := pg_temp.patched(v_def,
    'or exists (select 1 from unnest(m.to_addresses) a where lower(a) = any (v_emails)))',
    'or exists (select 1 from unnest(m.to_indexes) a where a = any (v_email_indexes))
            or exists (select 1 from unnest(m.to_addresses) a where lower(a) = any (v_emails)))');
  v_def := pg_temp.patched(v_def,
    'or exists (select 1 from unnest(m.to_addresses) a where lower(a) = any (v_left_emails)))',
    'or exists (select 1 from unnest(m.to_indexes) a where a = any (v_left_email_indexes))
            or exists (select 1 from unnest(m.to_addresses) a where lower(a) = any (v_left_emails)))');
  drop function public.split_contact(uuid, uuid[], text, uuid);
  execute v_def;
end;
$$;

revoke execute on function public.split_contact(uuid, uuid[], text, uuid, jsonb, text[]) from public, anon;
grant execute on function public.split_contact(uuid, uuid[], text, uuid, jsonb, text[]) to authenticated, service_role;
