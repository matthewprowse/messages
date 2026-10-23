-- A contact named by a bare number or privacy ID is a placeholder, whichever identity the new name came
-- with. Before, the check compared against the number passed in, which is null when WhatsApp names
-- someone only by privacy ID, so such contacts kept showing their number.
-- Same as 20261024090000 otherwise; only the placeholder test in the update branch changed:
--   (coalesce(v_current, '') ~ '^(\+?[0-9]*|[0-9]+@lid)$' or v_current = v_push)
create or replace function public.whatsapp_contact(p_user uuid, p_person jsonb, p_create boolean default true)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_phone text := nullif(p_person->>'phone', '');
  v_lid text := nullif(p_person->>'lid', '');
  v_name text := nullif(btrim(coalesce(p_person->>'display_name', '')), '');
  v_push text := nullif(btrim(coalesce(p_person->>'push_name', '')), '');
  v_contact uuid;
  v_new uuid;
  v_current text;
begin
  if v_phone is null and v_lid is null then
    return null;
  end if;

  select ci.contact_id into v_contact
  from public.contact_identities ci
  where ci.user_id = p_user
    and ((v_phone is not null and ci.kind in ('whatsapp', 'phone') and ci.value = v_phone)
      or (v_lid is not null and ci.kind = 'whatsapp' and ci.value = v_lid))
  order by (ci.kind = 'whatsapp') desc, ci.created_at
  limit 1;

  if v_contact is null then
    if not p_create then
      return null;
    end if;
    insert into public.contacts (user_id, display_name)
    values (p_user, coalesce(v_name, v_push, v_phone, v_lid))
    returning id into v_new;
    v_contact := v_new;
  else
    select c.display_name into v_current from public.contacts c where c.id = v_contact;
    if v_name is not null and v_current is distinct from v_name
       and (coalesce(v_current, '') ~ '^(\+?[0-9]*|[0-9]+@lid)$' or v_current = v_push) then
      update public.contacts set display_name = v_name where id = v_contact;
    end if;
  end if;

  insert into public.contact_identities (user_id, contact_id, kind, value, source)
  select p_user, v_contact, i.kind, i.value, 'whatsapp'
  from (values ('phone', v_phone), ('whatsapp', v_phone), ('whatsapp', v_lid)) as i (kind, value)
  where i.value is not null
  on conflict (user_id, kind, value) do nothing;

  if v_new is not null then
    -- Created at the same moment elsewhere: keep theirs.
    select ci.contact_id into v_contact
    from public.contact_identities ci
    where ci.user_id = p_user and ci.kind = 'whatsapp' and ci.value = coalesce(v_phone, v_lid);
    if v_contact is distinct from v_new then
      delete from public.contacts where id = v_new;
    end if;
  end if;
  return v_contact;
end;
$$;

revoke execute on function public.whatsapp_contact(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_contact(uuid, jsonb, boolean) to service_role;
