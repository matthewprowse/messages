-- The channel contact functions decide which name wins by display_name_rank instead of reading the names, which are
-- now sealed (20261125100000_sealed_names_columns.sql). Each takes the rank of the name it is given as name_rank in
-- the person's JSON. A payload without one comes from a worker that has not restarted yet: its readable name is
-- ranked here with the rules each function used before, so old and new workers can run side by side.
--
-- A stored name is replaced only by a better kind of name, which is what the text comparisons did: a number or a
-- privacy ID gives way to a WhatsApp profile name, and both to a saved name; "LinkedIn Member" or a URN to a member's
-- name; "Instagram Contact" or a handle to a full name; an address or number to a Google Chat display name.
-- Otherwise each is exactly its latest definition:
--   whatsapp_contact     20261025000600_whatsapp_indexes.sql, patched by 20261025000900_encrypted_address_safety.sql
--   google_chat_contact  20261030150000_google_chat.sql
--   linkedin_contact     20261030160000_linkedin.sql
--   instagram_contact    20261030170000_instagram.sql
--   teams_contact        20261030130000_teams.sql
--   zoom_chat_contact    20261030140000_zoom_chat.sql

create or replace function public.whatsapp_contact(p_user uuid, p_person jsonb, p_create boolean default true)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_phone text := nullif(p_person->>'phone', '');
  v_lid text := nullif(p_person->>'lid', '');
  v_phone_index text := nullif(p_person->>'phone_index', '');
  v_lid_index text := nullif(p_person->>'lid_index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_push text := nullif(btrim(coalesce(p_person->>'push_name', '')), '');
  v_rank smallint := (p_person->>'name_rank')::smallint;
  v_contact uuid;
  v_new uuid;
  v_current smallint;
begin
  if v_phone is null and v_lid is null then
    return null;
  end if;
  if v_rank is null and v_name is not null then
    -- An older worker sends its best name readable, falling back to the profile name and then the number.
    v_rank := case when v_name ~ '^(\+?[0-9]*|[0-9]+@lid)$' then 0 when v_name = v_push then 1 else 2 end;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user
    and ((v_phone is not null and ci.kind in ('whatsapp', 'phone')
          and case when v_phone_index is not null then ci.value_index = v_phone_index else ci.value = v_phone end)
      or (v_lid is not null and ci.kind = 'whatsapp'
          and case when v_lid_index is not null then ci.value_index = v_lid_index else ci.value = v_lid end))
  order by (ci.kind = 'whatsapp') desc, ci.created_at
  limit 1;

  if v_contact is null then
    if not p_create then
      return null;
    end if;
    -- A new contact with no name is never named by an encrypted number or privacy ID.
    insert into public.contacts (user_id, display_name, display_name_rank)
    values (p_user, coalesce(v_name, v_push,
      case when v_phone not like 'e1:%' then v_phone end, case when v_lid not like 'e1:%' then v_lid end, 'WhatsApp Contact'),
      case when v_name is not null then v_rank when v_push is not null then 1 else 0 end)
    returning id into v_new;
    v_contact := v_new;
  else
    select c.display_name_rank into v_current from public.contacts c where c.id = v_contact;
    if v_name is not null and v_rank > v_current then
      update public.contacts set display_name = v_name, display_name_rank = v_rank where id = v_contact;
    end if;
  end if;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  select p_user, v_contact, i.kind, i.value, i.value_index, 'whatsapp'
  from (values ('phone', v_phone, v_phone_index), ('whatsapp', v_phone, v_phone_index), ('whatsapp', v_lid, v_lid_index))
    as i (kind, value, value_index)
  where i.value is not null
  on conflict do nothing;

  if v_new is not null then
    -- Created at the same moment elsewhere: keep theirs.
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'whatsapp'
      and case when coalesce(v_phone_index, v_lid_index) is not null
        then ci.value_index = case when v_phone is not null then v_phone_index else v_lid_index end
        else ci.value = coalesce(v_phone, v_lid) end;
    if v_contact is distinct from v_new then
      delete from public.contacts where id = v_new;
    end if;
  end if;
  return v_contact;
end;
$$;

revoke execute on function public.whatsapp_contact(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_contact(uuid, jsonb, boolean) to service_role;

create or replace function public.google_chat_contact(p_user uuid, p_account_id uuid, p_person jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_address text := nullif(p_person->>'address', '');
  v_index text := nullif(p_person->>'index', '');
  v_user_index text := nullif(p_person->>'user_index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_rank smallint := (p_person->>'name_rank')::smallint;
  v_contact uuid;
  v_new uuid;
  v_current smallint;
begin
  if v_address is null and v_user_index is null then
    return null;
  end if;
  if v_rank is null and v_name is not null then
    v_rank := case when public.contact_name_is_placeholder(v_name) then 0 else 2 end;
  end if;

  if v_address is not null then
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'email'
      and case when v_index is not null then ci.value_index = v_index else ci.value = v_address end;
  end if;

  if v_contact is null and v_user_index is not null then
    select m.sender_contact_id into v_contact
    from public.messages m
    where m.account_id = p_account_id and m.sender_index = v_user_index and m.sender_contact_id is not null
    order by m.sent_at desc
    limit 1;
  end if;

  if v_contact is null then
    insert into public.contacts (user_id, display_name, display_name_rank)
    values (p_user, coalesce(v_name, ''), coalesce(v_rank, 0))
    returning id into v_new;
    v_contact := v_new;
  else
    select c.display_name_rank into v_current from public.contacts c where c.id = v_contact;
    if v_name is not null and v_rank > v_current then
      update public.contacts set display_name = v_name, display_name_rank = v_rank where id = v_contact;
    end if;
  end if;

  if v_address is not null then
    insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
    values (p_user, v_contact, 'email', v_address, v_index, 'header')
    on conflict do nothing;

    if v_new is not null then
      -- Created at the same moment elsewhere: keep theirs.
      select ci.contact_id into v_contact
      from public.contact_identities ci
      where ci.user_id = p_user and ci.kind = 'email'
        and case when v_index is not null then ci.value_index = v_index else ci.value = v_address end;
      if v_contact is distinct from v_new then
        delete from public.contacts where id = v_new;
      end if;
    end if;
  end if;
  return v_contact;
end;
$$;

revoke execute on function public.google_chat_contact(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.google_chat_contact(uuid, uuid, jsonb) to service_role;

create or replace function public.linkedin_contact(p_user uuid, p_person jsonb, p_create boolean default true)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_urn text := nullif(p_person->>'urn', '');
  v_index text := nullif(p_person->>'urn_index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_rank smallint := (p_person->>'name_rank')::smallint;
  v_contact uuid;
  v_new uuid;
  v_current smallint;
begin
  if v_urn is null then
    return null;
  end if;
  if v_rank is null and v_name is not null then
    v_rank := case when v_name = 'LinkedIn Member' or v_name like 'urn:li:%' then 0 else 2 end;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user and ci.kind = 'linkedin'
    and case when v_index is not null then ci.value_index = v_index else ci.value = v_urn end
  order by ci.created_at
  limit 1;

  if v_contact is null then
    if not p_create then
      return null;
    end if;
    insert into public.contacts (user_id, display_name, display_name_rank)
    values (p_user, coalesce(v_name, 'LinkedIn Member'), coalesce(v_rank, 0))
    returning id into v_new;
    v_contact := v_new;
  else
    select c.display_name_rank into v_current from public.contacts c where c.id = v_contact;
    if v_name is not null and v_rank > v_current then
      update public.contacts set display_name = v_name, display_name_rank = v_rank where id = v_contact;
    end if;
  end if;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  values (p_user, v_contact, 'linkedin', v_urn, v_index, 'linkedin')
  on conflict do nothing;

  if v_new is not null then
    -- Created at the same moment elsewhere: keep theirs.
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'linkedin'
      and case when v_index is not null then ci.value_index = v_index else ci.value = v_urn end;
    if v_contact is distinct from v_new then
      delete from public.contacts where id = v_new;
    end if;
  end if;
  return v_contact;
end;
$$;

revoke execute on function public.linkedin_contact(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.linkedin_contact(uuid, jsonb, boolean) to service_role;

-- display_name is the person's full name and handle their username (both sealed), so the rank of each is known here.
create or replace function public.instagram_contact(p_user uuid, p_person jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_pk text := nullif(p_person->>'pk', '');
  v_pk_index text := nullif(p_person->>'pk_index', '');
  v_username text := nullif(p_person->>'username', '');
  v_username_index text := nullif(p_person->>'username_index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_handle text := nullif(btrim(coalesce(p_person->>'handle', '')), '');
  v_contact uuid;
  v_new uuid;
  v_current smallint;
begin
  if v_pk is null then
    return null;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user and ci.kind = 'instagram'
    and case when v_pk_index is not null then ci.value_index = v_pk_index else ci.value = v_pk end
  order by ci.created_at
  limit 1;

  if v_contact is null then
    insert into public.contacts (user_id, display_name, display_name_rank)
    values (p_user, coalesce(v_name, v_handle, 'Instagram Contact'),
            case when v_name is not null then 2 when v_handle is not null then 1 else 0 end)
    returning id into v_new;
    v_contact := v_new;
  else
    select c.display_name_rank into v_current from public.contacts c where c.id = v_contact;
    if v_name is not null and v_current < 2 then
      update public.contacts set display_name = v_name, display_name_rank = 2 where id = v_contact;
    end if;
  end if;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  select p_user, v_contact, i.kind, i.value, i.value_index, 'instagram'
  from (values ('instagram', v_pk, v_pk_index), ('instagram_username', v_username, v_username_index))
    as i (kind, value, value_index)
  where i.value is not null
  on conflict do nothing;

  if v_new is not null then
    -- Created at the same moment elsewhere: keep theirs.
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'instagram'
      and case when v_pk_index is not null then ci.value_index = v_pk_index else ci.value = v_pk end;
    if v_contact is distinct from v_new then
      delete from public.contacts where id = v_new;
    end if;
  end if;
  return v_contact;
end;
$$;

revoke execute on function public.instagram_contact(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.instagram_contact(uuid, jsonb) to service_role;

create or replace function public.teams_contact(p_user uuid, p_person jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_address text := nullif(p_person->>'address', '');
  v_index text := nullif(p_person->>'index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_rank smallint := (p_person->>'name_rank')::smallint;
  v_contact uuid;
  v_new uuid;
begin
  if v_address is null or v_index is null then
    return null;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user and ci.kind = 'email' and ci.value_index = v_index
  limit 1;
  if v_contact is not null then
    return v_contact;
  end if;

  insert into public.contacts (user_id, display_name, display_name_rank, organization_id)
  values (p_user, coalesce(v_name, v_address),
          case when v_name is null then 0 else coalesce(v_rank, case when public.contact_name_is_placeholder(v_name) then 0 else 2 end) end,
          public.organization_for_index(p_user, p_person->'company'))
  returning id into v_new;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  values (p_user, v_new, 'email', v_address, v_index, 'header')
  on conflict do nothing
  returning contact_id into v_contact;

  if v_contact is null then
    -- Created at the same moment elsewhere: keep theirs.
    delete from public.contacts where id = v_new;
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'email' and ci.value_index = v_index
    limit 1;
  end if;
  return v_contact;
end;
$$;

revoke execute on function public.teams_contact(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.teams_contact(uuid, jsonb) to service_role;

create or replace function public.zoom_chat_contact(p_user uuid, p_person jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_address text := nullif(p_person->>'address', '');
  v_index text := nullif(p_person->>'index', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_rank smallint := (p_person->>'name_rank')::smallint;
  v_contact uuid;
  v_new uuid;
begin
  if v_address is null then
    return null;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user and ci.kind = 'email'
    and case when v_index is not null then ci.value_index = v_index else ci.value = v_address end;
  if v_contact is not null then
    return v_contact;
  end if;

  -- A new contact is never named by an encrypted address.
  insert into public.contacts (user_id, display_name, display_name_rank)
  values (p_user, coalesce(v_name, case when v_address not like 'e1:%' then v_address end, 'Zoom Contact'),
          case when v_name is null then 0 else coalesce(v_rank, case when public.contact_name_is_placeholder(v_name) then 0 else 2 end) end)
  returning id into v_new;

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  values (p_user, v_new, 'email', v_address, v_index, 'header')
  on conflict do nothing
  returning contact_id into v_contact;

  if v_contact is null then
    -- Created at the same moment elsewhere: keep theirs.
    delete from public.contacts where id = v_new;
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'email'
      and case when v_index is not null then ci.value_index = v_index else ci.value = v_address end;
  end if;
  return v_contact;
end;
$$;

revoke execute on function public.zoom_chat_contact(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.zoom_chat_contact(uuid, jsonb) to service_role;
