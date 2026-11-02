-- Admin fixes (wave 3).
--
-- 1. ai_status: one row the AI worker writes when the Gemini billing breaker trips or recovers, so Admin can show
--    "Gemini billing paused since 14:02". Owner reads it; only the service role writes it.
-- 2. ai_usage_by_user pools a team like enforcement does (ai_allowance_for): a member's percent is the whole team's
--    spend over seats x the monthly budget, the "middle person" is a middle seat (one value per team or solo person),
--    and each row lists the features already paused. New columns: team_name, team_seats, paused.
-- 3. ai_budget checks its shares when they change: every value 0 to 100, adding up to 100, and weekly features
--    must be features that have a share. A typo here pauses a feature for everyone.
-- 4. create_workspace marks the waitlist request approved in the same transaction, so a failure between the two
--    steps cannot leave a team with a pending request.

-- 1. Billing state
create table public.ai_status (
  id boolean primary key default true check (id),
  billing_paused_since timestamptz,
  billing_checked_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.ai_status (id) values (true);

alter table public.ai_status enable row level security;
revoke all on public.ai_status from public, anon, authenticated;
grant select on public.ai_status to authenticated;
create policy "Owner reads AI status" on public.ai_status for select to authenticated using (public.is_analytics_owner());

-- 2. Usage by person, pooled by team
drop function public.ai_usage_by_user();
create function public.ai_usage_by_user()
returns table (
  user_id uuid, email text, accounts text[], month_usd numeric, week_usd numeric, day_usd numeric, setup_usd numeric,
  calls integer, month_pct numeric, by_feature jsonb, flag text, team_name text, team_seats integer, paused text[]
)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select monthly_usd, shares, flag_multiple, flag_day_usd from public.ai_budget limit 1),
  b as (
    select date_trunc('month', now() at time zone 'utc') at time zone 'utc' as m,
           date_trunc('week', now() at time zone 'utc') at time zone 'utc' as w,
           date_trunc('day', now() at time zone 'utc') at time zone 'utc' as d
  ),
  used as (  -- the month's rows, read once; logos are shared and filed against the owner
    select u.user_id, u.feature, u.cost_usd, u.setup, u.created_at
    from public.ai_usage u, b where u.created_at >= b.m and u.feature <> 'logos'
  ),
  per as (
    select u.user_id,
           coalesce(sum(u.cost_usd) filter (where not u.setup), 0) as month_usd,
           coalesce(sum(u.cost_usd) filter (where not u.setup and u.created_at >= b.w), 0) as week_usd,
           coalesce(sum(u.cost_usd) filter (where not u.setup and u.created_at >= b.d), 0) as day_usd,
           coalesce(sum(u.cost_usd) filter (where u.setup), 0) as setup_usd,
           coalesce(sum(u.cost_usd) filter (where u.created_at >= b.d), 0) as day_all,
           count(*)::integer as calls
    from used u, b group by u.user_id
  ),
  feat as (
    select u.user_id, u.feature, sum(u.cost_usd) filter (where not u.setup) as cost
    from used u group by u.user_id, u.feature
  ),
  by_feat as (select f.user_id, jsonb_object_agg(f.feature, round(f.cost, 4)) as j from feat f group by f.user_id),
  -- A person's pool: their active team, else themselves (as ai_allowance_for does).
  pooled as (
    select p.user_id,
           coalesce(m.workspace_id::text, p.user_id::text) as pool_key,
           coalesce(m.seats, 1) as seats,
           m.name as team_name
    from per p
    left join lateral (
      select wm.workspace_id, w.seats, w.name from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
      where wm.user_id = p.user_id and wm.status = 'active' limit 1
    ) m on true
  ),
  pool_total as (
    select pl.pool_key, max(pl.seats) as seats, sum(p.month_usd) as spend
    from pooled pl join per p using (user_id) group by pl.pool_key
  ),
  pool_feat as (
    select pl.pool_key, f.feature, sum(f.cost) as cost
    from pooled pl join feat f using (user_id) group by pl.pool_key, f.feature
  ),
  median as (select coalesce(percentile_cont(0.5) within group (order by spend / seats), 0) as v from pool_total)
  select p.user_id,
         (select au.email::text from auth.users au where au.id = p.user_id),
         coalesce((select array_agg(a.provider order by a.created_at) from public.accounts a where a.user_id = p.user_id), '{}'),
         round(p.month_usd, 4), round(p.week_usd, 4), round(p.day_usd, 4), round(p.setup_usd, 4),
         p.calls,
         round(t.spend / (cfg.monthly_usd * t.seats) * 100, 1),
         coalesce(bf.j, '{}'::jsonb),
         case
           when p.day_all > cfg.flag_day_usd then 'Over the daily amount'
           when t.spend / t.seats > 1 and t.spend / t.seats > cfg.flag_multiple * median.v then 'Far above the middle person'
         end,
         pl.team_name,
         pl.seats::integer,
         coalesce((
           select array_agg(s.key order by s.key)
           from jsonb_each_text(cfg.shares) s
           where coalesce((select pf.cost from pool_feat pf where pf.pool_key = pl.pool_key and pf.feature = s.key), 0)
                 >= cfg.monthly_usd * t.seats * s.value::numeric / 100
         ), '{}')
  from per p
  join pooled pl on pl.user_id = p.user_id
  join pool_total t on t.pool_key = pl.pool_key
  left join by_feat bf on bf.user_id = p.user_id
  cross join cfg cross join median
  where public.is_analytics_owner()
  order by p.month_usd desc
$$;
revoke execute on function public.ai_usage_by_user() from public, anon;
grant execute on function public.ai_usage_by_user() to authenticated;

-- 3. Budget content checks. Only when shares or weekly_features change, so a row saved before this existed can still
--    have its other fields edited.
create function public.ai_budget_check() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.shares is not distinct from old.shares and new.weekly_features is not distinct from old.weekly_features then
    return new;
  end if;
  if jsonb_typeof(new.shares) <> 'object' then
    raise exception 'shares must be an object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(new.shares) s where jsonb_typeof(s.value) <> 'number' or (s.value #>> '{}')::numeric not between 0 and 100) then
    raise exception 'every share must be a number from 0 to 100' using errcode = '22023';
  end if;
  if (select round(coalesce(sum((s.value #>> '{}')::numeric), 0) * 100) from jsonb_each(new.shares) s) <> 10000 then
    raise exception 'shares must add up to 100' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.weekly_features) w where not (new.shares ? w)) then
    raise exception 'a weekly limit names a feature with no share' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger ai_budget_check before insert or update on public.ai_budget
  for each row execute function public.ai_budget_check();

-- 4. Approving a team request approves the waitlist row in the same transaction.
create or replace function public.create_workspace(p_name text, p_seats integer, p_owner_email text, p_waitlist_id uuid default null)
  returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
  v_workspace uuid;
begin
  if not public.is_analytics_owner() then
    raise exception 'Only the owner of this app can create a team' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 200 then
    raise exception 'Enter the business name' using errcode = '22023';
  end if;
  if position('@' in v_email) < 2 or length(v_email) > 320 then
    raise exception 'Enter a valid email address for the owner' using errcode = '22023';
  end if;
  if p_waitlist_id is not null and exists (select 1 from public.workspaces w where w.waitlist_id = p_waitlist_id) then
    raise exception 'A team was already created for this request' using errcode = '23505';
  end if;

  insert into public.workspaces (name, seats, waitlist_id)
  values (v_name, greatest(5, coalesce(p_seats, 5)), p_waitlist_id)
  returning id into v_workspace;

  if p_waitlist_id is not null then
    update public.waitlist set status = 'approved' where id = p_waitlist_id and status <> 'approved';
  end if;

  return jsonb_build_object(
    'workspace_id', v_workspace,
    'token', public.issue_invite(v_workspace, v_email, 'owner', (select auth.uid()))
  );
end;
$$;
revoke execute on function public.create_workspace(text, integer, text, uuid) from public, anon;
grant execute on function public.create_workspace(text, integer, text, uuid) to authenticated;
