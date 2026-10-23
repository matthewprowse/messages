-- Encryption, stage 2: WhatsApp reactions are kept by who reacted, and that was their number or privacy ID
-- as a JSON key. They are now kept by its blind index instead (still 'me' for you), which stays the same
-- for one person so a new reaction replaces their last one. Who it was is kept encrypted beside it, in
-- provider_meta.reactors {"<index>": "<encrypted number or privacy ID>"}, for the app to show.
drop function public.whatsapp_react(uuid, text, text, text);
create function public.whatsapp_react(
  p_account_id uuid, p_provider_message_id text, p_sender text, p_emoji text, p_reactor text default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_found boolean;
  v_removing boolean := coalesce(p_emoji, '') = '';
begin
  update public.messages m
  set provider_meta = jsonb_set(
    jsonb_set(
      m.provider_meta,
      '{reactions}',
      case when v_removing
        then coalesce(m.provider_meta->'reactions', '{}'::jsonb) - p_sender
        else coalesce(m.provider_meta->'reactions', '{}'::jsonb) || jsonb_build_object(p_sender, p_emoji)
      end
    ),
    '{reactors}',
    case when v_removing or p_reactor is null
      then coalesce(m.provider_meta->'reactors', '{}'::jsonb) - p_sender
      else coalesce(m.provider_meta->'reactors', '{}'::jsonb) || jsonb_build_object(p_sender, p_reactor)
    end
  )
  where m.account_id = p_account_id and m.provider_message_id = p_provider_message_id
  returning true into v_found;
  return coalesce(v_found, false);
end;
$$;

revoke execute on function public.whatsapp_react(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_react(uuid, text, text, text, text) to service_role;
