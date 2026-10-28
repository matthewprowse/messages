-- Three fixes to AI setup accounting (docs/PLAN.md, AI Fair Usage):
--   1. The setup allowance counted every connected account, calendars and task lists included, so one
--      person with five connections got five allowances. It now counts accounts that bring in messages.
--   2. Setup work done before the allowance existed was never marked, so a person's first import showed
--      up in full against their month. It is marked now, by the same rule the worker uses.
--   3. AI Usage by Person shows which accounts each sign-in has connected.

-- 1. Accounts that bring in mail or messages. Calendars, task lists and reminders do not.
create or replace function public.ai_setup_state(p_user uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  with cfg as (select setup_usd, setup_days from public.ai_budget limit 1),
  fresh as (
    select count(*) as n from public.accounts a, cfg
    where a.user_id = p_user
      and a.provider in ('icloud', 'gmail', 'outlook', 'whatsapp', 'imap', 'teams', 'zoom', 'google_meet', 'linkedin', 'instagram')
      and a.created_at > now() - make_interval(days => cfg.setup_days)
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

-- 2. Mark sorting and learning from each person's first setup_days as setup, oldest first, until their
--    allowance (setup_usd for each message account connected in that time) is used up. Safe to run again.
with cfg as (select setup_usd, setup_days from public.ai_budget limit 1),
mail as (
  select user_id, created_at from public.accounts
  where provider in ('icloud', 'gmail', 'outlook', 'whatsapp', 'imap', 'teams', 'zoom', 'google_meet', 'linkedin', 'instagram')
),
first_connected as (select user_id, min(created_at) as starts from mail group by user_id),
allowance as (
  select f.user_id, f.starts, cfg.setup_usd * (
    select count(*) from mail m where m.user_id = f.user_id and m.created_at < f.starts + make_interval(days => cfg.setup_days)
  ) as amount
  from first_connected f, cfg
),
running as (
  select u.id, u.user_id, sum(u.cost_usd) over (partition by u.user_id order by u.created_at, u.id) as total
  from public.ai_usage u
  join allowance a on a.user_id = u.user_id, cfg
  where u.feature in ('triage', 'learn') and not u.setup
    and u.created_at >= a.starts and u.created_at < a.starts + make_interval(days => cfg.setup_days)
)
update public.ai_usage u set setup = true
from running r join allowance a on a.user_id = r.user_id
where u.id = r.id and r.total <= a.amount;

-- 3. The owner's per-person table also lists the accounts each sign-in has connected.
drop function public.ai_usage_by_user();
create function public.ai_usage_by_user()
returns table (
  user_id uuid, email text, accounts text[], month_usd numeric, week_usd numeric, day_usd numeric, setup_usd numeric,
  calls integer, month_pct numeric, by_feature jsonb, flag text
)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select monthly_usd, flag_multiple, flag_day_usd from public.ai_budget limit 1),
  b as (
    select date_trunc('month', now() at time zone 'utc') at time zone 'utc' as m,
           date_trunc('week', now() at time zone 'utc') at time zone 'utc' as w,
           date_trunc('day', now() at time zone 'utc') at time zone 'utc' as d
  ),
  per as (
    select u.user_id,
           coalesce(sum(u.cost_usd) filter (where not u.setup), 0) as month_usd,
           coalesce(sum(u.cost_usd) filter (where not u.setup and u.created_at >= b.w), 0) as week_usd,
           coalesce(sum(u.cost_usd) filter (where not u.setup and u.created_at >= b.d), 0) as day_usd,
           coalesce(sum(u.cost_usd) filter (where u.setup), 0) as setup_usd,
           coalesce(sum(u.cost_usd) filter (where u.created_at >= b.d), 0) as day_all,
           count(*)::integer as calls
    from public.ai_usage u, b
    where u.created_at >= b.m and u.feature <> 'logos'   -- logos are shared and filed against the owner
    group by u.user_id
  ),
  median as (select coalesce(percentile_cont(0.5) within group (order by month_usd), 0) as v from per)
  select p.user_id,
         (select au.email::text from auth.users au where au.id = p.user_id),
         coalesce((select array_agg(a.provider order by a.created_at) from public.accounts a where a.user_id = p.user_id), '{}'),
         round(p.month_usd, 4), round(p.week_usd, 4), round(p.day_usd, 4), round(p.setup_usd, 4),
         p.calls,
         round(p.month_usd / cfg.monthly_usd * 100, 1),
         coalesce((
           select jsonb_object_agg(f.feature, round(f.cost, 4))
           from (
             select u.feature, sum(u.cost_usd) filter (where not u.setup) as cost
             from public.ai_usage u, b
             where u.user_id = p.user_id and u.created_at >= b.m and u.feature <> 'logos'
             group by u.feature
           ) f
         ), '{}'::jsonb),
         case
           when p.day_all > cfg.flag_day_usd then 'Over the daily amount'
           when p.month_usd > 1 and p.month_usd > cfg.flag_multiple * median.v then 'Far above the middle person'
         end
  from per p, cfg, median
  where public.is_analytics_owner()
  order by p.month_usd desc
$$;
revoke execute on function public.ai_usage_by_user() from public, anon;
grant execute on function public.ai_usage_by_user() to authenticated;
