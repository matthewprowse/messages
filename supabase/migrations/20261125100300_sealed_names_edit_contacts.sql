-- Adding and editing a contact with a sealed name (20261125100000_sealed_names_columns.sql).
--
-- create_contact: the browser seals the name, so an encrypted name only has to be a sensible size (its length is
-- checked on the plain text in the browser, as update_contact already does). A name you type is a real name (rank 2).
--
-- update_contact: p_name null keeps the stored name. The browser sends null when you did not change it, because a
-- fresh seal of the same name always differs from the stored one, and comparing them would mark every saved contact
-- as renamed by you (name_locked). A changed name is real (rank 2) and locked, as before.
--
-- Both: an address or number that is already someone's no longer names that person in the error (their name is
-- sealed). The message says so plainly and the contact's id stays in the detail, which the browser uses to name them.
-- Otherwise exactly 20261025000700_contact_indexes.sql and 20261102400000_encrypted_fields_and_files.sql.

create or replace function public.create_contact(p_name text, p_identities jsonb, p_company text, p_organization jsonb default null)
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
  v_taken uuid;
  v_new uuid;
begin
  if v_user is null then
    raise exception 'Sign in to add contacts.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Add a name.' using errcode = '22023';
  end if;
  -- (each CASE is in parentheses: plpgsql ends an IF condition at the first THEN it sees)
  if length(v_name) > (case when v_name ~ '^[et]1:' then 1000 else 120 end)
    or length(coalesce(v_company, '')) > (case when v_company ~ '^[et]1:' then 1000 else 120 end) then
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
  -- the detail, so the app can name and open them.
  select c.id into v_taken
  from public.contact_identities ci
  join public.contacts c on c.id = ci.contact_id
  join jsonb_to_recordset(v_ids) as n (kind text, index text) on n.index = ci.value_index
    and (ci.kind = n.kind or (n.kind = 'phone' and ci.kind = 'whatsapp'))
  where ci.user_id = v_user
  order by ci.created_at
  limit 1;
  if v_taken is not null then
    raise exception 'One of these already belongs to another contact.'
      using errcode = '23505', detail = v_taken::text;
  end if;

  insert into public.contacts (user_id, display_name, display_name_rank, company, organization_id)
  values (v_user, v_name, 2, v_company, public.organization_for_index(v_user, p_organization))
  returning id into v_new;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  select v_user, v_new, i.kind, i.value, i.index, 'manual' from jsonb_to_recordset(v_ids) as i (kind text, value text, index text);

  return v_new;
end;
$$;

revoke execute on function public.create_contact(text, jsonb, text, jsonb) from public, anon;
grant execute on function public.create_contact(text, jsonb, text, jsonb) to authenticated;

create or replace function public.update_contact(
  p_contact uuid,
  p_name text,
  p_company text,
  p_role text,
  p_relationship text,
  p_add jsonb default '[]',
  p_remove uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_keep_name boolean := p_name is null;
  v_name text := btrim(coalesce(p_name, ''));
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_role text := nullif(btrim(coalesce(p_role, '')), '');
  v_relationship text := nullif(btrim(coalesce(p_relationship, '')), '');
  v_current text;
  v_ids jsonb;
  v_bad text;
  v_taken uuid;
begin
  if v_user is null then
    raise exception 'Sign in to edit contacts.' using errcode = '42501';
  end if;
  select c.display_name into v_current from public.contacts c where c.id = p_contact and c.user_id = v_user;
  if not found then
    raise exception 'This contact is not yours or no longer exists.' using errcode = '42501';
  end if;
  if v_keep_name then
    v_name := v_current;
  elsif v_name = '' then
    raise exception 'Add a name.' using errcode = '22023';
  end if;
  -- (each CASE is in parentheses: plpgsql ends an IF condition at the first THEN it sees)
  if (not v_keep_name and length(v_name) > (case when v_name ~ '^[et]1:' then 1000 else 120 end))
    or length(coalesce(v_company, '')) > (case when v_company ~ '^[et]1:' then 1000 else 120 end)
    or length(coalesce(v_role, '')) > (case when v_role ~ '^[et]1:' then 1000 else 120 end)
    or length(coalesce(v_relationship, '')) > (case when v_relationship ~ '^[et]1:' then 1000 else 60 end) then
    raise exception 'Keep the name, company and role to 120 characters or fewer, and the relationship to 60.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'value', value, 'index', idx)), '[]'::jsonb) into v_ids
  from (
    select distinct on (i.kind, i.idx) i.kind, i.value, i.idx
    from jsonb_to_recordset(coalesce(p_add, '[]'::jsonb)) as i (kind text, value text, idx text)
    where i.kind in ('email', 'phone') and nullif(i.value, '') is not null and nullif(i.idx, '') is not null
  ) s;
  if jsonb_array_length(v_ids) > 20 then
    raise exception 'Add 20 addresses or numbers at a time or fewer.' using errcode = '22023';
  end if;
  select value into v_bad from jsonb_to_recordset(v_ids) as i (kind text, value text)
  where value not like 'e1:%'
    and ((kind = 'email' and value !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') or (kind = 'phone' and value !~ '^\+[1-9][0-9]{6,14}$'))
  limit 1;
  if v_bad is not null then
    raise exception 'Check %.', v_bad using errcode = '22023';
  end if;
  select c.id into v_taken
  from public.contact_identities ci
  join public.contacts c on c.id = ci.contact_id
  join jsonb_to_recordset(v_ids) as n (kind text, index text) on n.index = ci.value_index
    and (ci.kind = n.kind or (n.kind = 'phone' and ci.kind = 'whatsapp'))
  where ci.user_id = v_user and ci.contact_id <> p_contact
  order by ci.created_at
  limit 1;
  if v_taken is not null then
    raise exception 'One of these already belongs to another contact.'
      using errcode = '23505', detail = v_taken::text;
  end if;

  delete from public.contact_identities
  where contact_id = p_contact and user_id = v_user and id = any(coalesce(p_remove, '{}'));

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  select v_user, p_contact, i.kind, i.value, i.index, 'manual'
  from jsonb_to_recordset(v_ids) as i (kind text, value text, index text)
  where not exists (
    select 1 from public.contact_identities ci
    where ci.contact_id = p_contact and ci.kind = i.kind and ci.value_index = i.index
  );

  update public.contacts set
    display_name = v_name,
    display_name_rank = case when v_keep_name then display_name_rank else 2 end,
    company = v_company,
    role = v_role,
    relationship = v_relationship,
    name_locked = name_locked or (not v_keep_name and v_name is distinct from v_current),
    updated_at = now()
  where id = p_contact;
end;
$$;

revoke execute on function public.update_contact(uuid, text, text, text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.update_contact(uuid, text, text, text, text, jsonb, uuid[]) to authenticated;
