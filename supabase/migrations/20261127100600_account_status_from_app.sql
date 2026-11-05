-- The app can set an account's status only to what it legitimately sets (security audit 2026-11-04, Low).
--
-- 20261022230000_send_from_and_compose.sql grants update (status, send_addresses) on accounts to signed-in users, so
-- a changed client could set any status: for instance 'connected' on an account the worker marked 'disconnected' after
-- its credentials were deleted, making the worker retry it. The web app itself writes exactly two values
-- (apps/web/lib/app-store/save-undo.ts savedAccountPatch, and whatsapp-link.tsx): 'disconnected' to pause or remove,
-- and 'connecting' to resume, which the worker picks up. Everything else is the workers' (service role). The trigger
-- refuses any other value from the authenticated role and leaves the workers untouched.

create function public.account_status_from_app() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  if new.status is distinct from old.status and new.status not in ('disconnected', 'connecting') then
    raise exception 'An account can only be paused or resumed from the app' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.account_status_from_app() from public, anon, authenticated;

create trigger account_status_from_app before update of status on public.accounts
  for each row execute function public.account_status_from_app();
