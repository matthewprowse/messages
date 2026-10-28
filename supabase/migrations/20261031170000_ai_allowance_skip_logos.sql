-- Company logos are shared by everyone and filed against the owner's account (ai_usage feature 'logos'). The
-- allowance is a person's own use, so it leaves them out, as the owner's per-person table and the AI worker do.
create or replace function public.ai_allowance_for(p_user uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  with cfg as (select monthly_usd, shares, weekly_pct, weekly_features from public.ai_budget limit 1),
  bounds as (
    select date_trunc('month', now() at time zone 'utc') at time zone 'utc' as m,
           date_trunc('week', now() at time zone 'utc') at time zone 'utc' as w
  ),
  mspent as (
    select u.feature, sum(u.cost_usd) as cost from public.ai_usage u, bounds b
    where u.user_id = p_user and not u.setup and u.feature <> 'logos' and u.created_at >= b.m group by u.feature
  ),
  wspent as (
    select u.feature, sum(u.cost_usd) as cost from public.ai_usage u, bounds b
    where u.user_id = p_user and not u.setup and u.feature <> 'logos' and u.created_at >= b.w group by u.feature
  ),
  weekly as (
    select f.key, f.value::numeric as share from cfg, jsonb_each_text(cfg.shares) f where f.key = any (cfg.weekly_features)
  )
  select jsonb_build_object(
    'used_pct', round(coalesce((select sum(cost) from mspent), 0) / cfg.monthly_usd * 100, 1),
    'resets_at', (select m + interval '1 month' from bounds),
    'features', coalesce((
      select jsonb_object_agg(f.key, round(coalesce(s.cost, 0) / nullif(cfg.monthly_usd * f.value::numeric / 100, 0) * 100, 1))
      from jsonb_each_text(cfg.shares) f left join mspent s on s.feature = f.key
    ), '{}'::jsonb),
    'week_pct', (
      select round(coalesce(sum(s.cost), 0) / nullif(cfg.monthly_usd * sum(w.share) / 100 * cfg.weekly_pct / 100, 0) * 100, 1)
      from weekly w left join wspent s on s.feature = w.key
    ),
    'week_resets_at', (select w + interval '7 days' from bounds),
    'week_features', coalesce((
      select jsonb_object_agg(w.key, round(coalesce(s.cost, 0) / nullif(cfg.monthly_usd * w.share / 100 * cfg.weekly_pct / 100, 0) * 100, 1))
      from weekly w left join wspent s on s.feature = w.key
    ), '{}'::jsonb)
  )
  from cfg
$$;
