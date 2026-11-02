-- Contacts page fixes: a truer "last contacted", a person/company override, and a companies list counted in SQL.
--
-- 1. contact_summaries(): last_at took the newest message across every conversation, so a contact rose to the top
--    of Recent because someone else spoke in a shared group, or because a newsletter arrived. The newest message now
--    ignores group chats, junk and newsletter or notification conversations. conversation_count is unchanged (every
--    conversation that is not in the bin), so the number on the list still matches the contact's page.
-- 2. contacts.kind_override: 'person' or 'company' set by the user when the sender heuristic (apps/web/lib/people.ts)
--    files someone on the wrong tab. Null means "decide by the heuristic".
-- 3. company_summaries(): the Companies list embedded every contact, identity and thread of every organization just
--    to count them. The counts are now made here: people, email addresses, one-to-one conversations (not in the bin)
--    and the newest message. Names and summaries stay sealed; the browser opens them.
--
-- Security invoker, so row-level security applies; the user filter is there as well.

alter table public.contacts add column if not exists kind_override text check (kind_override in ('person', 'company'));

create or replace function public.contact_summaries()
returns table (contact_id uuid, last_at timestamptz, conversation_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id,
         max(t.last_message_at) filter (
           where not t.is_group and not t.junk and coalesce(t.category, '') not in ('newsletter', 'notification')
         ),
         count(t.id)::integer
  from public.contacts c
  left join public.thread_participants tp on tp.contact_id = c.id
  left join public.threads t on t.id = tp.thread_id and t.status <> 'trash'
  where c.user_id = (select auth.uid())
  group by c.id
$$;

create or replace function public.company_summaries()
returns table (id uuid, name text, domain text, summary text, logo_path text, people integer, addresses integer, conversations integer, last_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id, o.name, o.domain, o.summary, o.logo_path,
         (select count(*) from public.contacts c where c.organization_id = o.id and c.user_id = o.user_id)::integer,
         (select count(*) from public.contact_identities ci join public.contacts c on c.id = ci.contact_id
            where c.organization_id = o.id and c.user_id = o.user_id and ci.kind = 'email')::integer,
         (select count(distinct t.id) from public.contacts c
            join public.thread_participants tp on tp.contact_id = c.id
            join public.threads t on t.id = tp.thread_id
            where c.organization_id = o.id and c.user_id = o.user_id and t.status <> 'trash' and not t.is_group)::integer,
         (select max(t.last_message_at) from public.contacts c
            join public.thread_participants tp on tp.contact_id = c.id
            join public.threads t on t.id = tp.thread_id
            where c.organization_id = o.id and c.user_id = o.user_id and t.status <> 'trash' and not t.is_group)
  from public.organizations o
  where o.user_id = (select auth.uid())
    and exists (select 1 from public.contacts c where c.organization_id = o.id and c.user_id = o.user_id)
$$;

revoke execute on function public.company_summaries() from public, anon;
grant execute on function public.company_summaries() to authenticated;

