-- What the contacts list shows about each contact's conversations, worked out in the database so the app
-- no longer loads every conversation of every contact (apps/web/lib/contacts.ts listContacts).
--
-- One row per contact of the caller: the latest activity across their conversations and how many there
-- are. Conversations in the provider's bin (status 'trash') are left out, as in Conversations. A contact
-- with none has last_at null and conversation_count 0.
--
-- Security invoker: row-level security on contacts, thread_participants and threads applies as usual, and
-- the user filter is there as well so it never rests on that alone.

create or replace function public.contact_summaries()
returns table (contact_id uuid, last_at timestamptz, conversation_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, max(t.last_message_at), count(t.id)::integer
  from public.contacts c
  left join public.thread_participants tp on tp.contact_id = c.id
  left join public.threads t on t.id = tp.thread_id and t.status <> 'trash'
  where c.user_id = (select auth.uid())
  group by c.id
$$;

revoke execute on function public.contact_summaries() from public, anon;
grant execute on function public.contact_summaries() to authenticated;
