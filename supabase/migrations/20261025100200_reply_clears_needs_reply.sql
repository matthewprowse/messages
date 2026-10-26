-- A conversation stops needing a reply once you have replied. Triage sets needs_reply when a message
-- comes in, but nothing cleared it when you answered, from this app or from your phone, so the Summary
-- kept listing people you had already answered.
--
-- When a message of yours is stored that is newer than everything they sent, the conversation and the
-- triage of their messages before it stop needing a reply. A later message from them is triaged again
-- and can set it once more. Your old sent mail arriving in a first sync, older than their latest
-- message, changes nothing.
create or replace function public.clear_needs_reply_on_reply()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.messages m
    where m.thread_id = new.thread_id and m.direction = 'inbound' and m.sent_at > new.sent_at
  ) then
    return null;
  end if;
  update public.threads set needs_reply = false where id = new.thread_id and needs_reply;
  update public.message_ai a set needs_reply = false
  from public.messages m
  where a.message_id = m.id and m.thread_id = new.thread_id and m.direction = 'inbound' and a.needs_reply;
  return null;
end;
$$;

revoke execute on function public.clear_needs_reply_on_reply() from public, anon, authenticated;

create trigger messages_reply_clears_needs_reply
  after insert on public.messages
  for each row when (new.direction = 'outbound')
  execute function public.clear_needs_reply_on_reply();

-- Conversations you already answered.
update public.threads t set needs_reply = false
where t.needs_reply and not exists (
  select 1 from public.messages m
  where m.thread_id = t.id and m.direction = 'inbound'
    and m.sent_at > (select max(o.sent_at) from public.messages o where o.thread_id = t.id and o.direction = 'outbound')
) and exists (select 1 from public.messages o where o.thread_id = t.id and o.direction = 'outbound');

update public.message_ai a set needs_reply = false
from public.messages m, public.threads t
where a.message_id = m.id and m.thread_id = t.id and a.needs_reply and not t.needs_reply;
