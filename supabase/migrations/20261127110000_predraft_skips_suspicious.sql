-- No pre-draft for a message triage flagged as suspicious (security audit 2026-11-04, Medium 3).
--
-- queue_auto_draft (20261126110000) checked that triage said the latest message needs a reply and is not junk, and
-- nothing else. A phishing or payment-change mail that asks a question passes both, so a reply was written ahead and
-- shown without a click. Now a verdict with suspicious set (payment_change, phishing or impersonation, which the
-- model or the header checks can raise and nothing can lower) gets no pre-draft; the person can still ask for a draft
-- by hand, where the fact guard and the review hold apply. Same body otherwise, same grants. The AI worker's own
-- candidate list (apps/ai/ai/triage_predraft.py) applies the same rule before it asks.

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
  -- Triage has read it and says it needs a reply and nothing about it looks like phishing, impersonation or a changed
  -- payment detail.
  if not exists (
    select 1 from public.message_ai a
    where a.message_id = v_msg.id and not a.junk and a.needs_reply and a.suspicious is null
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
