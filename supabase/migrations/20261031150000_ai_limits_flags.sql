-- More AI fair usage settings, all set in the admin panel (docs/PLAN.md, AI Fair Usage), and the owner's
-- view of what each person is using.
--   * regen_per_hour: draft requests a person can make for one conversation in an hour;
--   * auto_drafts_per_day: automatic drafts made for one conversation in a day;
--   * summaries_per_day: contact and company summaries made for one person in a day (learning);
--   * flag_multiple, flag_day_usd: when an account is flagged as using far more than most.

alter table public.ai_budget
  add column regen_per_hour integer not null default 10 check (regen_per_hour >= 1),
  add column auto_drafts_per_day integer not null default 3 check (auto_drafts_per_day >= 1),
  add column summaries_per_day integer not null default 50 check (summaries_per_day >= 1),
  add column flag_multiple numeric(5, 1) not null default 5 check (flag_multiple >= 1),
  add column flag_day_usd numeric(8, 2) not null default 2 check (flag_day_usd > 0);

-- What each person has used this month, for the owner only (empty for anyone else). Includes their
-- sign-in email, as the waitlist does. Dollars are for the owner; people only ever see percentages.
-- A flag is a number to look at, not a block: more than flag_day_usd in a day (setup included), or more
-- than flag_multiple times the middle person's month and over $1.
create function public.ai_usage_by_user()
returns table (
  user_id uuid, email text, month_usd numeric, week_usd numeric, day_usd numeric, setup_usd numeric,
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
