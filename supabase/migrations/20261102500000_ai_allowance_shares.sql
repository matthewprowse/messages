-- What each feature's share of the AI budget is worth in dollars, for the AI worker's in-flight check
-- (docs/PLAN.md, AI Fair Usage, Code check). ai_allowance_for gives percentages only; with the dollars the worker can
-- hold the estimated cost of calls that are running against the share, so parallel calls cannot overshoot it.
-- Same pool rules as ai_allowance_for: a workspace member's budget is seats x monthly_usd. Dollars stay server side.
create or replace function public.ai_allowance_shares_for(p_user uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  with pool as (
    select coalesce(max(w.seats), 1) as seats
    from public.workspace_members me
    join public.workspaces w on w.id = me.workspace_id
    where me.user_id = p_user and me.status = 'active'
  ),
  cfg as (
    select c.monthly_usd * pool.seats as monthly_usd, c.shares, c.weekly_pct, c.weekly_features
    from public.ai_budget c, pool limit 1
  )
  select jsonb_build_object(
    'features', coalesce((
      select jsonb_object_agg(f.key, round(cfg.monthly_usd * f.value::numeric / 100, 4))
      from jsonb_each_text(cfg.shares) f
    ), '{}'::jsonb),
    'week_features', coalesce((
      select jsonb_object_agg(f.key, round(cfg.monthly_usd * f.value::numeric / 100 * cfg.weekly_pct / 100, 4))
      from jsonb_each_text(cfg.shares) f where f.key = any (cfg.weekly_features)
    ), '{}'::jsonb)
  )
  from cfg
$$;
revoke execute on function public.ai_allowance_shares_for(uuid) from public, anon, authenticated;
grant execute on function public.ai_allowance_shares_for(uuid) to service_role;
