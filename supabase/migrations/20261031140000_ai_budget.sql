-- AI fair usage (docs/PLAN.md, AI Fair Usage). The owner sets all of this in the admin panel:
--   * a monthly budget per seat in dollars, split into a share for each feature;
--   * a weekly limit for chosen features, as a percent of their monthly share, so a month is not spent in days;
--   * a one-off setup allowance for each newly connected account, for the first sort, search index and
--     learning, which counts toward neither the week nor the month.
-- People see percentages only, never dollars. The AI worker pauses a feature for a person once their
-- week or month share of it is spent.

create table public.ai_budget (
  id boolean primary key default true check (id),      -- one row
  monthly_usd numeric(8, 2) not null default 5 check (monthly_usd > 0),
  -- Percent of monthly_usd each feature may use. They should add up to 100.
  shares jsonb not null default '{"triage": 30, "draft": 35, "learn": 10, "brief": 10, "transcribe": 15}',
  -- Features with a weekly limit, which is weekly_pct of their monthly share. Weeks start on Monday (UTC).
  weekly_pct numeric(5, 1) not null default 40 check (weekly_pct > 0 and weekly_pct <= 100),
  weekly_features text[] not null default '{draft,transcribe}',
  -- Dollars for each account connected in the past setup_days, for sorting, search and learning.
  setup_usd numeric(8, 2) not null default 2 check (setup_usd >= 0),
  setup_days integer not null default 7 check (setup_days between 1 and 60),
  updated_at timestamptz not null default now()
);
insert into public.ai_budget default values;

alter table public.ai_budget enable row level security;
create policy "Owner reads AI budget" on public.ai_budget for select to authenticated using (public.is_analytics_owner());
create policy "Owner changes AI budget" on public.ai_budget for update to authenticated
  using (public.is_analytics_owner()) with check (public.is_analytics_owner());
revoke all on public.ai_budget from anon;
revoke insert, delete, truncate on public.ai_budget from authenticated;

-- Calls made under the setup allowance are marked, and left out of the week and month.
alter table public.ai_usage add column setup boolean not null default false;

-- Setup allowance left for a person: accounts connected in the window, what they get, and what is used.
create function public.ai_setup_state(p_user uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  with cfg as (select setup_usd, setup_days from public.ai_budget limit 1),
  fresh as (
    select count(*) as n from public.accounts a, cfg
    where a.user_id = p_user and a.created_at > now() - make_interval(days => cfg.setup_days)
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

-- Percent of the budget used: this month (UTC) overall and per feature, and this week for the features
-- with a weekly limit. Percentages only, so the dollar figures stay private.
create function public.ai_allowance_for(p_user uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  with cfg as (select monthly_usd, shares, weekly_pct, weekly_features from public.ai_budget limit 1),
  bounds as (
    select date_trunc('month', now() at time zone 'utc') at time zone 'utc' as m,
           date_trunc('week', now() at time zone 'utc') at time zone 'utc' as w
  ),
  mspent as (
    select u.feature, sum(u.cost_usd) as cost from public.ai_usage u, bounds b
    where u.user_id = p_user and not u.setup and u.created_at >= b.m group by u.feature
  ),
  wspent as (
    select u.feature, sum(u.cost_usd) as cost from public.ai_usage u, bounds b
    where u.user_id = p_user and not u.setup and u.created_at >= b.w group by u.feature
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
revoke execute on function public.ai_allowance_for(uuid) from public, anon, authenticated;
grant execute on function public.ai_allowance_for(uuid) to service_role;

-- The signed-in person's own.
create function public.my_ai_allowance() returns jsonb
  language sql stable security definer set search_path = ''
as $$ select public.ai_allowance_for(auth.uid()) $$;
revoke execute on function public.my_ai_allowance() from public, anon;
grant execute on function public.my_ai_allowance() to authenticated;
