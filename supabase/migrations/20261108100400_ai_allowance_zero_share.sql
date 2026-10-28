-- ai_allowance_for divided by nullif(share, 0), so a feature whose share is 0 (or whose weekly allowance works
-- out to 0) came back as a null percent, which the AI client could read as "no limit". It now returns 100 for
-- those: the allowance is used up. For a feature in shares with a share of 0, features.<name> and
-- week_features.<name> are 100 (never null), and 100 or more means paused to the worker. The result shape is
-- otherwise the same. A feature missing from shares has no key in the result at all; the worker treats a
-- missing key as exhausted. ai_allowance_shares_for needs no change: a share of 0 already gives 0 dollars.
-- Body is the workspace-aware version from 20261101100000_workspaces.sql, with the percent expressions
-- wrapped in coalesce(..., 100). It also puts back the exclusion of the 'logos' feature from the spend that
-- 20261031170000 made and the workspaces rewrite dropped by accident: company logos are shared by everyone and
-- filed against the owner, so they are not one person's use (the AI worker exempts them the same way, see
-- BUDGET_EXEMPT in apps/ai/ai/gemini.py). Grants are kept by create or replace.
create or replace function public.ai_allowance_for(p_user uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  with pool as (
    select coalesce(array_agg(m.user_id), array[p_user]) as users, coalesce(max(w.seats), 1) as seats
    from public.workspace_members me
    join public.workspaces w on w.id = me.workspace_id
    join public.workspace_members m on m.workspace_id = me.workspace_id and m.status = 'active'
    where me.user_id = p_user and me.status = 'active'
  ),
  cfg as (
    select c.monthly_usd * pool.seats as monthly_usd, c.shares, c.weekly_pct, c.weekly_features
    from public.ai_budget c, pool limit 1
  ),
  bounds as (
    select date_trunc('month', now() at time zone 'utc') at time zone 'utc' as m,
           date_trunc('week', now() at time zone 'utc') at time zone 'utc' as w
  ),
  mspent as (
    select u.feature, sum(u.cost_usd) as cost from public.ai_usage u, bounds b, pool
    where u.user_id = any (pool.users) and not u.setup and u.feature <> 'logos' and u.created_at >= b.m group by u.feature
  ),
  wspent as (
    select u.feature, sum(u.cost_usd) as cost from public.ai_usage u, bounds b, pool
    where u.user_id = any (pool.users) and not u.setup and u.feature <> 'logos' and u.created_at >= b.w group by u.feature
  ),
  weekly as (
    select f.key, f.value::numeric as share from cfg, jsonb_each_text(cfg.shares) f where f.key = any (cfg.weekly_features)
  )
  select jsonb_build_object(
    'used_pct', round(coalesce((select sum(cost) from mspent), 0) / cfg.monthly_usd * 100, 1),
    'resets_at', (select m + interval '1 month' from bounds),
    'features', coalesce((
      select jsonb_object_agg(f.key, coalesce(round(coalesce(s.cost, 0) / nullif(cfg.monthly_usd * f.value::numeric / 100, 0) * 100, 1), 100))
      from jsonb_each_text(cfg.shares) f left join mspent s on s.feature = f.key
    ), '{}'::jsonb),
    'week_pct', (
      select round(coalesce(sum(s.cost), 0) / nullif(cfg.monthly_usd * sum(w.share) / 100 * cfg.weekly_pct / 100, 0) * 100, 1)
      from weekly w left join wspent s on s.feature = w.key
    ),
    'week_resets_at', (select w + interval '7 days' from bounds),
    'week_features', coalesce((
      select jsonb_object_agg(w.key, coalesce(round(coalesce(s.cost, 0) / nullif(cfg.monthly_usd * w.share / 100 * cfg.weekly_pct / 100, 0) * 100, 1), 100))
      from weekly w left join wspent s on s.feature = w.key
    ), '{}'::jsonb)
  )
  from cfg
$$;
