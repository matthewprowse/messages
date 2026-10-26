-- What the model decided about a sender's last few messages, so triage can skip the model for a bulk
-- sender it has labelled the same way every time. Names the sender by sender_index (the blind index of
-- the address), so no address is opened here.
--
-- For each sender in p_senders: their latest p_keep messages that the model decided (message_ai.model is
-- not null, so labels copied by a rule never count as evidence), newest first, with whether anyone
-- corrected the conversation (a row in public.feedback).
create or replace function public.sender_history(p_user uuid, p_senders text[], p_keep int default 3)
returns table (
  sender_index text,
  priority text,
  category text,
  junk boolean,
  needs_reply boolean,
  decided_at timestamptz,
  corrected boolean
)
language sql
stable
set search_path = ''
as $$
  select r.sender_index, r.priority, r.category, r.junk, r.needs_reply, r.created_at, r.corrected
  from (
    select m.sender_index, a.priority, a.category, a.junk, a.needs_reply, a.created_at,
           exists (select 1 from public.feedback f where f.thread_id = m.thread_id) as corrected,
           row_number() over (partition by m.sender_index order by m.sent_at desc) as n
    from public.messages m
    join public.message_ai a on a.message_id = m.id
    where m.user_id = p_user and m.sender_index = any (p_senders) and a.model is not null
  ) r
  where r.n <= greatest(coalesce(p_keep, 3), 1)
  order by r.sender_index, r.n;
$$;

revoke execute on function public.sender_history(uuid, text[], int) from public, anon, authenticated;
grant execute on function public.sender_history(uuid, text[], int) to service_role;
