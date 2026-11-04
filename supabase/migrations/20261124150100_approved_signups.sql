-- Sign-up is for approved emails only (owner decision, 2026-11-03: "Approved emails only").
--
-- The anon key can call Supabase Auth directly (signInWithOtp creates a user for an unknown email, and Google sign-in
-- does the same), so the rule lives in the database, not in the login page. A new auth.users row is refused unless its
-- email (lowercased; Auth stores it lowercased already):
--   * has a waitlist row the owner approved on /admin (waitlist.status = 'approved'), or
--   * has an open team invite: not accepted and not expired (workspace_invites; create_workspace makes one for a new
--     team's owner, invite_member for everyone else).
-- People who already have an account are not affected: signing in inserts no user. A Google sign-in for an existing
-- account links a new identity to the same user, which inserts no user either.
--
-- Auth inserts every user as supabase_auth_admin, whether from a sign-up or from the Admin API (dashboard Add User,
-- auth.admin.createUser), so the two cannot be told apart here and the rule applies to both: approve the email on the
-- waitlist (or invite it) before adding someone by hand. No app code creates users through the Admin API.
--
-- Auth turns the exception into a 500 "Database error saving new user" (and, after Google, an error in the address it
-- returns to); the login page shows that as "This Email Is Not On The Approved List Yet".

create function public.approved_signup_only() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
begin
  if v_email = '' or not (
    exists (select 1 from public.waitlist w where w.email = v_email and w.status = 'approved')
    or exists (select 1 from public.workspace_invites i where i.email = v_email and i.accepted_at is null and i.expires_at > now())
  ) then
    raise exception 'This email is not on the approved list yet' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.approved_signup_only() from public, anon, authenticated;

create trigger approved_signup_only before insert on auth.users
  for each row execute function public.approved_signup_only();
