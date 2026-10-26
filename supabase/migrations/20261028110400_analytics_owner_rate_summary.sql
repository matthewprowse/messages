-- Product analytics, round two.
--
-- 1. The owner is a stored user ID, not an email in the sign-in token. analytics_config.owner_user_id
--    holds it; it is filled here from the owner's account when that account exists and its email is
--    confirmed. If it does not exist yet, nobody can read analytics until the row is set by hand:
--      insert into public.analytics_config (key, value) values ('owner_user_id', '<uuid>')
--        on conflict (key) do update set value = excluded.value;
-- 2. track() takes at most 50 events a call (as before) and 120 a minute per user; the excess is dropped
--    without an error. The workers' analytics_record() is not limited (first syncs triage in bulk).
-- 3. analytics_summary(p_from, p_to): the Analytics page's counts worked out in the database, for the
--    owner only, so the page no longer pages through every event. See the function for its shape.
-- 4. An (at, id) index for the page's keyset reads, which also covers what the (at desc) index did.

-- ---------------------------------------------------------------------------
-- 1. Owner by user ID
-- ---------------------------------------------------------------------------

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
    from public.analytics_config c
    where c.key = 'owner_user_id'
  ), false)
$$;
revoke execute on function public.is_analytics_owner() from public, anon;
grant execute on function public.is_analytics_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Rate limit on track()
-- ---------------------------------------------------------------------------

-- Events each user's app has sent in the current minute. Nobody but track() reads or writes it.
create table if not exists public.analytics_rate (
  user_hash text primary key,
  window_start timestamptz not null,
  n integer not null
);
alter table public.analytics_rate enable row level security;
revoke all on public.analytics_rate from anon, authenticated;

create or replace function public.track(p_session text, p_screen text, p_size text, p_version text, p_events jsonb) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_hash text;
  v_used integer;
  v_take integer;
  per_call constant integer := 50;
  per_minute constant integer := 120;
begin
  if v_user is null or p_events is null or jsonb_typeof(p_events) is distinct from 'array' then
    return;
  end if;
  if jsonb_array_length(p_events) = 0 then
    return;
  end if;
  v_hash := public.analytics_user_hash(v_user);

  -- A new minute starts the count again. The row lock taken here makes calls from one user wait their turn.
  insert into public.analytics_rate as r (user_hash, window_start, n)
  values (v_hash, now(), 0)
  on conflict (user_hash) do update
    set window_start = case when r.window_start <= now() - interval '1 minute' then now() else r.window_start end,
        n = case when r.window_start <= now() - interval '1 minute' then 0 else r.n end
  returning r.n into v_used;

  v_take := least(per_call, per_minute - v_used, jsonb_array_length(p_events));
  if v_take <= 0 then
    return;
  end if;
  update public.analytics_rate set n = n + v_take where user_hash = v_hash;

  perform public.analytics_insert(v_user, p_session, p_screen, p_size, p_version, (
    select coalesce(jsonb_agg(a.e order by a.i), '[]'::jsonb)
    from jsonb_array_elements(p_events) with ordinality as a (e, i)
    where a.i <= v_take
  ));
end
$$;
revoke execute on function public.track(text, text, text, text, jsonb) from public, anon;
grant execute on function public.track(text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. analytics_summary
-- ---------------------------------------------------------------------------

-- The window is the period shown and the one just before it, as the page loads now: p_from is the start
-- of the earlier period, p_to is now. Events at or after the midpoint are period 'now', the rest 'before'.
-- Days are UTC dates. "People" leaves out events the workers write on their own (the WORKER_EVENTS list
-- in packages/analytics/src/stats.ts; keep the two in step), except account_connect from a screen.
--
-- Returns one jsonb object:
--   periods        {now: {users, sessions, opens, events, user_days}, before: {...}}  users and sessions
--                  are people; opens counts app_open; user_days is distinct (user, day) of people
--   came_back      people active before who were active again now
--   daily          [{day, users, sessions}]  people per day, whole window
--   events         [{day, name, n, users, sums: {prop: sum}}]  every event, numeric props summed
--   groups         [{period, name, screen, props, n, users, nums: {prop: {n, sum, p50, p95}}}]  events
--                  grouped by period, name, screen and every non-numeric prop (strings, booleans, lists);
--                  users is distinct within the group; percentiles are nearest-rank, as in stats.ts
--   percentiles    [{period, metric, key, n, p50, p95}]  for the medians the page shows across groups:
--                  draft_sent.secs_to_send, draft_shown.ms, draft_sent.len_pct (edited only),
--                  reply_sent.hours_to_reply, brief_stop.pos_s (not done only), sync_lag.secs,
--                  screen_time.secs (key screen), load_timing.ms (key what), dialog_close.secs (key
--                  dialog), ai_call.ms (key feature, ms > 0), ai_call.ms_prompt (key feature|model|prompt)
--   sizes          [{key, n}]  each person's latest size in the current period
--   summaries      {opened, original_after}  thread_opened via summary now, and of those, how many were
--                  followed by original_opened next in the same session
--   activation     {active, connected, sent_draft}  people active now; of them, who ever connected an
--                  account (first_sync_done, or account_connect with outcome done) or sent a draft in
--                  the window
--   retention      [{weeks_ago, start, size, later: [n, ...]}]  weekly groups by the week a person was
--                  first seen (counted back from p_to; the oldest week is not a group), newest 8 groups,
--                  oldest first; later[k] is how many were seen k + 1 weeks after
create or replace function public.analytics_summary(p_from timestamptz, p_to timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_mid timestamptz;
  v_weeks integer;
  v_out jsonb;
begin
  if not public.is_analytics_owner() then
    raise exception 'analytics are for the owner only' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '800 days' then
    raise exception 'bad period' using errcode = '22023';
  end if;
  v_mid := p_to - (p_to - p_from) / 2;
  v_weeks := greatest(1, ceil(extract(epoch from (p_to - p_from)) / 604800)::integer);

  with ev as (
    select
      e.id, e.at, e.user_hash, e.session, e.name, e.screen, e.size, e.props,
      (e.at at time zone 'utc')::date as day,
      case when e.at >= v_mid then 'now' else 'before' end as period,
      (e.name not in ('ai_call', 'triaged', 'sync_error', 'send_result', 'wa_reconnect', 'first_sync_done', 'sync_lag', 'account_connect')
        or (e.name = 'account_connect' and e.screen is not null)) as person,
      coalesce((
        select jsonb_object_agg(x.key, x.value) from jsonb_each(e.props) x where jsonb_typeof(x.value) <> 'number'
      ), '{}'::jsonb) as cats
    from public.analytics_events e
    where e.at >= p_from and e.at <= p_to
  ),
  numbers as (
    select e.period, e.day, e.name, e.screen, e.cats, x.key,
      case when jsonb_typeof(x.value) = 'number' then (x.value #>> '{}')::numeric end as v
    from ev e cross join lateral jsonb_each(e.props) x
    where jsonb_typeof(x.value) = 'number'
  ),

  periods as (
    select jsonb_object_agg(p.period, jsonb_build_object(
      'users', coalesce(s.users, 0), 'sessions', coalesce(s.sessions, 0), 'opens', coalesce(s.opens, 0),
      'events', coalesce(s.n, 0), 'user_days', coalesce(s.user_days, 0)
    )) as j
    from (values ('now'), ('before')) as p (period)
    left join (
      select period,
        count(distinct user_hash) filter (where person) as users,
        count(distinct session) filter (where person) as sessions,
        count(*) filter (where name = 'app_open') as opens,
        count(*) as n,
        count(distinct (user_hash, day)) filter (where person) as user_days
      from ev group by period
    ) s on s.period = p.period
  ),
  came_back as (
    select count(*) as n
    from (select distinct user_hash from ev where person and period = 'before') b
    where exists (select 1 from ev e where e.person and e.period = 'now' and e.user_hash = b.user_hash)
  ),

  daily as (
    select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'users', d.users, 'sessions', d.sessions) order by d.day), '[]'::jsonb) as j
    from (
      select day, count(distinct user_hash) as users, count(distinct session) as sessions
      from ev where person group by day
    ) d
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
  grouped as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'period', g.period, 'name', g.name, 'screen', g.screen, 'props', g.cats, 'n', g.n, 'users', g.users,
      'nums', coalesce(gn.nums, '{}'::jsonb)
    ) order by g.period, g.name, g.n desc), '[]'::jsonb) as j
    from (
      select period, name, screen, cats, count(*) as n, count(distinct user_hash) as users
      from ev group by period, name, screen, cats
    ) g
    left join group_nums gn
      on gn.period = g.period and gn.name = g.name and gn.screen is not distinct from g.screen and gn.cats = g.cats
  ),

  pct_src as (
    select period, metric, key,
      case when jsonb_typeof(val) = 'number' then (val #>> '{}')::numeric else 0 end as v
    from (
      select period, 'draft_sent.secs_to_send' as metric, '' as key, props -> 'secs_to_send' as val from ev where name = 'draft_sent'
      union all
      select period, 'draft_shown.ms', '', props -> 'ms' from ev where name = 'draft_shown'
      union all
      select period, 'draft_sent.len_pct', '', props -> 'len_pct' from ev where name = 'draft_sent' and props -> 'edited' = 'true'::jsonb
      union all
      select period, 'reply_sent.hours_to_reply', '', props -> 'hours_to_reply' from ev where name = 'reply_sent'
      union all
      select period, 'brief_stop.pos_s', '', props -> 'pos_s' from ev where name = 'brief_stop' and props -> 'done' is distinct from 'true'::jsonb
      union all
      select period, 'sync_lag.secs', '', props -> 'secs' from ev where name = 'sync_lag'
      union all
      select period, 'screen_time.secs', coalesce(screen, ''), props -> 'secs' from ev where name = 'screen_time'
      union all
      select period, 'load_timing.ms', coalesce(props ->> 'what', ''), props -> 'ms' from ev where name = 'load_timing'
      union all
      select period, 'dialog_close.secs', coalesce(props ->> 'dialog', ''), props -> 'secs' from ev where name = 'dialog_close'
      union all
      select period, 'ai_call.ms', coalesce(props ->> 'feature', ''), props -> 'ms' from ev
      where name = 'ai_call' and case when jsonb_typeof(props -> 'ms') = 'number' then (props ->> 'ms')::numeric else 0 end > 0
      union all
      select period, 'ai_call.ms_prompt',
        coalesce(props ->> 'feature', '') || '|' || coalesce(props ->> 'model', '') || '|' || coalesce(props ->> 'prompt', ''),
        props -> 'ms' from ev
      where name = 'ai_call' and case when jsonb_typeof(props -> 'ms') = 'number' then (props ->> 'ms')::numeric else 0 end > 0
    ) src
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

  sizes as (
    select coalesce(jsonb_agg(jsonb_build_object('key', size, 'n', n) order by n desc, size), '[]'::jsonb) as j
    from (
      select size, count(*) as n
      from (
        select distinct on (user_hash) user_hash, size
        from ev where person and period = 'now' and size is not null
        order by user_hash, at desc, id desc
      ) latest
      group by size
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
  ),

  active_now as (
    select distinct user_hash from ev where person and period = 'now'
  ),
  activation as (
    select
      count(*) as active,
      count(*) filter (where exists (
        select 1 from ev e
        where e.user_hash = a.user_hash
          and (e.name = 'first_sync_done' or (e.name = 'account_connect' and e.props ->> 'outcome' = 'done'))
      )) as connected,
      count(*) filter (where exists (
        select 1 from ev e where e.user_hash = a.user_hash and e.name = 'draft_sent'
      )) as sent_draft
    from active_now a
  ),

  seen as (
    select distinct user_hash,
      least(v_weeks - 1, greatest(0, floor(extract(epoch from (p_to - at)) / 604800)::integer)) as w
    from ev where person
  ),
  firsts as (
    select user_hash, max(w) as first_week from seen group by user_hash
  ),
  cohorts as (
    select first_week, count(*) as size
    from firsts
    where first_week between 1 and v_weeks - 2
    group by first_week
    order by first_week
    limit 8
  ),
  retention as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'weeks_ago', c.first_week,
      'start', ((p_to - (c.first_week + 1) * interval '7 days') at time zone 'utc')::date,
      'size', c.size,
      'later', (
        select coalesce(jsonb_agg(z.n order by z.k), '[]'::jsonb)
        from (
          select k, (
            select count(*) from firsts f
            join seen s on s.user_hash = f.user_hash and s.w = c.first_week - 1 - k
            where f.first_week = c.first_week
          ) as n
          from generate_series(0, c.first_week - 1) as k
        ) z
      )
    ) order by c.first_week desc), '[]'::jsonb) as j
    from cohorts c
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
    'percentiles', (select j from percentiles),
    'sizes', (select j from sizes),
    'summaries', (select jsonb_build_object('opened', opened, 'original_after', original_after) from summaries),
    'activation', (select jsonb_build_object('active', active, 'connected', connected, 'sent_draft', sent_draft) from activation),
    'retention', (select j from retention)
  ) into v_out;

  return v_out;
end
$$;
revoke execute on function public.analytics_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_summary(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Index
-- ---------------------------------------------------------------------------

create index if not exists analytics_events_at_id_idx on public.analytics_events (at, id);
drop index if exists public.analytics_events_at_idx;
