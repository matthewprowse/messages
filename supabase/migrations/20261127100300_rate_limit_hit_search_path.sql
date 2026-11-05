-- rate_limit_hit gets the empty search_path every other definer function has (security audit 2026-11-04, Low).
--
-- 20261124140300_definer_hardening.sql moved every SECURITY DEFINER function to search_path = '' and fully qualified
-- names, and missed this one (20261102200000_rate_limits.sql: public, pg_temp). Its body already qualifies the one
-- table it touches, so nothing could be hijacked; this is the same body with the same setting as the rest, so the
-- next reader does not have to prove that again. Same grants: service role only, the app never calls it directly.

create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_count int;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'bad rate limit arguments';
  end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  if v_count > p_limit then
    return greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now()))))::int;
  end if;
  return 0;
end;
$$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
