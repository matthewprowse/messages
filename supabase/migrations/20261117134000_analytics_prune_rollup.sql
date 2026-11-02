-- analytics_prune(): roll the days up first, then delete raw events older than 200 days.
--
-- The nightly job used to count old events into analytics_daily (day, name, count, people) and delete them. Nothing
-- ever read analytics_daily, and its "people" column was wrong for a merge across runs (greatest() of two distinct
-- counts). The per user per day rollups (20261117131000) replace it: they hold what the page needs and are filled
-- before anything is deleted, so no day is lost. The writer to analytics_daily is dropped; the table and the rows
-- already in it stay (append only migrations), unused.
-- Old drop counts go too: they only matter for the periods the page can show.
create or replace function public.analytics_prune() returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  perform public.analytics_rollup();
  delete from public.analytics_events where at < now() - interval '200 days';
  delete from public.analytics_dropped where day < (now() at time zone 'utc')::date - 400;
end
$$;
revoke execute on function public.analytics_prune() from public, anon, authenticated;
