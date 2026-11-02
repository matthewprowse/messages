-- Analytics: per user per day rollups, so the Health tab and the summary's totals do not scan every event.
--
-- analytics_user_day: one row per (user, UTC day): event counts, sessions, app opens and the few counts the Health
--   tab needs (value delivered, AI cost). Small: users x days. Kept for good; it holds counts only.
-- analytics_user_first: the first time each user did each kind of event (first draft sent, first label seen...), so
--   "time to first draft sent" and the activation funnel still work after raw events are pruned at 200 days.
-- analytics_rollup(): rolls the complete UTC days since the last run (analytics_config 'rollup_through') from the raw
--   events into those tables. It runs from analytics_prune() every night, before old events are deleted, and once at
--   the end of this file for the events already stored. Safe to run again: it replaces the days it covers.
-- analytics_user_days(from, to) / analytics_firsts(): what the readers use. They return the rolled up days plus the
--   days since 'rollup_through' worked out from the raw events (a day or two), so today's numbers are never missing
--   and a night the job did not run is still right.
-- analytics_is_person(): the one definition of an event that means a person was using the app, here and in
--   analytics_summary(). The workers' own events, and background ones a tab sends while nobody looks (error,
--   load_timing, empty_state), do not. account_connect counts only when it came from a screen.
-- analytics_excluded_hashes(): the owner and the accounts listed in analytics_config 'test_user_ids' (comma separated
--   user IDs), for the page's "Exclude Owner And Test Accounts" switch.

create or replace function public.analytics_is_person(p_name text, p_screen text) returns boolean
  language sql immutable set search_path = ''
as $$
  select case
    when p_name = 'account_connect' then p_screen is not null
    else p_name not in ('ai_call', 'triaged', 'sync_error', 'send_result', 'wa_reconnect', 'first_sync_done', 'error', 'load_timing', 'empty_state')
  end
$$;

create table if not exists public.analytics_user_day (
  user_hash text not null,
  day date not null,
  events integer not null,
  active_events integer not null,
  sessions integer not null,
  opens integer not null,
  valued integer not null,
  drafts_sent integer not null,
  replies integer not null,
  triaged integer not null,
  junk_cleared integer not null,
  errors integer not null,
  ai_calls integer not null,
  ai_cost_micro bigint not null,
  size text,
  primary key (user_hash, day)
);
create index if not exists analytics_user_day_day_idx on public.analytics_user_day (day);

create table if not exists public.analytics_user_first (
  user_hash text not null,
  name text not null,
  first_at timestamptz not null,
  primary key (user_hash, name)
);

alter table public.analytics_user_day enable row level security;
alter table public.analytics_user_first enable row level security;
create policy "Owner reads analytics user days" on public.analytics_user_day for select to authenticated using (public.is_analytics_owner());
create policy "Owner reads analytics user firsts" on public.analytics_user_first for select to authenticated using (public.is_analytics_owner());
revoke all on public.analytics_user_day, public.analytics_user_first from anon;
revoke insert, update, delete, truncate on public.analytics_user_day, public.analytics_user_first from authenticated;

-- Raw events of the UTC days p_from..p_to as user-day rows. The column order is the table's.
create or replace function public.analytics_aggregate_days(p_from date, p_to date) returns setof public.analytics_user_day
  language sql stable security definer set search_path = ''
as $$
  select
    e.user_hash,
    (e.at at time zone 'utc')::date,
    count(*)::integer,
    (count(*) filter (where public.analytics_is_person(e.name, e.screen)))::integer,
    (count(distinct e.session) filter (where public.analytics_is_person(e.name, e.screen)))::integer,
    (count(*) filter (where e.name = 'app_open'))::integer,
    (count(*) filter (where e.name in ('draft_sent', 'reply_sent')))::integer,
    (count(*) filter (where e.name = 'draft_sent'))::integer,
    (count(*) filter (where e.name = 'reply_sent'))::integer,
    (count(*) filter (where e.name = 'triaged'))::integer,
    (count(*) filter (where e.name = 'thread_action' and e.props ->> 'action' in ('junk', 'junk_many')))::integer,
    (count(*) filter (where e.name = 'error'))::integer,
    (count(*) filter (where e.name = 'ai_call'))::integer,
    coalesce(sum(case when e.name = 'ai_call' and jsonb_typeof(e.props -> 'cost_micro') = 'number' then (e.props ->> 'cost_micro')::numeric end), 0)::bigint,
    (array_agg(e.size order by e.at desc, e.id desc) filter (where e.size is not null))[1]
  from public.analytics_events e
  where e.at >= p_from::timestamp at time zone 'utc' and e.at < (p_to + 1)::timestamp at time zone 'utc'
  group by 1, 2
$$;
revoke execute on function public.analytics_aggregate_days(date, date) from public, anon, authenticated;

create or replace function public.analytics_rollup() returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_through date := (now() at time zone 'utc')::date - 1;
  v_from date;
begin
  v_from := coalesce(
    (select c.value::date + 1 from public.analytics_config c where c.key = 'rollup_through'),
    (select (min(e.at) at time zone 'utc')::date from public.analytics_events e)
  );
  if v_from is null or v_from > v_through then
    return;
  end if;
  delete from public.analytics_user_day where day >= v_from;
  insert into public.analytics_user_day (user_hash, day, events, active_events, sessions, opens, valued, drafts_sent, replies, triaged, junk_cleared, errors, ai_calls, ai_cost_micro, size)
  select * from public.analytics_aggregate_days(v_from, v_through);
  insert into public.analytics_user_first as f (user_hash, name, first_at)
  select e.user_hash, e.name, min(e.at)
  from public.analytics_events e
  where e.at >= v_from::timestamp at time zone 'utc' and e.at < (v_through + 1)::timestamp at time zone 'utc'
  group by 1, 2
  on conflict (user_hash, name) do update set first_at = least(f.first_at, excluded.first_at);
  insert into public.analytics_config (key, value) values ('rollup_through', v_through::text)
  on conflict (key) do update set value = excluded.value;
end
$$;
revoke execute on function public.analytics_rollup() from public, anon, authenticated;

create or replace function public.analytics_user_days(p_from date, p_to date) returns setof public.analytics_user_day
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_through date := coalesce((select c.value::date from public.analytics_config c where c.key = 'rollup_through'), date '1970-01-01');
begin
  return query select * from public.analytics_user_day d where d.day between p_from and least(p_to, v_through);
  if p_to > v_through then
    return query select * from public.analytics_aggregate_days(greatest(p_from, v_through + 1), p_to);
  end if;
end
$$;
revoke execute on function public.analytics_user_days(date, date) from public, anon, authenticated;

create or replace function public.analytics_firsts() returns table (h text, nm text, t timestamptz)
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_through date := coalesce((select c.value::date from public.analytics_config c where c.key = 'rollup_through'), date '1970-01-01');
begin
  return query
  select f.uh, f.n, min(f.at)
  from (
    select u.user_hash as uh, u.name as n, u.first_at as at from public.analytics_user_first u
    union all
    select e.user_hash, e.name, min(e.at) from public.analytics_events e
    where e.at >= (v_through + 1)::timestamp at time zone 'utc' group by 1, 2
  ) f
  group by f.uh, f.n;
end
$$;
revoke execute on function public.analytics_firsts() from public, anon, authenticated;

create or replace function public.analytics_excluded_hashes() returns setof text
  language sql stable security definer set search_path = ''
as $$
  select public.analytics_user_hash(c.value::uuid) from public.analytics_config c where c.key = 'owner_user_id'
  union
  select public.analytics_user_hash(trim(x)::uuid)
  from public.analytics_config c, unnest(string_to_array(c.value, ',')) x
  where c.key = 'test_user_ids' and trim(x) ~ '^[0-9a-f-]{36}$'
$$;
revoke execute on function public.analytics_excluded_hashes() from public, anon, authenticated;

-- A person who asks to be forgotten leaves the rollups too.
create or replace function public.analytics_forget(p_user uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  h text := public.analytics_user_hash(p_user);
begin
  delete from public.analytics_events where user_hash = h;
  delete from public.analytics_user_day where user_hash = h;
  delete from public.analytics_user_first where user_hash = h;
  delete from public.analytics_rate where user_hash = h;
end
$$;
revoke execute on function public.analytics_forget(uuid) from public, anon, authenticated;
grant execute on function public.analytics_forget(uuid) to service_role;

-- The events already stored, rolled up once now.
select public.analytics_rollup();
