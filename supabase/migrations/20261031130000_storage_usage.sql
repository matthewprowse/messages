-- Storage use per person, for the Storage section in Settings, and the abuse flag for the owner.
-- Counts stored pictures, video, PDFs and documents. Voice notes and stickers belong to their chats and
-- are not counted (docs/PLAN.md, Fair Usage and Storage). Sizes only; never names or content.

-- 1. What each person has stored, by kind. security_invoker keeps the table's row-level security, so
--    everyone sees only their own.
create view public.storage_usage with (security_invoker = true) as
select
  user_id,
  kind,
  count(*)::integer as files,
  coalesce(sum(size_bytes), 0)::bigint as bytes
from public.attachments
where storage_path is not null
  and kind <> 'audio'
  and filename not ilike 'Sticker.%'
group by user_id, kind;

revoke all on public.storage_usage from anon;
grant select on public.storage_usage to authenticated;

-- 2. Accounts that look like file hosting, for the owner only. A flag is a number to look at, not a
--    block. Returns an empty set for anyone but the owner.
--      * more than 5 GB added in the past 7 days, or
--      * at least 2 GB stored and over half of it in one one-to-one chat (a chat with your own
--        number looks the same as any one-to-one chat here).
create function public.storage_flags()
returns table (user_id uuid, total_bytes bigint, week_bytes bigint, top_chat_bytes bigint, reason text)
language sql stable security definer set search_path = ''
as $$
  with stored as (
    select a.user_id, a.size_bytes, a.created_at, m.thread_id, t.is_group
    from public.attachments a
    join public.messages m on m.id = a.message_id
    join public.threads t on t.id = m.thread_id
    where a.storage_path is not null and a.kind <> 'audio' and a.filename not ilike 'Sticker.%'
      and a.size_bytes is not null
  ),
  per_user as (
    select s.user_id,
           sum(s.size_bytes)::bigint as total,
           coalesce(sum(s.size_bytes) filter (where s.created_at > now() - interval '7 days'), 0)::bigint as week
    from stored s group by s.user_id
  ),
  per_chat as (
    select s.user_id, s.thread_id, sum(s.size_bytes)::bigint as bytes
    from stored s where not s.is_group group by s.user_id, s.thread_id
  ),
  top_chat as (
    select distinct on (c.user_id) c.user_id, c.bytes
    from per_chat c order by c.user_id, c.bytes desc
  )
  select u.user_id, u.total, u.week, coalesce(c.bytes, 0)::bigint,
         case when u.week > 5368709120 then 'More than 5 GB added in a week' else 'Over half in one chat' end
  from per_user u
  left join top_chat c on c.user_id = u.user_id
  where public.is_analytics_owner()
    and (u.week > 5368709120 or (u.total >= 2147483648 and coalesce(c.bytes, 0) * 2 > u.total))
  order by u.total desc
$$;
revoke execute on function public.storage_flags() from public, anon;
grant execute on function public.storage_flags() to authenticated;
