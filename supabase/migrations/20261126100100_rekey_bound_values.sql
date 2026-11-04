-- The re-key job (apps/worker/src/rekey) also moves values to the bound format ("e2:", 20261126100000_bound_values.sql):
-- rekey_page now finds rows holding "e2:" values as well as the legacy ones, and hands back each row's uuid columns ("ids"),
-- from which the job names the row a value is bound to (an outbox file's outbox_id). Otherwise exactly 20261125130000_user_key_rotation.sql: the same checks, order
-- and limits. Grants are kept by create or replace.

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
       where %s and %s and (%s) ~ ''(e1:|e2:|v2:|ZTFiOgD/S0)''
       order by %s
       limit $3
     ) x',
    p_table, p_table, v_scope, v_after, v_text, v_order)
  into v_out
  using p_owner, p_after, greatest(1, least(p_limit, 500)), v_shape.pk, v_shape.cols, v_ids;
  return v_out;
end;
$$;
