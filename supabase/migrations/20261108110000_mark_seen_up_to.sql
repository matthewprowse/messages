-- "Seen" under your messages on Instagram and LinkedIn: the other person has seen a thread up to a time, so
-- your messages in it sent at or before then get provider_meta.receipt = 'read' (the same field WhatsApp's
-- ticks use). Only your own messages carry it, and one already 'read' is left alone. A thread is found by
-- its blind index when the sync worker sends one (provider_thread_id is sealed), else by its readable ID.
-- Returns how many messages changed.
create or replace function public.mark_seen_up_to(
  p_account_id uuid, p_thread_provider_id text, p_seen_at timestamptz, p_thread_index text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.messages m
  set provider_meta = m.provider_meta || '{"receipt": "read"}'::jsonb
  where m.account_id = p_account_id
    and m.direction = 'outbound'
    and m.sent_at <= p_seen_at
    and m.provider_meta ->> 'receipt' is distinct from 'read'
    and m.thread_id in (
      select t.id from public.threads t
      where t.account_id = p_account_id
        and case when p_thread_index is not null then t.provider_thread_index = p_thread_index else t.provider_thread_id = p_thread_provider_id end
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_seen_up_to(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.mark_seen_up_to(uuid, text, timestamptz, text) to service_role;
