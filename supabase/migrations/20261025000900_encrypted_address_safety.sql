-- Encryption, stage 2, step 6: what the database still did to readable addresses leaves encrypted ones
-- alone, before the workers and browser start storing them encrypted (ENCRYPT_ADDRESSES). Lowercasing or
-- trimming a ciphertext would break it, and a ciphertext is never a name. Readable values are treated as
-- before. Only the lines that touch addresses change, so the functions are patched in place.

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

-- Send addresses: encrypted ones are kept as they are (the writer removed repeats).
create or replace function public.normalise_send_addresses()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.send_addresses := array(
    select case when u.a like 'e1:%' then u.a else lower(btrim(u.a)) end
    from unnest(new.send_addresses) with ordinality as u (a, i)
    where btrim(u.a) <> ''
    group by case when u.a like 'e1:%' then u.a else lower(btrim(u.a)) end
    order by min(u.i)
  );
  if tg_op = 'UPDATE' and current_user = 'authenticated' and new.provider <> 'icloud'
     and new.send_addresses is distinct from old.send_addresses then
    raise exception 'send addresses can only be edited on iCloud accounts' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ingest_email: recipients are lowercased only while readable (the worker lowercases them first anyway).
do $$
begin
  execute pg_temp.patched(pg_get_functiondef('public.ingest_email'::regproc),
    'array(select lower(x) from jsonb_array_elements_text(coalesce(p_mail->''to_addresses'', ''[]''::jsonb)) as x)',
    'array(select case when x like ''e1:%'' then x else lower(x) end from jsonb_array_elements_text(coalesce(p_mail->''to_addresses'', ''[]''::jsonb)) as x)');
end;
$$;

-- whatsapp_contact: a new contact with no name is never named by an encrypted number or privacy ID.
do $$
begin
  execute pg_temp.patched(pg_get_functiondef('public.whatsapp_contact'::regproc),
    'values (p_user, coalesce(v_name, v_push, v_phone, v_lid))',
    'values (p_user, coalesce(v_name, v_push,
      case when v_phone not like ''e1:%'' then v_phone end, case when v_lid not like ''e1:%'' then v_lid end, ''WhatsApp Contact''))');
end;
$$;

-- import_address_book_cards: likewise for a card with no name.
do $$
begin
  execute pg_temp.patched(pg_get_functiondef('public.import_address_book_cards'::regproc),
    'coalesce(v_name, nullif(v_card->>''fallback_name'', ''''), v_ids->0->>''value'')',
    'coalesce(v_name, nullif(v_card->>''fallback_name'', ''''), case when v_ids->0->>''value'' not like ''e1:%'' then v_ids->0->>''value'' end, ''Contact'')');
end;
$$;

-- split_contact: likewise when no name is given.
do $$
begin
  execute pg_temp.patched(pg_get_functiondef('public.split_contact'::regproc),
'    select ci.value into v_name
    from public.contact_identities ci
    where ci.id = any (p_identity_ids)',
'    select case when ci.value like ''e1:%'' then ''Contact'' else ci.value end into v_name
    from public.contact_identities ci
    where ci.id = any (p_identity_ids)');
end;
$$;
