-- analytics_owner_id() reads the stored owner id, the same way is_analytics_owner() does (security audit 2026-11-03,
-- Low, owner).
--
-- It used to pick any auth.users row with the owner's email (limit 1, no order, confirmed or not), so an unconfirmed
-- sign-up with that address could be the account Konva's own Gemini costs for logos are filed against. Now it returns
-- analytics_config.owner_user_id (20261028110400, stored once the email was confirmed in 20261102100500), and only while
-- that account's email is confirmed; null otherwise. Its one caller (apps/ai/ai/logos.py) already treats null as "no
-- owner". Signature, security definer, search_path and grants (service role only) are unchanged.

create or replace function public.analytics_owner_id() returns uuid
  language sql stable security definer set search_path = ''
as $$
  select u.id
  from public.analytics_config c
  join auth.users u on u.id::text = c.value
  where c.key = 'owner_user_id' and u.email_confirmed_at is not null
$$;
revoke execute on function public.analytics_owner_id() from public, anon, authenticated;
grant execute on function public.analytics_owner_id() to service_role;
