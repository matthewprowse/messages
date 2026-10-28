-- The AI setup allowance was granted per accounts row created in the window, so disconnecting and reconnecting
-- (or deleting and re-adding) the same address earned it again. It is now granted once per person per
-- (provider, address), kept in ai_setup_grants, which survives the accounts row being removed.
-- The key is the address blind index when there is one, else the stored address. Dollars and days stay
-- admin-configurable in ai_budget (setup_usd, setup_days). Only providers that bring in messages count,
-- as in 20261031160000.

create table public.ai_setup_grants (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  address_key text not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, provider, address_key)
);
alter table public.ai_setup_grants enable row level security;
revoke all on public.ai_setup_grants from anon, authenticated;

-- Existing accounts: the earliest connection of each address keeps its grant time.
insert into public.ai_setup_grants (user_id, provider, address_key, granted_at)
select a.user_id, a.provider, coalesce(a.address_index, a.address), min(a.created_at)
from public.accounts a
where a.provider in ('icloud', 'gmail', 'outlook', 'whatsapp', 'imap', 'teams', 'zoom', 'google_meet', 'linkedin', 'instagram')
group by a.user_id, a.provider, coalesce(a.address_index, a.address)
on conflict do nothing;

create function public.record_ai_setup_grant() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.ai_setup_grants (user_id, provider, address_key)
  values (new.user_id, new.provider, coalesce(new.address_index, new.address))
  on conflict do nothing;
  return new;
end;
$$;
revoke execute on function public.record_ai_setup_grant() from public, anon, authenticated;

create trigger accounts_record_ai_setup_grant after insert on public.accounts
  for each row
  when (new.provider in ('icloud', 'gmail', 'outlook', 'whatsapp', 'imap', 'teams', 'zoom', 'google_meet', 'linkedin', 'instagram'))
  execute function public.record_ai_setup_grant();

create or replace function public.ai_setup_state(p_user uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  with cfg as (select setup_usd, setup_days from public.ai_budget limit 1),
  fresh as (
    select count(*) as n from public.ai_setup_grants g, cfg
    where g.user_id = p_user and g.granted_at > now() - make_interval(days => cfg.setup_days)
  )
  select jsonb_build_object(
    'accounts', fresh.n,
    'allowance', cfg.setup_usd * fresh.n,
    'spent', coalesce((
      select sum(u.cost_usd) from public.ai_usage u
      where u.user_id = p_user and u.setup and u.created_at > now() - make_interval(days => cfg.setup_days)
    ), 0)
  )
  from cfg, fresh
$$;
revoke execute on function public.ai_setup_state(uuid) from public, anon, authenticated;
grant execute on function public.ai_setup_state(uuid) to service_role;
