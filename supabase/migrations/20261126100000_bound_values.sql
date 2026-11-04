-- Bound values (security audit H4, packages/crypto/src/bound.ts): a sealed value is now also written as "e2:" (bound to its
-- owner, column and row) beside the legacy "e1:". Everything the database does with sealed values must treat "e2:" exactly
-- as it treats "e1:": keep it as it is instead of lowercasing or trimming it (ingest_email, the send address and calendar
-- guest triggers), never use it as a name (the contact functions), count it as needing a team seal (the share functions),
-- and accept it where only a sealed value is allowed (the calendar checks, the outbox insert policies). Apply before the
-- workers and web app that write "e2:" are released; nothing writes it until SEAL_BOUND_FIELDS is turned on.
--
-- 1. Every public function whose definition tests for "e1:" is patched in place (the way
--    20261025000900_encrypted_address_safety.sql did), so the change is exactly those tests and nothing else:
--      x like 'e1:%'      becomes  x ~ '^e[12]:'
--      x not like 'e1:%'  becomes  x !~ '^e[12]:'
--      '^e1:[A-Za-z0-9+/]+={0,2}$'  becomes  '^e[12]:...'
--    and calendar_text_valid allows for the place a bound value carries (at most 302 more bytes before base64).
--    The functions known to test for it must all change, or the migration stops.
-- 2. The two outbox insert policies that accept a sealed recipient accept "e2:" too.
-- 3. A queued calendar change names its own id, as a calendar event, an outbox row and a task change already can: the app
--    chooses it before sealing, so the values are bound to the row.

create function pg_temp.accept_bound(p_def text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(replace(replace(p_def,
    ' not like ''e1:%''', ' !~ ''^e[12]:'''),
    ' like ''e1:%''', ' ~ ''^e[12]:'''),
    ' not like ''''e1:%''''', ' !~ ''''^e[12]:'''''),
    ' like ''''e1:%''''', ' ~ ''''^e[12]:'''''),
    '''^e1:[A-Za-z0-9+/]+={0,2}$''', '''^e[12]:[A-Za-z0-9+/]+={0,2}$'''),
    '(4 * p_max + 28) / 3.0', '(4 * p_max + 28 + 302) / 3.0')
$$;

-- 1
do $$
declare
  v_required text[] := array[
    'ingest_email', 'normalise_send_addresses', 'whatsapp_contact', 'zoom_chat_contact', 'import_address_book_cards',
    'create_contact', 'update_contact', 'split_contact', 'needs_team_seal_address',
    'calendar_attendees_valid', 'calendar_text_valid', 'normalise_calendar_attendees'
  ];
  v_changed text[] := array[]::text[];
  v_fn record;
  v_def text;
  v_new text;
begin
  for v_fn in
    select p.oid, p.proname::text as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    if position('e1:' in v_def) = 0 then
      continue;
    end if;
    v_new := pg_temp.accept_bound(v_def);
    if v_new <> v_def then
      execute v_new;
      v_changed := v_changed || v_fn.name;
    end if;
  end loop;
  if exists (select 1 from unnest(v_required) r where not (r = any (v_changed))) then
    raise exception 'bound values: not patched: %', (select string_agg(r, ', ') from unnest(v_required) r where not (r = any (v_changed)));
  end if;
end;
$$;

-- 2
do $$
declare
  v_policy record;
  v_check text;
begin
  for v_policy in
    select policyname, with_check from pg_policies
    where schemaname = 'public' and tablename = 'outbox' and with_check like '%e1:%'
  loop
    v_check := replace(v_policy.with_check, '~~ ''e1:%''::text', '~ ''^e[12]:''::text');
    if v_check = v_policy.with_check then
      raise exception 'bound values: policy % not patched', v_policy.policyname;
    end if;
    execute format('alter policy %I on public.outbox with check (%s)', v_policy.policyname, v_check);
  end loop;
end;
$$;

-- 3
grant insert (id) on public.calendar_updates to authenticated;
