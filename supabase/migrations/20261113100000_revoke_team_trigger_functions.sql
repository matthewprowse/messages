-- Trigger functions are never meant to be called over the API, but a function is executable by public, anon and
-- authenticated unless revoked. The team migrations of 3 to 5 November left three of them callable: members_drop_access,
-- members_end_cover and threads_share_inbox (all security definer). workspace_agents_follow_member, a trigger function
-- from the first team migration, was left the same way. Calling one over the API fails ("trigger functions can only be
-- called as triggers"), so nothing could be done with them, but the database advisor flags them and
-- 20261027144806_revoke_share_trigger_functions already revokes the earlier ones the same way.
-- A trigger runs its function without checking the caller's EXECUTE right (that is only checked when the trigger is
-- created), so the triggers keep working. Safe to run again.

revoke execute on function public.members_drop_access() from public, anon, authenticated;
revoke execute on function public.members_end_cover() from public, anon, authenticated;
revoke execute on function public.threads_share_inbox() from public, anon, authenticated;
revoke execute on function public.workspace_agents_follow_member() from public, anon, authenticated;
