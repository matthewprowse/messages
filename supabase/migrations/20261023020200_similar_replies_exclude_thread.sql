-- similar_replies can leave out the conversation being drafted in, before its limit is applied. In a long
-- thread the closest past emails are mostly earlier messages of that same thread, which the AI worker
-- drops anyway, so without this the limit could be used up by them and no similar reply would remain.
-- p_exclude_thread defaults to null, so callers that do not pass it work as before.
-- Using a vector function first loads pgvector, which defines hnsw.ef_search for the function below.
select extensions.vector_dims('[1]'::extensions.vector);

drop function if exists public.similar_replies(uuid, extensions.vector, int);

create or replace function public.similar_replies(p_user uuid, p_embedding extensions.vector(768), p_limit int, p_exclude_thread uuid default null)
returns table (
  inbound_message_id uuid,
  thread_id uuid,
  contact_id uuid,
  inbound_subject text,
  inbound_text text,
  inbound_sent_at timestamptz,
  reply_message_id uuid,
  reply_text text,
  reply_sent_at timestamptz,
  similarity double precision
)
language sql
stable
set search_path = ''
set hnsw.ef_search = 200
as $$
  with candidates as materialized (
    select m.id, m.thread_id, m.sender_contact_id, m.subject, m.body_text, m.sent_at, m.provider_message_id,
           m.embedding operator(extensions.<=>) p_embedding as distance
    from public.messages m
    where m.user_id = p_user and m.direction = 'inbound' and m.embedding is not null
      and (p_exclude_thread is null or m.thread_id <> p_exclude_thread)
    order by m.embedding operator(extensions.<=>) p_embedding
    limit greatest(least(coalesce(p_limit, 5), 50), 1) * 4
  )
  select c.id, c.thread_id, c.sender_contact_id, c.subject, c.body_text, c.sent_at,
         r.id, r.body_text, r.sent_at, 1 - c.distance
  from candidates c
  cross join lateral (
    select o.id, o.body_text, o.sent_at
    from public.messages o
    where o.thread_id = c.thread_id
      and o.direction = 'outbound'
      and o.body_text is not null
      and (
        o.in_reply_to = c.provider_message_id
        or (o.sent_at > c.sent_at and not exists (
          select 1 from public.messages n
          where n.thread_id = c.thread_id and n.direction = 'inbound'
            and n.sent_at > c.sent_at and n.sent_at < o.sent_at
        ))
      )
    order by (o.in_reply_to is distinct from c.provider_message_id), o.sent_at
    limit 1
  ) r
  order by c.distance
  limit greatest(least(coalesce(p_limit, 5), 50), 1);
$$;

revoke execute on function public.similar_replies(uuid, extensions.vector, int, uuid) from public, anon, authenticated;
grant execute on function public.similar_replies(uuid, extensions.vector, int, uuid) to service_role;
