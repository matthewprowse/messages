-- A sender with no automatic way out leaves its request at 'manual': the person unsubscribes on the
-- sender's own page, which nothing reports back. They confirm it here, and the request becomes done.
create or replace function public.confirm_unsubscribe(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.unsubscribes
  set status = 'done', done_at = now()
  where id = p_id and user_id = (select auth.uid()) and status = 'manual';
$$;

revoke execute on function public.confirm_unsubscribe(uuid) from public, anon;
grant execute on function public.confirm_unsubscribe(uuid) to authenticated;
