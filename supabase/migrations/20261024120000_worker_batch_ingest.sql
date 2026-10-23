-- Bulk versions of ingest_email and ingest_whatsapp for first syncs and history imports: one request
-- stores a chunk of messages (the worker sends 25 emails or 50 WhatsApp messages at a time) instead of
-- one request each. Live mail and messages still go through the single-message functions.
--
-- Each row runs the existing single-message function unchanged, in array order, inside its own
-- savepoint (the begin ... exception block). A message that fails is rolled back on its own and comes
-- back as {"result": "error", "code": <SQLSTATE>}; the messages before and after it are still stored.
-- The result is a JSON array with one entry per input row, in the same order, each the same object the
-- single-message function returns.
--
-- Same settings as the functions they wrap: security invoker, empty search_path, callable only by the
-- service role (the worker). The worker falls back to one call per message while these are missing.

create or replace function public.ingest_email_batch(p_account_id uuid, p_mails jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_mail jsonb;
  v_out jsonb[] := '{}';
begin
  for v_mail in
    select e.value from jsonb_array_elements(coalesce(p_mails, '[]'::jsonb)) with ordinality as e (value, n) order by e.n
  loop
    begin
      v_out := array_append(v_out, public.ingest_email(p_account_id, v_mail));
    exception when others then
      v_out := array_append(v_out, jsonb_build_object('result', 'error', 'code', sqlstate));
    end;
  end loop;
  return to_jsonb(v_out);
end;
$$;

create or replace function public.ingest_whatsapp_batch(p_account_id uuid, p_msgs jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_msg jsonb;
  v_out jsonb[] := '{}';
begin
  for v_msg in
    select e.value from jsonb_array_elements(coalesce(p_msgs, '[]'::jsonb)) with ordinality as e (value, n) order by e.n
  loop
    begin
      v_out := array_append(v_out, public.ingest_whatsapp(p_account_id, v_msg));
    exception when others then
      v_out := array_append(v_out, jsonb_build_object('result', 'error', 'code', sqlstate));
    end;
  end loop;
  return to_jsonb(v_out);
end;
$$;

revoke execute on function public.ingest_email_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_email_batch(uuid, jsonb) to service_role;
revoke execute on function public.ingest_whatsapp_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_batch(uuid, jsonb) to service_role;

-- So the API sees the new functions without waiting for its schema cache to refresh.
notify pgrst, 'reload schema';
