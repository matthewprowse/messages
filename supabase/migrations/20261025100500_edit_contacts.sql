-- Editing a contact: their name, company, role and relationship, and adding or removing their email
-- addresses and phone numbers. Addresses arrive as create_contact takes them since encryption stage 2:
-- the value (encrypted once addresses are) and its blind index, worked out by the browser.
--
-- A name you set yourself is kept: name_locked stops the address book import replacing it later.
-- WhatsApp only ever replaces a placeholder name (a number, or the person's own WhatsApp name), so it
-- needs no change.

alter table public.contacts add column name_locked boolean not null default false;

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

do $$
begin
  execute pg_temp.patched(pg_get_functiondef('public.import_address_book_cards'::regproc),
    'update public.contacts set display_name = v_name where id = v_contact and display_name is distinct from v_name;',
    'update public.contacts set display_name = v_name where id = v_contact and display_name is distinct from v_name and not name_locked;');
end;
$$;

create function public.update_contact(
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
  v_name text := btrim(coalesce(p_name, ''));
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_role text := nullif(btrim(coalesce(p_role, '')), '');
  v_relationship text := nullif(btrim(coalesce(p_relationship, '')), '');
  v_current text;
  v_ids jsonb;
  v_bad text;
  v_taken record;
begin
  if v_user is null then
    raise exception 'Sign in to edit contacts.' using errcode = '42501';
  end if;
  select c.display_name into v_current from public.contacts c where c.id = p_contact and c.user_id = v_user;
  if not found then
    raise exception 'This contact is not yours or no longer exists.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Add a name.' using errcode = '22023';
  end if;
  if length(v_name) > 120 or length(coalesce(v_company, '')) > 120 or length(coalesce(v_role, '')) > 120 or length(coalesce(v_relationship, '')) > 60 then
    raise exception 'Keep the name, company and role to 120 characters or fewer, and the relationship to 60.' using errcode = '22023';
  end if;

  -- New addresses and numbers: one row each, repeats removed, checked as create_contact checks them.
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
  -- Already someone else's (a number held as their WhatsApp counts): the app offers to open them.
  select c.id, c.display_name into v_taken
  from public.contact_identities ci
  join public.contacts c on c.id = ci.contact_id
  join jsonb_to_recordset(v_ids) as n (kind text, index text) on n.index = ci.value_index
    and (ci.kind = n.kind or (n.kind = 'phone' and ci.kind = 'whatsapp'))
  where ci.user_id = v_user and ci.contact_id <> p_contact
  order by ci.created_at
  limit 1;
  if v_taken.id is not null then
    raise exception 'One of these already belongs to %.', v_taken.display_name
      using errcode = '23505', detail = v_taken.id::text;
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
    company = v_company,
    role = v_role,
    relationship = v_relationship,
    name_locked = name_locked or v_name is distinct from v_current,
    updated_at = now()
  where id = p_contact;
end;
$$;

revoke execute on function public.update_contact(uuid, text, text, text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.update_contact(uuid, text, text, text, text, jsonb, uuid[]) to authenticated;
