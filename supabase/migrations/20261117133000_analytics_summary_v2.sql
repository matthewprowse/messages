-- Analytics: analytics_summary v2, for the page's Usage and AI tabs. Replaces analytics_summary(from, to).
--
-- What changed from 20261028110400, and why:
--   * Totals (periods, daily, came_back, sizes, cost per person) come from the per user per day rollups
--     (20261117131000), not from a pass over every event. Only the groupings by event properties still read raw events.
--   * Retention and activation are gone from here. They were worked out from events inside the window only, so a
--     person absent for longer than the window looked new. analytics_health() does them from signup.
--   * The window is whole UTC days: p_from is the start of the earlier period, p_to the start of the day after the
--     last day shown. The page sends those; periods are split by day, so the totals and the groupings agree.
--   * "People" use analytics_is_person(): error, load_timing and empty_state, which a background tab sends, no longer
--     make someone active.
--   * p_exclude leaves out the owner and the accounts in analytics_config 'test_user_ids'.
--   * New: distinct_users (real people per feature, screen and error, where adding the groups would count a person
--     once for every group they appear in), dropped (events the rate limit discarded), cost_users (AI cost per
--     person over the period). Removed: the sync_lag percentile (nothing emits it).
--   * The percentiles come from one pass over the events, not eleven.
--   * Groups are capped at 200 per period and event name; the rest of a name's groups fold into one group with no
--     properties, whose count is right and whose people are the largest of the folded groups. Only triaged and
--     label_corrected ever reach the cap.
--   * Sessions are summed over days (a session that crosses midnight UTC counts on both days).
--
-- Returns one jsonb object:
--   from, to, mid
--   periods        {now: {users, sessions, opens, events, user_days}, before: {...}}
--   came_back      people active before who were active again now
--   daily          [{day, users, sessions}]
--   events         [{day, name, n, users, sums: {prop: sum}}]
--   groups         [{period, name, screen, props, n, users, nums: {prop: {n, sum, p50, p95}}}]
--   distinct_users [{period, metric, key, users}]  metrics: feature_used.feature, screen_view.screen, error.code_where
--   percentiles    [{period, metric, key, n, p50, p95}]  nearest-rank, as before
--   sizes          [{key, n}]  each person's latest size in the current period
--   summaries      {opened, original_after}
--   dropped        events discarded by the rate limit in the current period
--   cost_users     {users, total_micro, p50_micro, p90_micro, top: [{user, micro}]}  AI cost per person, current period
drop function if exists public.analytics_summary(timestamptz, timestamptz);

create or replace function public.analytics_summary(p_from timestamptz, p_to timestamptz, p_exclude boolean default false) returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_mid timestamptz;
  v_mid_day date;
  v_out jsonb;
begin
  if not public.is_analytics_owner() then
    raise exception 'analytics are for the owner only' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '800 days' then
    raise exception 'bad period' using errcode = '22023';
  end if;
  v_mid := p_to - (p_to - p_from) / 2;
  v_mid_day := (v_mid at time zone 'utc')::date;

  with
  excl as (select x.h from public.analytics_excluded_hashes() as x (h) where p_exclude),

  -- Totals from the rollups.
  ud as (
    select d.*, case when d.day >= v_mid_day then 'now' else 'before' end as period
    from public.analytics_user_days((p_from at time zone 'utc')::date, ((p_to - interval '1 second') at time zone 'utc')::date) d
    where not exists (select 1 from excl where excl.h = d.user_hash)
  ),
  periods as (
    select jsonb_object_agg(p.period, jsonb_build_object(
      'users', coalesce(s.users, 0), 'sessions', coalesce(s.sessions, 0), 'opens', coalesce(s.opens, 0),
      'events', coalesce(s.n, 0), 'user_days', coalesce(s.user_days, 0)
    )) as j
    from (values ('now'), ('before')) as p (period)
    left join (
      select period,
        count(distinct user_hash) filter (where active_events > 0) as users,
        coalesce(sum(sessions), 0) as sessions,
        coalesce(sum(opens), 0) as opens,
        coalesce(sum(events), 0) as n,
        count(*) filter (where active_events > 0) as user_days
      from ud group by period
    ) s on s.period = p.period
  ),
  came_back as (
    select count(*) as n
    from (select distinct user_hash from ud where active_events > 0 and period = 'before') b
    where exists (select 1 from ud e where e.active_events > 0 and e.period = 'now' and e.user_hash = b.user_hash)
  ),
  daily as (
    select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'users', d.users, 'sessions', d.sessions) order by d.day), '[]'::jsonb) as j
    from (
      select day, count(*) filter (where active_events > 0) as users, sum(sessions) as sessions
      from ud group by day having count(*) filter (where active_events > 0) > 0
    ) d
  ),
  sizes as (
    select coalesce(jsonb_agg(jsonb_build_object('key', size, 'n', n) order by n desc, size), '[]'::jsonb) as j
    from (
      select size, count(*) as n
      from (
        select distinct on (user_hash) user_hash, size
        from ud where active_events > 0 and period = 'now' and size is not null
        order by user_hash, day desc
      ) latest
      group by size
    ) z
  ),
  cost_by_user as (
    select user_hash, sum(ai_cost_micro) as micro from ud where period = 'now' group by user_hash having sum(ai_cost_micro) > 0
  ),
  cost_users as (
    select jsonb_build_object(
      'users', (select count(*) from cost_by_user),
      'total_micro', (select coalesce(sum(micro), 0) from cost_by_user),
      'p50_micro', coalesce((select percentile_disc(0.5) within group (order by micro) from cost_by_user), 0),
      'p90_micro', coalesce((select percentile_disc(0.9) within group (order by micro) from cost_by_user), 0),
      'top', coalesce((select jsonb_agg(jsonb_build_object('user', left(t.user_hash, 8), 'micro', t.micro) order by t.micro desc, t.user_hash)
        from (select * from cost_by_user order by micro desc, user_hash limit 5) t), '[]'::jsonb)
    ) as j
  ),

  -- The groupings by event properties still read the events.
  ev as (
    select
      e.id, e.at, e.user_hash, e.session, e.name, e.screen, e.props,
      (e.at at time zone 'utc')::date as day,
      case when (e.at at time zone 'utc')::date >= v_mid_day then 'now' else 'before' end as period,
      coalesce((
        select jsonb_object_agg(x.key, x.value) from jsonb_each(e.props) x where jsonb_typeof(x.value) <> 'number'
      ), '{}'::jsonb) as cats
    from public.analytics_events e
    where e.at >= p_from and e.at < p_to
      and not exists (select 1 from excl where excl.h = e.user_hash)
  ),
  numbers as (
    select e.period, e.day, e.name, e.screen, e.cats, x.key, (x.value #>> '{}')::numeric as v
    from ev e cross join lateral jsonb_each(e.props) x
    where jsonb_typeof(x.value) = 'number'
  ),

  day_sums as (
    select day, name, jsonb_object_agg(key, s) as sums
    from (select day, name, key, sum(v) as s from numbers group by day, name, key) z
    group by day, name
  ),
  events as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'day', c.day, 'name', c.name, 'n', c.n, 'users', c.users, 'sums', coalesce(s.sums, '{}'::jsonb)
    ) order by c.day, c.name), '[]'::jsonb) as j
    from (select day, name, count(*) as n, count(distinct user_hash) as users from ev group by day, name) c
    left join day_sums s on s.day = c.day and s.name = c.name
  ),

  group_nums as (
    select period, name, screen, cats,
      jsonb_object_agg(key, jsonb_build_object('n', n, 'sum', s, 'p50', p50, 'p95', p95)) as nums
    from (
      select period, name, screen, cats, key, count(*) as n, sum(v) as s,
        percentile_disc(0.5) within group (order by v) as p50,
        percentile_disc(0.95) within group (order by v) as p95
      from numbers group by period, name, screen, cats, key
    ) z
    group by period, name, screen, cats
  ),
  grouped_all as (
    select g.*, row_number() over (partition by g.period, g.name order by g.n desc, g.screen nulls last, g.cats::text) as rk
    from (
      select period, name, screen, cats, count(*) as n, count(distinct user_hash) as users
      from ev group by period, name, screen, cats
    ) g
  ),
  grouped as (
    select coalesce(jsonb_agg(r.o order by r.period, r.name, r.n desc), '[]'::jsonb) as j
    from (
      select a.period, a.name, a.n, jsonb_build_object(
        'period', a.period, 'name', a.name, 'screen', a.screen, 'props', a.cats, 'n', a.n, 'users', a.users,
        'nums', coalesce(gn.nums, '{}'::jsonb)
      ) as o
      from grouped_all a
      left join group_nums gn
        on gn.period = a.period and gn.name = a.name and gn.screen is not distinct from a.screen and gn.cats = a.cats
      where a.rk <= 200
      union all
      select a.period, a.name, sum(a.n), jsonb_build_object(
        'period', a.period, 'name', a.name, 'screen', null, 'props', '{}'::jsonb, 'n', sum(a.n), 'users', max(a.users), 'nums', '{}'::jsonb
      )
      from grouped_all a where a.rk > 200 group by a.period, a.name
    ) r
  ),

  distinct_users as (
    select coalesce(jsonb_agg(jsonb_build_object('period', period, 'metric', metric, 'key', key, 'users', users) order by period, metric, key), '[]'::jsonb) as j
    from (
      select period, metric, key, count(distinct user_hash) as users
      from (
        select period, user_hash, 'feature_used.feature' as metric, coalesce(props ->> 'feature', '') as key from ev where name = 'feature_used'
        union all
        select period, user_hash, 'screen_view.screen', coalesce(screen, '') from ev where name = 'screen_view'
        union all
        select period, user_hash, 'error.code_where', coalesce(props ->> 'code', '') || '|' || coalesce(props ->> 'where', '') from ev where name = 'error'
      ) u
      group by period, metric, key
    ) z
  ),

  -- One pass for every percentile: each event feeds the metrics that name it.
  pct_src as (
    select e.period, m.metric, m.key,
      case when jsonb_typeof(m.val) = 'number' then (m.val #>> '{}')::numeric else 0 end as v
    from ev e
    cross join lateral (
      select * from (values
        ('draft_sent.secs_to_send', '', e.props -> 'secs_to_send', e.name = 'draft_sent'),
        ('draft_shown.ms', '', e.props -> 'ms', e.name = 'draft_shown'),
        ('draft_sent.len_pct', '', e.props -> 'len_pct', e.name = 'draft_sent' and e.props -> 'edited' = 'true'::jsonb),
        ('reply_sent.hours_to_reply', '', e.props -> 'hours_to_reply', e.name = 'reply_sent'),
        ('brief_stop.pos_s', '', e.props -> 'pos_s', e.name = 'brief_stop' and e.props -> 'done' is distinct from 'true'::jsonb),
        ('screen_time.secs', coalesce(e.screen, ''), e.props -> 'secs', e.name = 'screen_time'),
        ('load_timing.ms', coalesce(e.props ->> 'what', ''), e.props -> 'ms', e.name = 'load_timing'),
        ('dialog_close.secs', coalesce(e.props ->> 'dialog', ''), e.props -> 'secs', e.name = 'dialog_close'),
        ('ai_call.ms', coalesce(e.props ->> 'feature', ''), e.props -> 'ms', e.name = 'ai_call' and case when jsonb_typeof(e.props -> 'ms') = 'number' then (e.props ->> 'ms')::numeric else 0 end > 0),
        ('ai_call.ms_prompt',
          coalesce(e.props ->> 'feature', '') || '|' || coalesce(e.props ->> 'model', '') || '|' || coalesce(e.props ->> 'prompt', ''),
          e.props -> 'ms', e.name = 'ai_call' and case when jsonb_typeof(e.props -> 'ms') = 'number' then (e.props ->> 'ms')::numeric else 0 end > 0)
      ) as t (metric, key, val, ok)
      where t.ok
    ) m
    where e.name in ('draft_sent', 'draft_shown', 'reply_sent', 'brief_stop', 'screen_time', 'load_timing', 'dialog_close', 'ai_call')
  ),
  percentiles as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'period', period, 'metric', metric, 'key', key, 'n', n, 'p50', p50, 'p95', p95
    ) order by period, metric, key), '[]'::jsonb) as j
    from (
      select period, metric, key, count(*) as n,
        percentile_disc(0.5) within group (order by v) as p50,
        percentile_disc(0.95) within group (order by v) as p95
      from pct_src group by period, metric, key
    ) z
  ),

  opened_seq as (
    select name, props ->> 'via' as via, lead(name) over (partition by session order by at, id) as next_name
    from ev
    where period = 'now' and session is not null and name in ('thread_opened', 'original_opened')
  ),
  summaries as (
    select
      count(*) filter (where name = 'thread_opened' and via = 'summary') as opened,
      count(*) filter (where name = 'thread_opened' and via = 'summary' and next_name = 'original_opened') as original_after
    from opened_seq
  )

  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'mid', v_mid,
    'periods', (select j from periods),
    'came_back', (select n from came_back),
    'daily', (select j from daily),
    'events', (select j from events),
    'groups', (select j from grouped),
    'distinct_users', (select j from distinct_users),
    'percentiles', (select j from percentiles),
    'sizes', (select j from sizes),
    'summaries', (select jsonb_build_object('opened', opened, 'original_after', original_after) from summaries),
    'dropped', coalesce((select sum(d.n) from public.analytics_dropped d where d.day >= v_mid_day), 0),
    'cost_users', (select j from cost_users)
  ) into v_out;

  return v_out;
end
$$;
revoke execute on function public.analytics_summary(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.analytics_summary(timestamptz, timestamptz, boolean) to authenticated;
