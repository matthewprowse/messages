-- Security definer functions tightened (security audit 2026-11-03, Info).
--
--   1. The audit log triggers (audit_ai_budget, audit_flag, audit_setting, audit_waitlist, audit_workspace) must never be
--      callable through the API. 20261121110000 already revoked them at its end; the revoke is repeated here so this file
--      states it on its own and holds even if that line was skipped when it was applied by hand.
--   2. clear_snooze_on_inbound, note_label_removal and clear_label_removal are security definer triggers that ran with
--      search_path = public, so an object of the same name earlier on the path could stand in for what they call. Their
--      bodies already name everything in full (public.threads, public.labels, public.thread_label_removals), so only the
--      setting changes, to the empty search_path every other definer function uses. ALTER keeps the bodies and grants.
--   3. agent_has_left(public.threads) took a whole thread row from its caller and was granted to authenticated for the
--      Shared threads policy. Anyone signed in could call it with a made-up row (any workspace id, any user id) and learn
--      whether that person is an active member of that team. The policy now calls thread_agent_has_left(id), which reads
--      the row itself and answers only for a chat in the caller's own team (false otherwise), and the row version is no
--      longer callable by app users. Its other callers (team_last_at, work_chats, my_assigned_chats, thread_awaiting,
--      team_response_stats) are security definer, so they run as the owner and keep calling it unchanged.

-- 1
revoke execute on function public.audit_ai_budget(), public.audit_flag(), public.audit_setting(), public.audit_waitlist(), public.audit_workspace()
  from public, anon, authenticated;

-- 2
alter function public.clear_snooze_on_inbound() set search_path = '';
alter function public.note_label_removal() set search_path = '';
alter function public.clear_label_removal() set search_path = '';

-- 3
-- Whether the agent of this work chat has left its team, for a chat in the caller's own team only. A shared inbox chat
-- belongs to the inbox, so never. The same test as agent_has_left(public.threads).
create function public.thread_agent_has_left(p_thread uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select t.shared_by is distinct from 'account' and not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = t.workspace_id and m.user_id = t.user_id and m.status = 'active')
    from public.threads t
    where t.id = p_thread and t.workspace_id is not null and t.workspace_id = public.my_workspace_id()
  ), false)
$$;
revoke execute on function public.thread_agent_has_left(uuid) from public, anon;
-- The Shared threads policy calls it as the reader.
grant execute on function public.thread_agent_has_left(uuid) to authenticated;

-- 20261105100000's policy, with the row lookup moved into the function.
drop policy "Shared threads" on public.threads;
create policy "Shared threads" on public.threads for select to authenticated
  using (
    workspace_id = (select public.my_workspace_id()) and user_id <> (select auth.uid())
    and public.can_read_thread(id, workspace_id) and not public.thread_agent_has_left(id)
  );

revoke execute on function public.agent_has_left(public.threads) from authenticated;
