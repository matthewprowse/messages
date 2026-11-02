-- Analytics: analytics_health(p_to, p_exclude), the numbers behind the page's Health tab. Owner only.
--
-- Everything is worked out from the rollups (analytics_user_day, analytics_user_first, plus the raw tail since the
-- last roll up), from auth.users (signup date) and from accounts (what is connected), so a long absence, or events
-- pruned at 200 days, cannot make a returning user look new, and it costs users x days, not events.
-- Only people with Share Usage Data on are measured (the others record nothing). With p_exclude the owner and the
-- test accounts in analytics_config 'test_user_ids' are left out. Weeks are ISO weeks (Monday start) in UTC, the
-- last 12 including the current one, which is partial. "Active" is any use of the app (analytics_is_person);
-- "valued" is a draft sent or a reply sent, the cleaner signal of the product doing its job.
--
-- Returns one jsonb object:
--   as_of, measured (people measured), sharing_off
--   signups     [{week, n}]  new accounts per week, 12 weeks, everyone not excluded
--   funnel      {cohort, steps: [{key, users, p50_secs}]}  people who signed up in the last 90 days, and how many
--               reached each step (connected_account, first_sync_done, first_label_seen, first_draft_shown,
--               first_draft_sent, first_reply_sent), with the median seconds from signup. A step is counted when it
--               happened at any time, so the funnel is not a strict order.
--   first_draft [{week, signups, sent, p50_secs, p90_secs}]  by signup week
--   retention   [{start, size, later_active: [n..], later_valued: [n..]}]  by signup week, oldest first; entry k is
--               how many of the group were active (or valued) k + 1 weeks after the signup week
--   weekly      [{week, active, valued}]  distinct people per week
--   stickiness  {wau, mau, dau_avg, resurrected, curve: [{days, users}]}  last 7 and 28 days; dau_avg is the mean
--               daily active people over 28 days; resurrected were active in the last 7 days after 28 quiet days;
--               curve is people by how many of the last 28 days they were active on
--   churn       [{user, last_seen, signed_up, accounts, account_error, drafts_sent, ai_cost_micro}]  people active in
--               the week before last who were not active since, newest loss first, 25 at most; user is the first 8
--               characters of the keyed hash
--   value       {now: {active, replies, drafts_sent, triaged, junk_cleared}, before: {...}}  the last 7 days and the 7 before
--   channels    [{mix, users, active_7d, valued_28d}]  people by what they have connected (email, whatsapp, linkedin,
--               instagram, joined with +, or none)
create or replace function public.analytics_health(p_to timestamptz, p_exclude boolean default false) returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (p_to at time zone 'utc')::date;
  v_week date := date_trunc('week', p_to at time zone 'utc')::date;
  v_first_week date;
  v_out jsonb;
begin
  if not public.is_analytics_owner() then
    raise exception 'analytics are for the owner only' using errcode = '42501';
  end if;
  if p_to is null then
    raise exception 'bad period' using errcode = '22023';
  end if;
  v_first_week := v_week - 77;

  with
  excl as (select x.h from public.analytics_excluded_hashes() as x (h) where p_exclude),
  weeks as (select v_first_week + 7 * g as wk from generate_series(0, 11) as g),
  everyone as (
    select u.id as uid, public.analytics_user_hash(u.id) as h, u.created_at as signed_at, coalesce(p.share_usage, true) as sharing
    from auth.users u left join public.profiles p on p.user_id = u.id
  ),
  everyone_kept as (select * from everyone e where not exists (select 1 from excl where excl.h = e.h)),
  users as (select * from everyone_kept where sharing),
  ud as (
    select * from public.analytics_user_days(v_first_week, v_today) d
    where not exists (select 1 from excl where excl.h = d.user_hash)
  ),
  fp as (
    select f.h,
      min(f.t) filter (where f.nm = 'first_sync_done') as t_sync,
      min(f.t) filter (where f.nm = 'triaged') as t_label,
      min(f.t) filter (where f.nm = 'draft_shown') as t_shown,
      min(f.t) filter (where f.nm = 'draft_sent') as t_sent,
      min(f.t) filter (where f.nm = 'reply_sent') as t_reply
    from public.analytics_firsts() f group by f.h
  ),
  ac as (
    select a.user_id, min(a.created_at) as t_connect, bool_or(a.last_synced_at is not null) as synced,
      bool_or(a.status = 'error') as errored,
      count(*) as n,
      string_agg(distinct case when a.provider in ('icloud', 'gmail', 'outlook', 'imap') then 'email' else a.provider end, '+'
        order by case when a.provider in ('icloud', 'gmail', 'outlook', 'imap') then 'email' else a.provider end) as mix
    from public.accounts a
    where a.provider in ('icloud', 'gmail', 'outlook', 'imap', 'whatsapp', 'linkedin', 'instagram')
    group by a.user_id
  ),

  -- Signups per ISO week.
  signups as (
    select coalesce(jsonb_agg(jsonb_build_object('week', w.wk, 'n', coalesce(s.n, 0)) order by w.wk), '[]'::jsonb) as j
    from weeks w
    left join (
      select date_trunc('week', signed_at at time zone 'utc')::date as wk, count(*) as n from everyone_kept group by 1
    ) s on s.wk = w.wk
  ),

  -- Activation funnel: people who signed up in the last 90 days.
  fc as (select u.* from users u where u.signed_at >= p_to - interval '90 days'),
  sv as (
    select c.h, c.signed_at, s.ord, s.key, s.t, s.reached
    from fc c
    left join fp on fp.h = c.h
    left join ac on ac.user_id = c.uid
    cross join lateral (values
      (1, 'connected_account', ac.t_connect, ac.t_connect is not null),
      (2, 'first_sync_done', fp.t_sync, fp.t_sync is not null or coalesce(ac.synced, false)),
      (3, 'first_label_seen', fp.t_label, fp.t_label is not null),
      (4, 'first_draft_shown', fp.t_shown, fp.t_shown is not null),
      (5, 'first_draft_sent', fp.t_sent, fp.t_sent is not null),
      (6, 'first_reply_sent', fp.t_reply, fp.t_reply is not null)
    ) as s (ord, key, t, reached)
  ),
  funnel as (
    select jsonb_build_object(
      'cohort', (select count(*) from fc),
      'steps', coalesce((
        select jsonb_agg(jsonb_build_object('key', z.key, 'users', z.users, 'p50_secs', z.p50) order by z.ord)
        from (
          select ord, key, count(*) filter (where reached) as users,
            percentile_disc(0.5) within group (order by greatest(0, extract(epoch from (t - signed_at)))::bigint) filter (where reached and t is not null) as p50
          from sv group by ord, key
        ) z
      ), '[]'::jsonb)
    ) as j
  ),

  -- Time to the first draft sent, by signup week.
  first_draft as (
    select coalesce(jsonb_agg(jsonb_build_object('week', z.wk, 'signups', z.signups, 'sent', z.sent, 'p50_secs', z.p50, 'p90_secs', z.p90) order by z.wk), '[]'::jsonb) as j
    from (
      select date_trunc('week', u.signed_at at time zone 'utc')::date as wk, count(*) as signups,
        count(fp.t_sent) as sent,
        percentile_disc(0.5) within group (order by greatest(0, extract(epoch from (fp.t_sent - u.signed_at)))::bigint) filter (where fp.t_sent is not null) as p50,
        percentile_disc(0.9) within group (order by greatest(0, extract(epoch from (fp.t_sent - u.signed_at)))::bigint) filter (where fp.t_sent is not null) as p90
      from users u left join fp on fp.h = u.h
      where u.signed_at >= v_first_week::timestamp at time zone 'utc'
      group by 1
    ) z
  ),

  -- Retention from signup week.
  weekly_user as (
    select d.user_hash as h, date_trunc('week', d.day::timestamp)::date as wk,
      bool_or(d.active_events > 0) as a, bool_or(d.valued > 0) as v
    from ud d group by 1, 2
  ),
  cohort as (
    select u.h, date_trunc('week', u.signed_at at time zone 'utc')::date as wk
    from users u where u.signed_at >= v_first_week::timestamp at time zone 'utc'
  ),
  cohorts as (select wk, count(*) as size from cohort group by wk),
  retention as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'start', c.wk, 'size', c.size,
      'later_active', (
        select coalesce(jsonb_agg(z.n order by z.k), '[]'::jsonb) from (
          select k, (select count(*) from cohort c2 join weekly_user w on w.h = c2.h and w.wk = c.wk + 7 * k where c2.wk = c.wk and w.a) as n
          from generate_series(1, (v_week - c.wk) / 7) as k
        ) z
      ),
      'later_valued', (
        select coalesce(jsonb_agg(z.n order by z.k), '[]'::jsonb) from (
          select k, (select count(*) from cohort c2 join weekly_user w on w.h = c2.h and w.wk = c.wk + 7 * k where c2.wk = c.wk and w.v) as n
          from generate_series(1, (v_week - c.wk) / 7) as k
        ) z
      )
    ) order by c.wk), '[]'::jsonb) as j
    from cohorts c
  ),

  weekly as (
    select coalesce(jsonb_agg(jsonb_build_object('week', w.wk, 'active', coalesce(s.a, 0), 'valued', coalesce(s.v, 0)) order by w.wk), '[]'::jsonb) as j
    from weeks w
    left join (select wk, count(*) filter (where a) as a, count(*) filter (where v) as v from weekly_user group by wk) s on s.wk = w.wk
  ),

  -- Stickiness over the last 28 days.
  act28 as (select d.user_hash as h, d.day from ud d where d.active_events > 0 and d.day > v_today - 28),
  curve as (
    select coalesce(jsonb_agg(jsonb_build_object('days', z.d, 'users', z.n) order by z.d), '[]'::jsonb) as j
    from (select d, count(*) as n from (select h, count(distinct day) as d from act28 group by h) x group by d) z
  ),
  stick as (
    select jsonb_build_object(
      'wau', (select count(distinct h) from act28 where day > v_today - 7),
      'mau', (select count(distinct h) from act28),
      'dau_avg', round((select count(*) from act28)::numeric / 28, 2),
      'resurrected', (
        select count(*) from (select distinct h from act28 where day > v_today - 7) r
        where not exists (select 1 from ud d where d.user_hash = r.h and d.active_events > 0 and d.day between v_today - 34 and v_today - 7)
          and exists (select 1 from ud d where d.user_hash = r.h and d.active_events > 0 and d.day < v_today - 34)
      ),
      'curve', (select j from curve)
    ) as j
  ),

  -- Churn: active in the week before last, nothing since.
  last_seen as (
    select d.user_hash as h, max(d.day) as seen, sum(d.drafts_sent) as drafts, sum(d.ai_cost_micro) as cost
    from ud d where d.active_events > 0 group by 1
  ),
  churn as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'user', left(z.h, 8), 'last_seen', z.seen, 'signed_up', (z.signed_at at time zone 'utc')::date,
      'accounts', coalesce(z.n, 0), 'account_error', coalesce(z.errored, false), 'drafts_sent', z.drafts, 'ai_cost_micro', z.cost
    ) order by z.seen desc, z.h), '[]'::jsonb) as j
    from (
      select l.h, l.seen, l.drafts, l.cost, u.signed_at, ac.n, ac.errored
      from last_seen l
      join users u on u.h = l.h
      left join ac on ac.user_id = u.uid
      where l.seen between v_today - 27 and v_today - 7
      order by l.seen desc, l.h
      limit 25
    ) z
  ),

  -- Value delivered: the last 7 days against the 7 before.
  val as (
    select p.period, count(distinct d.user_hash) filter (where d.active_events > 0) as active,
      coalesce(sum(d.replies), 0) as replies, coalesce(sum(d.drafts_sent), 0) as drafts_sent,
      coalesce(sum(d.triaged), 0) as triaged, coalesce(sum(d.junk_cleared), 0) as junk_cleared
    from (values ('now', v_today - 6, v_today), ('before', v_today - 13, v_today - 7)) as p (period, a, b)
    left join ud d on d.day between p.a and p.b
    group by p.period
  ),
  value as (
    select jsonb_object_agg(period, jsonb_build_object('active', active, 'replies', replies, 'drafts_sent', drafts_sent, 'triaged', triaged, 'junk_cleared', junk_cleared)) as j
    from val
  ),

  -- Channel mix: what people have connected, and whether they are still around.
  channels as (
    select coalesce(jsonb_agg(jsonb_build_object('mix', z.mix, 'users', z.users, 'active_7d', z.active_7d, 'valued_28d', z.valued_28d) order by z.users desc, z.mix), '[]'::jsonb) as j
    from (
      select coalesce(ac.mix, 'none') as mix, count(*) as users,
        count(*) filter (where exists (select 1 from ud d where d.user_hash = u.h and d.active_events > 0 and d.day > v_today - 7)) as active_7d,
        count(*) filter (where exists (select 1 from ud d where d.user_hash = u.h and d.valued > 0 and d.day > v_today - 28)) as valued_28d
      from users u left join ac on ac.user_id = u.uid
      group by 1
    ) z
  )

  select jsonb_build_object(
    'as_of', p_to,
    'measured', (select count(*) from users),
    'sharing_off', (select count(*) from everyone_kept where not sharing),
    'signups', (select j from signups),
    'funnel', (select j from funnel),
    'first_draft', (select j from first_draft),
    'retention', (select j from retention),
    'weekly', (select j from weekly),
    'stickiness', (select j from stick),
    'churn', (select j from churn),
    'value', (select j from value),
    'channels', (select j from channels)
  ) into v_out;

  return v_out;
end
$$;
revoke execute on function public.analytics_health(timestamptz, boolean) from public, anon;
grant execute on function public.analytics_health(timestamptz, boolean) to authenticated;
