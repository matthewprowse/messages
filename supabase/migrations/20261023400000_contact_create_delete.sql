-- Creating and deleting a contact from the Contacts page.
--
-- create_contact adds the person and their addresses and numbers in one transaction, so a clash on one
-- address never leaves a half made contact behind, and it names the contact that already holds it.
-- delete_contact removes the person and their saved details only: conversations and messages stay.

create or replace function public.create_contact(p_name text, p_emails text[], p_phones text[], p_company text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_emails text[];
  v_phones text[];
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

  -- Stored the way the worker stores them: addresses lowercased, numbers in E.164.
  select coalesce(array_agg(distinct e), '{}') into v_emails
  from (select lower(btrim(x)) e from unnest(coalesce(p_emails, '{}')) x) s where e <> '';
  select coalesce(array_agg(distinct p), '{}') into v_phones
  from (select btrim(x) p from unnest(coalesce(p_phones, '{}')) x) s where p <> '';
  if cardinality(v_emails) > 20 or cardinality(v_phones) > 20 then
    raise exception 'Add 20 addresses and 20 numbers or fewer.' using errcode = '22023';
  end if;
  select e into v_bad from unnest(v_emails) e where e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' limit 1;
  if v_bad is not null then
    raise exception 'Check %.', v_bad using errcode = '22023';
  end if;
  select p into v_bad from unnest(v_phones) p where p !~ '^\+[1-9][0-9]{6,14}$' limit 1;
  if v_bad is not null then
    raise exception 'Check %.', v_bad using errcode = '22023';
  end if;

  -- A number held as someone's WhatsApp is theirs too, so it counts as taken.
  select ci.value, c.id, c.display_name into v_taken
  from public.contact_identities ci
  join public.contacts c on c.id = ci.contact_id
  where ci.user_id = v_user
    and ((ci.kind = 'email' and ci.value = any (v_emails)) or (ci.kind in ('phone', 'whatsapp') and ci.value = any (v_phones)))
  order by ci.created_at
  limit 1;
  if v_taken.id is not null then
    raise exception '% already belongs to %.', v_taken.value, v_taken.display_name
      using errcode = '23505', detail = v_taken.id::text;
  end if;

  insert into public.contacts (user_id, display_name, company, organization_id)
  values (v_user, v_name, v_company, case when cardinality(v_emails) > 0 then public.organization_for_address(v_user, v_emails[1]) end)
  returning id into v_new;

  insert into public.contact_identities (user_id, contact_id, kind, value, source)
  select v_user, v_new, 'email', e, 'manual' from unnest(v_emails) e
  union all
  select v_user, v_new, 'phone', p, 'manual' from unnest(v_phones) p;

  return v_new;
end;
$$;

create or replace function public.delete_contact(p_contact uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to delete contacts.' using errcode = '42501';
  end if;
  perform 1 from public.contacts c where c.id = p_contact and c.user_id = v_user for update;
  if not found then
    raise exception 'Contact not found.' using errcode = 'P0002';
  end if;

  -- What merge_contacts moves, let go of here. Messages and conversations stay; their sender shows as
  -- the address or number again.
  delete from public.thread_participants tp where tp.contact_id = p_contact;
  update public.messages m set sender_contact_id = null where m.sender_contact_id = p_contact;
  update public.draft_outcomes o set contact_id = null where o.contact_id = p_contact;
  delete from public.style_rules r where r.contact_id = p_contact;
  delete from public.contact_suggestions s
  where s.user_id = v_user and s.status = 'pending' and (s.contact_a = p_contact or s.contact_b = p_contact);

  -- Takes its addresses and numbers with it, so new mail from them creates a contact again.
  delete from public.contacts c where c.id = p_contact;
end;
$$;

revoke execute on function public.create_contact(text, text[], text[], text) from public, anon, service_role;
revoke execute on function public.delete_contact(uuid) from public, anon, service_role;
grant execute on function public.create_contact(text, text[], text[], text) to authenticated;
grant execute on function public.delete_contact(uuid) to authenticated;
