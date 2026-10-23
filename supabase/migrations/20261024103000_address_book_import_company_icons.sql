-- Every address book contact in Contacts, and company icons.

-- ---------------------------------------------------------------------------
-- 1. Company icons
-- ---------------------------------------------------------------------------

-- The company's own website icon, saved by the worker in the private "avatars" bucket at
-- <user id>/org-<organization id>. avatar_updated_at records the last look, found or not.
alter table public.organizations add column avatar_path text;
alter table public.organizations add column avatar_updated_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Address book import
-- ---------------------------------------------------------------------------

-- Brings address book cards into Contacts in one call. p_cards: [{contact_id, name, emails[], phones[]}]
-- where contact_id is the one existing contact the card matches, or null for someone new. The worker
-- leaves out cards that match more than one contact (the contact linker merges those) and cards that
-- are you. A card's saved name wins over names from WhatsApp or email headers. Emails are lowercase and
-- phones E.164; identities another contact already has are left with it.
-- Returns {"created": n, "named": n}.
create or replace function public.import_address_book_cards(p_user uuid, p_cards jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_card jsonb;
  v_contact uuid;
  v_name text;
  v_emails text[];
  v_phones text[];
  v_created integer := 0;
  v_named integer := 0;
begin
  for v_card in select * from jsonb_array_elements(coalesce(p_cards, '[]'::jsonb)) loop
    v_name := nullif(btrim(coalesce(v_card->>'name', '')), '');
    v_emails := array(select lower(btrim(e)) from jsonb_array_elements_text(coalesce(v_card->'emails', '[]'::jsonb)) as e where e like '%@%');
    v_phones := array(select p from jsonb_array_elements_text(coalesce(v_card->'phones', '[]'::jsonb)) as p where p ~ '^\+[1-9][0-9]{6,14}$');
    if cardinality(v_emails) + cardinality(v_phones) = 0 then
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
      where ci.user_id = p_user
        and ((ci.kind = 'email' and ci.value = any (v_emails)) or (ci.kind in ('phone', 'whatsapp') and ci.value = any (v_phones)))
      limit 1;
    end if;

    if v_contact is null then
      insert into public.contacts (user_id, display_name)
      values (p_user, coalesce(v_name, v_emails[1], v_phones[1]))
      returning id into v_contact;
      v_created := v_created + 1;
    elsif v_name is not null then
      update public.contacts set display_name = v_name where id = v_contact and display_name is distinct from v_name;
      if found then
        v_named := v_named + 1;
      end if;
    end if;

    insert into public.contact_identities (user_id, contact_id, kind, value, source)
    select p_user, v_contact, 'email', e, 'address_book' from unnest(v_emails) as e
    union all
    select p_user, v_contact, 'phone', p, 'address_book' from unnest(v_phones) as p
    on conflict (user_id, kind, value) do nothing;
  end loop;
  return jsonb_build_object('created', v_created, 'named', v_named);
end;
$$;

revoke execute on function public.import_address_book_cards(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_address_book_cards(uuid, jsonb) to service_role;
