-- is_analytics_owner() is the user ID stored in analytics_config (20261028110400). Harden it: the account must
-- also have a confirmed email, so an unverified sign-in can never be the owner. The owner address is unchanged.
-- If the owner ID was not stored yet because the email was unconfirmed then, store it now when confirmed.
insert into public.analytics_config (key, value)
select 'owner_user_id', u.id::text
from auth.users u
where lower(u.email) = 'mattprowse03@gmail.com' and u.email_confirmed_at is not null
order by u.created_at
limit 1
on conflict (key) do nothing;

create or replace function public.is_analytics_owner() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select c.value = (select auth.uid())::text
      and exists (select 1 from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null)
    from public.analytics_config c
    where c.key = 'owner_user_id'
  ), false)
$$;
revoke execute on function public.is_analytics_owner() from public, anon;
grant execute on function public.is_analytics_owner() to authenticated;
