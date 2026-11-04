-- Sealed names (20261125100000_sealed_names_columns.sql), the rest of the database side:
--
--   * ingest_email stores the rank of each new contact's name (name_rank in the participant's JSON).
--   * The six chat ingest functions keep a group's name by its blind index (group_name_index in the message's JSON): the
--     name is written when the chat is new or the index changed, never again because a fresh seal of the same name
--     looks different. A message without an index (an older worker) compares readable names as before.
--   * import_address_book_cards ranks the names it writes. The worker sends a card's name for an existing contact only
--     when it differs from the stored one, which it opens to compare (src/photos/import.ts).
--   * merge_contacts keeps the better kind of name by rank, records the rank for Undo, and keeps "a full name beats one
--     word" only while both names are readable. undo_merge restores the rank, and an old snapshot without the later
--     columns (rank, name_locked, hidden, vip) is restored with their defaults instead of failing on a null.
--   * split_contact ranks the new contact's name: one you typed is real, one taken from an address is a stand-in.
--
-- The long functions are patched in place, as 20261116100000 and 20261121130000 did, so everything else about them
-- (signature, security, search_path, grants) stays; each patch fails loudly if its anchor is missing.

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

-- ingest_email (20261124110000_ingest_email_duplicates.sql).
do $$
begin
  execute pg_temp.patched(pg_get_functiondef('public.ingest_email'::regproc),
'      insert into public.contacts (user_id, display_name, organization_id)
      values (v_user, v_person->>''display_name'', public.organization_for_index(v_user, v_person->''company''))',
'      insert into public.contacts (user_id, display_name, display_name_rank, organization_id)
      values (v_user, v_person->>''display_name'',
              coalesce((v_person->>''name_rank'')::smallint, case when public.contact_name_is_placeholder(v_person->>''display_name'') then 0 else 2 end),
              public.organization_for_index(v_user, v_person->''company''))');
end;
$$;

-- The chat ingest functions: the same two lines in each.
do $$
declare
  v_fn text;
  v_def text;
begin
  foreach v_fn in array array['ingest_whatsapp', 'ingest_linkedin', 'ingest_zoom_chat', 'ingest_google_chat', 'ingest_teams', 'ingest_instagram'] loop
    v_def := pg_get_functiondef(('public.' || v_fn)::regproc);
    v_def := pg_temp.patched(v_def,
      'is_group, group_name, triage_enabled, status)',
      'is_group, group_name, group_name_index, triage_enabled, status)');
    v_def := pg_temp.patched(v_def,
      'v_group, v_group_name, not v_group',
      'v_group, v_group_name, nullif(p_msg->>''group_name_index'', ''''), not v_group');
    v_def := pg_temp.patched(v_def,
      'update public.threads set group_name = v_group_name where id = v_thread and group_name is distinct from v_group_name;',
      'update public.threads set group_name = v_group_name, group_name_index = nullif(p_msg->>''group_name_index'', '''')
    where id = v_thread and case when nullif(p_msg->>''group_name_index'', '''') is not null
      then group_name_index is distinct from p_msg->>''group_name_index''
      else group_name is distinct from v_group_name end;');
    execute v_def;
  end loop;
end;
$$;

-- import_address_book_cards: 20261025000700_contact_indexes.sql as patched by 20261025000900_encrypted_address_safety.sql
-- and 20261025100500_edit_contacts.sql, with the rank of each name it writes.
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
      -- A card with no name is named by its first address or number (sealed as a name by the worker), never by an
      -- encrypted identity.
      insert into public.contacts (user_id, display_name, display_name_rank, organization_id)
      values (p_user,
              coalesce(v_name, nullif(v_card->>'fallback_name', ''), case when v_ids->0->>'value' not like 'e1:%' then v_ids->0->>'value' end, 'Contact'),
              case when v_name is not null then 2 else 0 end,
              public.organization_for_index(p_user, v_card->'company'))
      returning id into v_contact;
      v_created := v_created + 1;
    elsif v_name is not null then
      update public.contacts set display_name = v_name, display_name_rank = 2
      where id = v_contact and display_name is distinct from v_name and not name_locked;
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

-- merge_contacts: the name by rank, and the rank recorded for Undo.
do $$
declare
  v_def text := pg_get_functiondef('public.merge_contacts'::regproc);
begin
  v_def := pg_temp.patched(v_def,
'    ''display_name'', ''company'',',
'    ''display_name'', ''display_name_rank'', ''company'',');
  v_def := pg_temp.patched(v_def,
'  if public.contact_name_is_placeholder(v_keep.display_name) and not public.contact_name_is_placeholder(v_merge.display_name) then
    v_name := v_merge.display_name;
  elsif not public.contact_name_is_placeholder(v_merge.display_name)',
'  if v_merge.display_name_rank > v_keep.display_name_rank then
    v_name := v_merge.display_name;
  elsif v_merge.display_name_rank = v_keep.display_name_rank
    and coalesce(v_keep.display_name, '''') !~ ''^[et]1:'' and coalesce(v_merge.display_name, '''') !~ ''^[et]1:''
    and not public.contact_name_is_placeholder(v_merge.display_name)');
  v_def := pg_temp.patched(v_def,
'    display_name = v_name,
    company = coalesce(c.company, v_merge.company),',
'    display_name = v_name,
    display_name_rank = case when v_name is not distinct from v_keep.display_name then c.display_name_rank else v_merge.display_name_rank end,
    company = coalesce(c.company, v_merge.company),');
  execute v_def;
end;
$$;

-- undo_merge: the rank goes back with the name, and a snapshot taken before a column existed gets its default.
do $$
declare
  v_def text := pg_get_functiondef('public.undo_merge'::regproc);
begin
  v_def := pg_temp.patched(v_def,
'lead_source = r.lead_source
    from jsonb_populate_record',
'lead_source = r.lead_source,
      display_name_rank = r.display_name_rank
    from jsonb_populate_record');
  v_def := pg_temp.patched(v_def,
'  v_snapshot := v_snapshot || jsonb_build_object(''id'', v_restored, ''user_id'', v_user);',
'  v_snapshot := jsonb_build_object(''display_name_rank'', 2, ''name_locked'', false, ''hidden'', false, ''vip'', false)
    || v_snapshot || jsonb_build_object(''id'', v_restored, ''user_id'', v_user);');
  execute v_def;
end;
$$;

-- split_contact: a name you typed is real; without one the contact is named by an address or number.
do $$
declare
  v_def text := pg_get_functiondef('public.split_contact'::regproc);
begin
  v_def := pg_temp.patched(v_def,
'  insert into public.contacts (user_id, display_name, organization_id)
  values (v_user, v_name, ',
'  insert into public.contacts (user_id, display_name, display_name_rank, organization_id)
  values (v_user, v_name, case when nullif(btrim(coalesce(p_name, '''')), '''') is null then 0 else 2 end, ');
  execute v_def;
end;
$$;

-- Same grants as before, restated because the definitions were replaced.
revoke execute on function public.merge_contacts(uuid, uuid, text, boolean, uuid) from public, anon;
grant execute on function public.merge_contacts(uuid, uuid, text, boolean, uuid) to authenticated, service_role;
revoke execute on function public.undo_merge(uuid, uuid) from public, anon;
grant execute on function public.undo_merge(uuid, uuid) to authenticated, service_role;
revoke execute on function public.split_contact(uuid, uuid[], text, uuid, jsonb, text[]) from public, anon;
grant execute on function public.split_contact(uuid, uuid[], text, uuid, jsonb, text[]) to authenticated, service_role;
revoke execute on function public.ingest_email(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_email(uuid, jsonb) to service_role;
