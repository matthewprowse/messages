-- rekey_page also finds rows holding bound sealed bytes (security audit 2026-11-04, Low).
--
-- A column holding sealed bytes as base64 ("e1b:" starts "ZTFiOgD/S0") was found by the re-key and bind jobs; the
-- bound form ("e2b:", which starts "ZTJiOg") was not, so a future bytes column written bound would be skipped by a key
-- rotation and left under the old key. Same function as 20261126100100 with that prefix added to the pattern; the
-- worker's looksSealed (apps/worker/src/rekey/reseal.ts) gets the same. Grants are kept by create or replace.

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
  v_ids text[];
  v_out jsonb;
begin
  select * into v_shape from public.rekey_shape(p_table, p_scope);
  if v_shape.cols is null then
    return '[]'::jsonb;
  end if;
  select coalesce(array_agg(c.column_name::text), array[]::text[]) into v_ids
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and c.data_type = 'uuid';
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
         ''row'', (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(t)) e where e.key = any ($5)),
         ''ids'', (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(t)) e where e.key = any ($6))
       ) as v
       from public.%I t, jsonb_populate_record(null::public.%I, coalesce($2, ''{}''::jsonb)) r
       where %s and %s and (%s) ~ ''(e1:|e2:|v2:|ZTFiOgD/S0|ZTJiOg)''
       order by %s
       limit $3
     ) x',
    p_table, p_table, v_scope, v_after, v_text, v_order)
  into v_out
  using p_owner, p_after, greatest(1, least(p_limit, 500)), v_shape.pk, v_shape.cols, v_ids;
  return v_out;
end;
$$;
