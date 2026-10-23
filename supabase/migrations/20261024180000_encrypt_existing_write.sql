-- Temporary, for the one-off job that encrypts text stored before encryption was switched on
-- (apps/worker/scripts/encrypt-existing.ts). It is dropped once the job is done.
--
-- p_rows is [{ "id": <key>, "columns": { <column>: { "expect": <md5 of the text read, or null>, "value": <new text> } } }].
-- A row is written only when every column it changes still holds the text the job read (compared by
-- md5), so a message edited while the job runs is left for its next pass rather than overwritten.
-- Only the tables and columns below can be written. "quote" is the quoted text inside a WhatsApp
-- message's provider_meta. Returns how many rows were written. Callable only by the service role.
create or replace function public.encrypt_existing_write(p_table text, p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_allowed constant jsonb := '{
    "messages": ["subject", "preview", "body_text", "body_html", "list_unsubscribe", "quote"],
    "threads": ["subject", "last_message_preview", "summary"],
    "message_ai": ["summary"],
    "drafts": ["body", "instruction"],
    "draft_outcomes": ["draft_body", "sent_body"],
    "outbox": ["body", "subject"]
  }';
  v_key text := case when p_table = 'message_ai' then 'message_id' else 'id' end;
  v_row jsonb;
  v_col text;
  v_change jsonb;
  v_set text[];
  v_where text[];
  v_written integer;
  v_total integer := 0;
begin
  if not v_allowed ? p_table then
    raise exception 'table % is not part of the backfill', p_table;
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_set := '{}';
    v_where := '{}';
    for v_col, v_change in select key, value from jsonb_each(v_row->'columns') loop
      if not (v_allowed->p_table) ? v_col then
        raise exception 'column %.% is not part of the backfill', p_table, v_col;
      end if;
      if v_col = 'quote' then
        v_set := v_set || format('provider_meta = jsonb_set(provider_meta, ''{quoted,text}'', to_jsonb(%L::text))', v_change->>'value');
        v_where := v_where || format('md5(provider_meta->''quoted''->>''text'') is not distinct from %L', v_change->>'expect');
      else
        v_set := v_set || format('%I = %L', v_col, v_change->>'value');
        v_where := v_where || format('md5(%I) is not distinct from %L', v_col, v_change->>'expect');
      end if;
    end loop;
    continue when cardinality(v_set) = 0;
    execute format('update public.%I set %s where %I = %L and %s',
      p_table, array_to_string(v_set, ', '), v_key, v_row->>'id', array_to_string(v_where, ' and '));
    get diagnostics v_written = row_count;
    v_total := v_total + v_written;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.encrypt_existing_write(text, jsonb) from public, anon, authenticated;
grant execute on function public.encrypt_existing_write(text, jsonb) to service_role;
