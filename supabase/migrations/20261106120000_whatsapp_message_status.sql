-- Delivery ticks on WhatsApp messages you sent: provider_meta.receipt is 'sent', 'delivered' or 'read'.
-- It only moves forward, so a late 'delivered' never undoes 'read', and only your own messages carry it.
create or replace function public.whatsapp_message_status(p_account_id uuid, p_provider_message_id text, p_status text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_rank constant jsonb := '{"sent": 1, "delivered": 2, "read": 3}';
  v_found boolean;
begin
  if p_status not in ('sent', 'delivered', 'read') then
    return false;
  end if;
  update public.messages m
  set provider_meta = m.provider_meta || jsonb_build_object('receipt', p_status)
  where m.account_id = p_account_id
    and m.provider_message_id = p_provider_message_id
    and m.direction = 'outbound'
    and coalesce((v_rank ->> (m.provider_meta ->> 'receipt'))::int, 0) < (v_rank ->> p_status)::int
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke execute on function public.whatsapp_message_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_message_status(uuid, text, text) to service_role;
