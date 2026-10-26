-- Only incoming mail you have replied to is embedded. similar_replies returns an incoming message only
-- together with the reply to it, so a vector for mail nobody answered is never returned. About four in
-- five incoming messages are newsletters and notifications. Worse, similar_replies takes its closest
-- candidates before looking for the reply, so unanswered mail fills those places and can leave a draft
-- with fewer than the three examples it asks for.
--
-- A message joins the queue (public.message_embeddings, a row with no vector) when
--   1. an outgoing message is stored: the incoming message it answers is queued, found as
--      similar_replies finds it, by In-Reply-To first, then the latest incoming message before the reply;
--   2. an incoming message is stored in a conversation that already has a later reply, as a sync can
--      store the reply before the message it answers.
-- Mail that is never answered is never queued. Messages that already have a vector keep it.
create or replace function public.queue_message_embeddings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.message_embeddings (message_id, user_id, sent_at)
  select p.id, p.user_id, p.sent_at
  from inserted o
  cross join lateral (
    select c.id, c.user_id, c.sent_at from public.messages c
    where c.thread_id = o.thread_id and c.direction = 'inbound'
      and (c.provider_message_id = o.in_reply_to or c.sent_at < o.sent_at)
    order by (c.provider_message_id is distinct from o.in_reply_to), c.sent_at desc
    limit 1
  ) p
  where o.direction = 'outbound'
  on conflict (message_id) do nothing;

  insert into public.message_embeddings (message_id, user_id, sent_at)
  select i.id, i.user_id, i.sent_at
  from inserted i
  where i.direction = 'inbound'
    and exists (
      select 1 from public.messages o
      where o.thread_id = i.thread_id and o.direction = 'outbound' and o.sent_at > i.sent_at
    )
  on conflict (message_id) do nothing;
  return null;
end;
$$;

-- Queue rows nothing will ever return: not embedded yet, and no reply after them.
delete from public.message_embeddings e
where e.embedding is null
  and not exists (
    select 1 from public.messages m
    join public.messages o on o.thread_id = m.thread_id and o.direction = 'outbound' and o.sent_at > m.sent_at
    where m.id = e.message_id
  );

-- Mail that is answered but has no queue row yet (answered before this ran, never queued).
insert into public.message_embeddings (message_id, user_id, sent_at)
select m.id, m.user_id, m.sent_at
from public.messages m
where m.direction = 'inbound'
  and exists (select 1 from public.messages o where o.thread_id = m.thread_id and o.direction = 'outbound' and o.sent_at > m.sent_at)
on conflict (message_id) do nothing;
