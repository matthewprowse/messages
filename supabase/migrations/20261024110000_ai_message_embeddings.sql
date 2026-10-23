-- Message embeddings move out of public.messages into their own table.
--
-- Every embedding the AI worker saved was an update to a messages row, and messages is in the realtime
-- publication, so each one sent the whole row (the 768 number vector and body_html included) to every
-- open browser. select * on messages also pulled the vector, about 10 KB a row. The new table is not in
-- the publication and only the service role can read it.
--
-- 1. public.message_embeddings: one row per incoming message. A row with no embedding yet is the AI
--    worker's queue, filled in newest first; a trigger adds the row when the message is stored.
-- 2. Existing embeddings are copied over. Only incoming messages are kept: similar_replies only ever
--    searches what you received, and the worker only embeds incoming mail.
-- 3. similar_replies() reads the new table, with the same signature and results.
-- 4. embedded_message_count() gives the app the "messages indexed" count it read from messages.embedding.
-- 5. messages.embedding and its two indexes are dropped.
--
-- Deploy the AI worker that knows this table first: it falls back to messages.embedding until this runs.
-- The worker before it keeps triaging and drafting after this runs, but stops embedding and finds no
-- similar replies, as it reads a column that is gone. The copy and the vector index are built while
-- messages is locked, so new mail waits for this to finish; run it at a quiet time.

-- Using a vector function first loads pgvector, which defines hnsw.ef_search for the function below.
select extensions.vector_dims('[1]'::extensions.vector);

-- 1. The table.
create table public.message_embeddings (
  message_id uuid primary key references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null,                -- copied from the message, so the queue is worked newest first
  embedding extensions.vector(768),            -- null until the AI worker has embedded the message
  created_at timestamptz not null default now()
);

-- RLS on and no policies: only the service role (the AI worker) reads or writes it.
alter table public.message_embeddings enable row level security;
revoke all on public.message_embeddings from anon, authenticated;

-- Incoming messages join the queue as they are stored. One insert per statement, so a sync that stores
-- a hundred messages at once adds their rows in one go. Security definer, as the row is written for
-- whoever stored the message and app roles cannot write this table.
create or replace function public.queue_message_embeddings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.message_embeddings (message_id, user_id, sent_at)
  select i.id, i.user_id, i.sent_at from inserted i where i.direction = 'inbound'
  on conflict (message_id) do nothing;
  return null;
end;
$$;

revoke execute on function public.queue_message_embeddings() from public, anon, authenticated;

-- Created before the copy: the trigger's lock waits for messages being stored now and holds new ones
-- until this commits, so no message falls between the copy and the trigger.
create trigger messages_queue_embeddings
  after insert on public.messages
  referencing new table as inserted
  for each statement execute function public.queue_message_embeddings();

-- 2. Copy what is there, embedded or not.
insert into public.message_embeddings (message_id, user_id, sent_at, embedding)
select m.id, m.user_id, m.sent_at, m.embedding
from public.messages m
where m.direction = 'inbound'
on conflict (message_id) do nothing;

-- Indexes after the copy, which is faster than keeping them up to date row by row.
create index message_embeddings_embedding_idx on public.message_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);
create index message_embeddings_pending_idx on public.message_embeddings (sent_at desc) where embedding is null;
create index message_embeddings_user_idx on public.message_embeddings (user_id);

-- 3. similar_replies, reading the new table. Same signature, same columns, same order and limits.
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
           e.embedding operator(extensions.<=>) p_embedding as distance
    from public.message_embeddings e
    join public.messages m on m.id = e.message_id
    where e.user_id = p_user and e.embedding is not null
      and m.user_id = p_user and m.direction = 'inbound'
      and (p_exclude_thread is null or m.thread_id <> p_exclude_thread)
    order by e.embedding operator(extensions.<=>) p_embedding
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

-- 4. How many of your messages are embedded, for Settings. Counts your own rows only.
create or replace function public.embedded_message_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.message_embeddings
  where user_id = (select auth.uid()) and embedding is not null;
$$;

revoke execute on function public.embedded_message_count() from public, anon;
grant execute on function public.embedded_message_count() to authenticated;

-- 5. The old column and its indexes.
drop index if exists public.messages_unembedded_idx;
drop index if exists public.messages_embedding_idx;
alter table public.messages drop column embedding;
