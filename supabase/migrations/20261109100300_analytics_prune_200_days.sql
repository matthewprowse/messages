-- analytics_prune kept raw events for 13 months before rolling them into analytics_daily. The Analytics page
-- (analytics_summary, 20261028110400) reads raw events only: it offers up to Last 90 Days and also reads the 90
-- days before that for the comparison, so it needs 180 days of raw events, and it counts sessions, event
-- properties, percentiles and weekly retention, none of which analytics_daily holds (it keeps only day, name,
-- count and people). So raw events cannot go down to 90 days without breaking the longest range; they go down to
-- 200 days, which keeps the whole 180 day window plus a margin.
-- The roll-up is unchanged: events older than the cutoff are counted into analytics_daily by day and name, then
-- deleted. Events already rolled up are gone, so nothing is counted twice. The first run after this deletes the
-- events between 200 days and 13 months old in one statement; that is a one time delete of old rows, and the
-- table has an index on at. Safe to run again.

create or replace function public.analytics_prune() returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.analytics_daily (day, name, n, users)
  select at::date, name, count(*), count(distinct user_hash)
  from public.analytics_events
  where at < now() - interval '200 days'
  group by 1, 2
  on conflict (day, name) do update
    set n = public.analytics_daily.n + excluded.n,
        users = greatest(public.analytics_daily.users, excluded.users);
  delete from public.analytics_events where at < now() - interval '200 days';
end
$$;
revoke execute on function public.analytics_prune() from public, anon, authenticated;
