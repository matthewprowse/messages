-- Rotating a user's data key (docs/security-audit-2026-11-03.md H1; apps/worker/src/rekey, run by the owner with
-- `pnpm --filter worker keys:rekey`). Nothing here changes what any reader does until that job runs for someone.
--
-- 1. user_keys gets the columns a rotation needs beside the current key (wrapped_key, wrapped_by, which still seals):
--      next_wrapped_*      a new key being made ready: readers open with it, nobody seals with it yet
--      previous_wrapped_*  the key being re-sealed away from: readers open with it until the job retires it
--      index_wrapped_*     the raw index key the user's blind indexes are made with, kept at their first rotation so no
--                          index token changes (wrapped with "user_index_keys:<user id>"); null means the current key
--                          makes them, as for everyone never rotated
--    Readers select "*" from user_keys, so they work the same before and after this migration.
-- 2. user_key_rotations: where each user's rotation is (phase, when, the re-seal cursor and counts), so the job can stop
--    and run again. Service role only.
-- 3. rekey_page and rekey_write: one page of a user's rows that hold sealed text, and a guarded write of re-sealed values,
--    for any table with a user_id (or, for the account tables, an account_id of the user's). The write only changes
--    text columns, only where the row still holds the value that was read, and runs with triggers quiet
--    (session_replication_role replica where the database allows it, and the flags the address index and share
--    triggers already honour), because a re-seal changes no value: nothing must look edited, re-indexed or shared.

alter table public.user_keys
  add column if not exists next_wrapped_key text,
  add column if not exists next_wrapped_by text,
  add column if not exists previous_wrapped_key text,
  add column if not exists previous_wrapped_by text,
  add column if not exists index_wrapped_key text,
  add column if not exists index_wrapped_by text,
  add column if not exists rotated_at timestamptz;

alter table public.user_keys drop constraint if exists user_keys_rotation_pairs;
alter table public.user_keys add constraint user_keys_rotation_pairs check (
  (next_wrapped_key is null) = (next_wrapped_by is null)
  and (previous_wrapped_key is null) = (previous_wrapped_by is null)
  and (index_wrapped_key is null) = (index_wrapped_by is null)
  -- one rotation at a time: a key is made ready only once the last one has been retired
  and not (next_wrapped_key is not null and previous_wrapped_key is not null)
);

create table if not exists public.user_key_rotations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phase text not null check (phase in ('prepared', 'switched', 'done')),
  prepared_at timestamptz not null default now(),
  switched_at timestamptz,
  -- When the last pass that found nothing to move began. The old key is retired once one began long enough after the switch.
  clean_pass_at timestamptz,
  -- The pass in progress: {"started": iso, "unit": "<table or bucket>", "after": <key>, "moved": n, "unreadable": n, "done": [units]}.
  cursor jsonb not null default '{}'::jsonb,
  moved bigint not null default 0,
  unreadable bigint not null default 0,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_key_rotations enable row level security;
revoke all on public.user_key_rotations from anon, authenticated;

-- The text-like columns of a table (the only ones that can hold "e1:", "v2:" or a sealed file in base64) and its primary
-- key, checked against the catalog so a table name from the caller never reaches the SQL unchecked.
create or replace function public.rekey_shape(p_table text, p_scope text, out pk text[], out cols text[], out scope_column text)
  language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_scope not in ('user', 'account') then
    raise exception 'unknown scope %', p_scope;
  end if;
  if p_table in ('user_keys', 'user_key_rotations', 'team_keys') then
    raise exception '% is not re-sealed by rekey', p_table;
  end if;
  scope_column := case p_scope when 'user' then 'user_id' else 'account_id' end;
  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = p_table and c.column_name = scope_column
  ) then
    raise exception 'public.% has no %', p_table, scope_column;
  end if;
  select array_agg(a.attname::text order by k.ord) into pk
  from pg_index i
  cross join lateral unnest(i.indkey) with ordinality as k (attnum, ord)
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  if pk is null then
    raise exception 'public.% has no primary key', p_table;
  end if;
  select array_agg(c.column_name::text order by c.ordinal_position) into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and c.is_generated = 'NEVER'
    and (c.data_type in ('text', 'character varying', 'json', 'jsonb') or (c.data_type = 'ARRAY' and c.udt_name in ('_text', '_varchar')));
end;
$$;

-- Up to p_limit rows of the user's after p_after (a primary key object from an earlier page), in key order, that hold
-- anything that looks sealed. Each is {"key": {primary key}, "row": {text-like columns}}.
create or replace function public.rekey_page(p_table text, p_scope text, p_owner uuid, p_after jsonb, p_limit integer)
  returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  v_shape record;
  v_scope text;
  v_order text;
  v_after text := 'true';
  v_text text;
  v_out jsonb;
begin
  select * into v_shape from public.rekey_shape(p_table, p_scope);
  if v_shape.cols is null then
    return '[]'::jsonb;
  end if;
  v_scope := case p_scope when 'user' then 't.user_id = $1' else 't.account_id in (select a.id from public.accounts a where a.user_id = $1)' end;
  v_order := (select string_agg(format('t.%I', c), ', ') from unnest(v_shape.pk) c);
  if p_after is not null then
    v_after := format('(%s) > (%s)', v_order, (select string_agg(format('r.%I', c), ', ') from unnest(v_shape.pk) c));
  end if;
  v_text := (select string_agg(format('coalesce(t.%I::text, '''')', c), ' || '' '' || ') from unnest(v_shape.cols) c);
  execute format(
    'select coalesce(jsonb_agg(x.v), ''[]''::jsonb) from (
       select jsonb_build_object(
         ''key'', (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(t)) e where e.key = any ($4)),
         ''row'', (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(t)) e where e.key = any ($5))
       ) as v
       from public.%I t, jsonb_populate_record(null::public.%I, coalesce($2, ''{}''::jsonb)) r
       where %s and %s and (%s) ~ ''(e1:|v2:|ZTFiOgD/S0)''
       order by %s
       limit $3
     ) x',
    p_table, p_table, v_scope, v_after, v_text, v_order)
  into v_out
  using p_owner, p_after, greatest(1, least(p_limit, 500)), v_shape.pk, v_shape.cols;
  return v_out;
end;
$$;

-- Writes re-sealed values: p_rows is [{"key": {...}, "expect": {column: old}, "set": {column: new}}]. A row is written only
-- if it is still the user's and every column in "expect" still holds what was read, so a value changed meanwhile is left
-- for the next pass. Only text-like columns outside the primary key can be set. Returns how many rows were written.
create or replace function public.rekey_write(p_table text, p_scope text, p_owner uuid, p_rows jsonb)
  returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  v_shape record;
  v_scope text;
  v_key text;
  v_row jsonb;
  v_set text;
  v_match text;
  v_count integer := 0;
  v_done integer;
begin
  select * into v_shape from public.rekey_shape(p_table, p_scope);
  if v_shape.cols is null then
    return 0;
  end if;
  begin
    perform set_config('session_replication_role', 'replica', true);
  exception when others then
    null; -- not allowed here: the flags below still keep the triggers that matter quiet
  end;
  perform set_config('messages.keep_address_index', 'on', true);
  perform set_config('share.writing', 'on', true);
  v_scope := case p_scope when 'user' then 't.user_id = $2' else 't.account_id in (select a.id from public.accounts a where a.user_id = $2)' end;
  v_key := (select string_agg(format('to_jsonb(t.%I) = $1->''key''->%L', c, c), ' and ') from unnest(v_shape.pk) c);
  for v_row in select * from jsonb_array_elements(p_rows) loop
    select string_agg(format('%I = (jsonb_populate_record(null::public.%I, $1->''set'')).%I', k, p_table, k), ', '),
           string_agg(format('coalesce(to_jsonb(t.%I), ''null''::jsonb) = coalesce($1->''expect''->%L, ''null''::jsonb)', k, k), ' and ')
    into v_set, v_match
    from jsonb_object_keys(v_row->'set') as k
    where k = any (v_shape.cols) and not (k = any (v_shape.pk));
    if v_set is null then
      continue;
    end if;
    execute format('update public.%I t set %s where %s and %s and %s', p_table, v_set, v_scope, v_key, v_match) using v_row, p_owner;
    get diagnostics v_done = row_count;
    v_count := v_count + v_done;
  end loop;
  perform set_config('messages.keep_address_index', 'off', true);
  perform set_config('share.writing', 'off', true);
  return v_count;
end;
$$;

revoke execute on function public.rekey_shape(text, text) from public, anon, authenticated;
revoke execute on function public.rekey_page(text, text, uuid, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.rekey_write(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rekey_page(text, text, uuid, jsonb, integer) to service_role;
grant execute on function public.rekey_write(text, text, uuid, jsonb) to service_role;
