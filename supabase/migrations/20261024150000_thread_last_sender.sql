-- The person a conversation is shown as: whoever sent its latest incoming message. Email conversations
-- can have several people in them (a forward from one, cc'ing another), and the list, avatar and header
-- showed whichever participant happened to come first. Kept up to date as messages arrive, and when a
-- message's sender changes (contact merging moves messages to the surviving contact).
alter table public.threads add column last_sender_contact_id uuid references public.contacts (id) on delete set null;

create or replace function public.refresh_thread_last_sender(p_thread_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.threads t
  set last_sender_contact_id = s.contact_id
  from (
    select (
      select m.sender_contact_id from public.messages m
      where m.thread_id = p_thread_id and m.direction = 'inbound' and m.sender_contact_id is not null
      order by m.sent_at desc
      limit 1
    ) as contact_id
  ) s
  where t.id = p_thread_id and t.last_sender_contact_id is distinct from s.contact_id;
$$;

create or replace function public.thread_last_sender_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'inbound' then
    perform public.refresh_thread_last_sender(new.thread_id);
  end if;
  return null;
end;
$$;

create trigger messages_thread_last_sender
  after insert or update of sender_contact_id on public.messages
  for each row
  execute function public.thread_last_sender_on_message();

revoke execute on function public.refresh_thread_last_sender(uuid) from public, anon, authenticated;
revoke execute on function public.thread_last_sender_on_message() from public, anon, authenticated;

update public.threads t
set last_sender_contact_id = s.contact_id
from (
  select distinct on (m.thread_id) m.thread_id, m.sender_contact_id as contact_id
  from public.messages m
  where m.direction = 'inbound' and m.sender_contact_id is not null
  order by m.thread_id, m.sent_at desc
) s
where t.id = s.thread_id;
