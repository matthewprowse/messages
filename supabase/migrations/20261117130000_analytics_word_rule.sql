-- Analytics: a stricter code word, and a count of events the rate limit drops.
--
-- 1. The word rule. A plain code word was lowercase letters, digits and _ . : - starting with a letter. That let a
--    lowercase first name ("sam") or a dotted word ("jane.doe", "acme.co") through. A dot is now allowed only
--    between two digits ("gemini-2.5-flash", "v0.0.12"), which is how model names and versions use it and not how a
--    local part or a domain looks. A single lowercase word such as a first name still cannot be told from a code
--    word by shape: the web app allow-lists the free-form sources (dialog names, field names, empty-state titles)
--    in packages/analytics/src/allowed.ts, and the AI worker only sends words it wrote. This file is the last line.
--    analytics_word_ok() is the one place the rule lives; the clean-up of props and the insert both call it.
-- 2. analytics_insert() inserts in one statement instead of a loop and a lookup per event.
-- 3. track() counts the events it drops (over 50 in a call or 120 a minute) in analytics_dropped, by day, so the
--    loss is visible on the page. Before this the excess vanished without a trace.
-- Rows already stored are not touched.

create or replace function public.analytics_word_ok(p text) returns boolean
  language sql immutable set search_path = ''
as $$
  select p is not null and length(p) <= 40 and p ~ '^[a-z]([a-z0-9_:-]|[0-9]\.(?=[0-9]))*$'
$$;

create or replace function public.analytics_clean_props(p jsonb) returns jsonb
  language plpgsql immutable set search_path = ''
as $$
declare
  k text;
  v jsonb;
  kept jsonb := '{}'::jsonb;
  n int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return kept;
  end if;
  for k, v in select * from jsonb_each(p) loop
    exit when n >= 16;
    continue when k !~ '^[a-z][a-z0-9_]{0,29}$';
    if jsonb_typeof(v) = 'number' then
      continue when abs((v #>> '{}')::numeric) > 1000000000;
      kept := kept || jsonb_build_object(k, v);
    elsif jsonb_typeof(v) = 'boolean' then
      kept := kept || jsonb_build_object(k, v);
    elsif jsonb_typeof(v) = 'string' then
      continue when not public.analytics_word_ok(v #>> '{}');
      kept := kept || jsonb_build_object(k, v);
    elsif jsonb_typeof(v) = 'array' then
      kept := kept || jsonb_build_object(k, coalesce((
        select jsonb_agg(e) from (
          select e from jsonb_array_elements(v) e
          where jsonb_typeof(e) = 'string' and public.analytics_word_ok(e #>> '{}')
          limit 12
        ) s
      ), '[]'::jsonb));
    else
      continue;
    end if;
    n := n + 1;
  end loop;
  return kept;
end
$$;
revoke execute on function public.analytics_clean_props(jsonb) from public, anon, authenticated;
revoke execute on function public.analytics_word_ok(text) from public, anon, authenticated;

create or replace function public.analytics_insert(
  p_user uuid, p_session text, p_screen text, p_size text, p_version text, p_events jsonb
) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  h text;
begin
  if p_user is null or p_events is null or jsonb_typeof(p_events) <> 'array' then
    return;
  end if;
  if not coalesce((select share_usage from public.profiles where user_id = p_user), true) then
    return;
  end if;
  h := public.analytics_user_hash(p_user);
  insert into public.analytics_events (user_hash, session, name, screen, size, app_version, props)
  select
    h,
    case when p_session ~ '^[a-z0-9-]{1,40}$' then p_session end,
    a.e ->> 'name',
    case when public.analytics_word_ok(coalesce(a.e ->> 'screen', p_screen)) then coalesce(a.e ->> 'screen', p_screen) end,
    case when p_size in ('phone', 'tablet', 'desktop') then p_size end,
    case when public.analytics_word_ok(p_version) then p_version end,
    public.analytics_clean_props(a.e -> 'props')
  from jsonb_array_elements(p_events) with ordinality as a (e, i)
  where a.i <= 50 and jsonb_typeof(a.e) = 'object' and (a.e ->> 'name') ~ '^[a-z][a-z0-9_]{1,39}$'
  order by a.i;
end
$$;
revoke execute on function public.analytics_insert(uuid, text, text, text, text, jsonb) from public, anon, authenticated;

-- Events dropped by the rate limit, by UTC day. Written by track(), read by analytics_summary().
create table if not exists public.analytics_dropped (
  day date primary key,
  n bigint not null
);
alter table public.analytics_dropped enable row level security;
revoke all on public.analytics_dropped from anon, authenticated;

create or replace function public.track(p_session text, p_screen text, p_size text, p_version text, p_events jsonb) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_hash text;
  v_used integer;
  v_take integer;
  v_sent integer;
  per_call constant integer := 50;
  per_minute constant integer := 120;
begin
  if v_user is null or p_events is null or jsonb_typeof(p_events) is distinct from 'array' then
    return;
  end if;
  v_sent := jsonb_array_length(p_events);
  if v_sent = 0 then
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

  v_take := greatest(0, least(per_call, per_minute - v_used, v_sent));
  if v_take < v_sent then
    insert into public.analytics_dropped as d (day, n) values ((now() at time zone 'utc')::date, v_sent - v_take)
    on conflict (day) do update set n = d.n + excluded.n;
  end if;
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
