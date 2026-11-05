-- Pre-drafts were asked for only by the open app (request_auto_draft), so a reply was written ahead only while the
-- app was open and in view. Now the AI worker asks too, as soon as triage says a new message needs a reply, so the
-- draft is usually there before the conversation is opened, whether the app was open or not.
--
-- The checks move, unchanged, into queue_auto_draft(p_user, p_thread), which takes the user instead of reading
-- auth.uid() and is for the service role only. request_auto_draft now calls it with the signed-in user, so the app
-- and the worker go through the same checks: Auto-Draft Replies on, one to one and not junk, the latest message theirs,
-- under 7 days old and needing a reply, nothing asked for or written since, and at most 15 written by the model a day.
-- Nothing here scans or locks a table.

create or replace function public.queue_auto_draft(p_user uuid, p_thread uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg record;
  v_id uuid;
begin
  -- Settings, Auto-Draft Replies (profiles.auto_draft_top) turned off: no pre-drafts.
  if p_user is null or not exists (select 1 from public.profiles p where p.user_id = p_user and p.auto_draft_top) then
    return null;
  end if;
  -- One to one, yours, not junk or deleted, and triaged.
  if not exists (
    select 1 from public.threads t
    where t.id = p_thread and t.user_id = p_user and not t.is_group and not t.junk and t.triage_enabled and t.status <> 'trash'
  ) then
    return null;
  end if;
  -- The latest message is theirs and under 7 days old.
  select m.id, m.direction, m.sent_at into v_msg
  from public.messages m
  where m.thread_id = p_thread and m.user_id = p_user
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
    where d.user_id = p_user and d.auto and d.model is not null and d.created_at > now() - interval '24 hours'
  ) >= 15 then
    return null;
  end if;
  insert into public.drafts (user_id, thread_id, tone, status, auto, for_message_id)
  values (p_user, p_thread, 'default', 'pending', true, v_msg.id)
  on conflict (for_message_id) where auto do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.queue_auto_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.queue_auto_draft(uuid, uuid) to service_role;

create or replace function public.request_auto_draft(p_thread uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.queue_auto_draft((select auth.uid()), p_thread);
end;
$$;

revoke execute on function public.request_auto_draft(uuid) from public, anon;
grant execute on function public.request_auto_draft(uuid) to authenticated;
