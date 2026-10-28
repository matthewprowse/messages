-- Pre-drafting wrote a draft for any incoming mail triage marked personal or work, even when triage said no reply
-- was needed (needs_reply false), and a pre-draft and a draft you ask for share one budget. That spent model calls
-- on FYI mail. Now a pre-draft needs triage to say a reply is needed (message_ai.needs_reply), and the daily cap
-- on pre-drafts written by the model is 15, down from 30.
--
-- request_auto_draft is otherwise exactly as 20261028110900_pre_drafting.sql left it (the only migration that
-- defines it): same checks, same order, same grants. Asking for a draft yourself is not affected.
-- create or replace keeps the existing grants; they are repeated so the file stands alone. Nothing here scans
-- or locks a table.

create or replace function public.request_auto_draft(p_thread uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_msg record;
  v_id uuid;
begin
  -- Settings, Auto-Draft Replies (profiles.auto_draft_top) turned off: no pre-drafts.
  if v_user is null or not exists (select 1 from public.profiles p where p.user_id = v_user and p.auto_draft_top) then
    return null;
  end if;
  -- One to one, yours, not junk or deleted, and triaged.
  if not exists (
    select 1 from public.threads t
    where t.id = p_thread and t.user_id = v_user and not t.is_group and not t.junk and t.triage_enabled and t.status <> 'trash'
  ) then
    return null;
  end if;
  -- The latest message is theirs and under 7 days old.
  select m.id, m.direction, m.sent_at into v_msg
  from public.messages m
  where m.thread_id = p_thread and m.user_id = v_user
  order by m.sent_at desc
  limit 1;
  if v_msg.id is null or v_msg.direction <> 'inbound' or v_msg.sent_at < now() - interval '7 days' then
    return null;
  end if;
  -- Triage has read it and says it needs a reply: someone writing to you, not a newsletter, notification, FYI or junk.
  if not exists (
    select 1 from public.message_ai a
    where a.message_id = v_msg.id and not a.junk and a.needs_reply
  ) then
    return null;
  end if;
  -- Nothing asked for, discarded or written since it arrived, and nothing still being written.
  if exists (
    select 1 from public.drafts d
    where d.thread_id = p_thread and (d.status = 'pending' or d.created_at > v_msg.sent_at or d.for_message_id = v_msg.id)
  ) then
    return null;
  end if;
  -- At most 15 written by the model in the last 24 hours. One dropped before the model ran is free.
  if (
    select count(*) from public.drafts d
    where d.user_id = v_user and d.auto and d.model is not null and d.created_at > now() - interval '24 hours'
  ) >= 15 then
    return null;
  end if;
  insert into public.drafts (user_id, thread_id, tone, status, auto, for_message_id)
  values (v_user, p_thread, 'default', 'pending', true, v_msg.id)
  on conflict (for_message_id) where auto do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.request_auto_draft(uuid) from public, anon;
grant execute on function public.request_auto_draft(uuid) to authenticated;
