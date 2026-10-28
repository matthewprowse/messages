-- A person could insert any number of status = 'pending' drafts, and the AI worker takes the oldest few at a
-- time, so a flood of pending rows could starve everyone else's drafts. This trigger refuses a new pending
-- draft when the person already has 20 pending ones. New Email and New WhatsApp drafts (compose drafts, with
-- no conversation) are rows in the same drafts table, so the same cap covers them.
-- Only requests from the app are capped: whether the write is the app's is read from the request token
-- (auth.jwt() role), as 20261028110300_brief_request_cap does, because current_user is the function owner
-- inside security definer code. The AI worker and other service-role writes are not limited. The one-per-user
-- advisory lock stops two inserts at once from both slipping under the cap.
-- Note: the pre-drafting function that queues an automatic draft runs for the signed-in person, so it is
-- capped too; by then at most 20 drafts are waiting anyway, and the error is check_violation.
create or replace function public.limit_pending_drafts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap constant integer := 20;
begin
  if new.status is distinct from 'pending' then
    return new;
  end if;
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('drafts_pending:' || new.user_id::text, 0));
  if (select count(*) from public.drafts d where d.user_id = new.user_id and d.status = 'pending') >= v_cap then
    raise exception 'Too many drafts are waiting. Wait for the current ones to finish'
      using errcode = '23514', hint = 'At most 20 drafts can be pending at once.';
  end if;
  return new;
end;
$$;
revoke execute on function public.limit_pending_drafts() from public, anon, authenticated;

drop trigger if exists drafts_limit_pending on public.drafts;
create trigger drafts_limit_pending before insert on public.drafts
  for each row execute function public.limit_pending_drafts();
