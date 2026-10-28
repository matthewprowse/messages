-- Rate limit counters shared by every web server instance (the old in-memory limiter counted per instance,
-- which on Vercel barely limits). Fixed windows: one row per key and window. Only the service role calls
-- rate_limit_hit; the table has RLS on and no policies, so the app role cannot read or write it.

create table if not exists public.rate_limits (
  key text not null check (length(key) <= 200),
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;

create index if not exists rate_limits_window_start_idx on public.rate_limits (window_start);

-- Counts one hit for p_key and returns the seconds to wait: 0 when the hit is allowed, otherwise the time
-- left in the current window. Old windows are cleaned up on roughly one call in fifty.
create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
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
