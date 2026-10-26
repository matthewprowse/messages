-- Product analytics: content-free usage events, for the owner only.
--
-- Rules the database enforces itself, so a bug in the app cannot break them:
--   * An event holds a name, a time, a coarse screen and size, and small values. Text values must be plain
--     code words (lowercase letters, digits and _ . : -, starting with a letter), so a name, an address,
--     a subject or a sentence cannot be stored. Numbers are capped, so a phone number cannot be stored.
--   * The user is a keyed hash of their ID, not the ID. The key lives in a table nobody can read.
--   * Only the owner account can read events. Everyone's app writes through track(), which checks the
--     "Share Usage Data" switch (profiles.share_usage).
--   * Events older than 13 months are rolled into daily counts and deleted.

alter table public.profiles add column share_usage boolean not null default true;

-- 1. The key that turns a user ID into the pseudonymous user in an event.
create table public.analytics_config (
  key text primary key,
  value text not null
);
alter table public.analytics_config enable row level security;
revoke all on public.analytics_config from anon, authenticated;
insert into public.analytics_config (key, value)
  values ('user_salt', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

-- 2. Events and their daily rollups.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_hash text not null,
  session text,
  name text not null,
  screen text,
  size text,
  app_version text,
  props jsonb not null default '{}'::jsonb
);
create index analytics_events_at_idx on public.analytics_events (at desc);
create index analytics_events_name_at_idx on public.analytics_events (name, at desc);

create table public.analytics_daily (
  day date not null,
  name text not null,
  n bigint not null,
  users bigint not null,
  primary key (day, name)
);

-- 3. Who may read: the owner account, by the email in their sign-in token.
create function public.is_analytics_owner() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'mattprowse03@gmail.com'
$$;
revoke execute on function public.is_analytics_owner() from public, anon;
grant execute on function public.is_analytics_owner() to authenticated;

alter table public.analytics_events enable row level security;
alter table public.analytics_daily enable row level security;
create policy "Owner reads analytics events" on public.analytics_events for select to authenticated
  using (public.is_analytics_owner());
create policy "Owner reads analytics rollups" on public.analytics_daily for select to authenticated
  using (public.is_analytics_owner());
revoke all on public.analytics_events, public.analytics_daily from anon;
revoke insert, update, delete, truncate on public.analytics_events, public.analytics_daily from authenticated;

-- 4. Internals: the user hash, and the cleaning of an event's values.
create function public.analytics_user_hash(p_user uuid) returns text
  language sql stable security definer set search_path = ''
as $$
  select encode(
    sha256(convert_to((select value from public.analytics_config where key = 'user_salt') || ':' || p_user::text, 'utf8')),
    'hex'
  )
$$;
revoke execute on function public.analytics_user_hash(uuid) from public, anon, authenticated;

-- Keeps only: numbers of a sensible size, booleans, code words, and lists of code words.
create function public.analytics_clean_props(p jsonb) returns jsonb
  language plpgsql immutable set search_path = ''
as $$
declare
  k text;
  v jsonb;
  kept jsonb := '{}'::jsonb;
  n int := 0;
  word constant text := '^[a-z][a-z0-9_.:-]{0,39}$';
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
      continue when (v #>> '{}') !~ word;
      kept := kept || jsonb_build_object(k, v);
    elsif jsonb_typeof(v) = 'array' then
      kept := kept || jsonb_build_object(k, coalesce((
        select jsonb_agg(e) from (
          select e from jsonb_array_elements(v) e
          where jsonb_typeof(e) = 'string' and (e #>> '{}') ~ word
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

create function public.analytics_insert(
  p_user uuid, p_session text, p_screen text, p_size text, p_version text, p_events jsonb
) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  h text;
  e jsonb;
  nm text;
  n int := 0;
  word constant text := '^[a-z][a-z0-9_.:-]{0,39}$';
begin
  if p_user is null or p_events is null or jsonb_typeof(p_events) <> 'array' then
    return;
  end if;
  if not coalesce((select share_usage from public.profiles where user_id = p_user), true) then
    return;
  end if;
  h := public.analytics_user_hash(p_user);
  for e in select * from jsonb_array_elements(p_events) loop
    exit when n >= 50;
    nm := e ->> 'name';
    continue when nm is null or nm !~ '^[a-z][a-z0-9_]{1,39}$';
    insert into public.analytics_events (user_hash, session, name, screen, size, app_version, props)
    values (
      h,
      case when p_session ~ '^[a-z0-9-]{1,40}$' then p_session end,
      nm,
      case when coalesce(e ->> 'screen', p_screen) ~ word then coalesce(e ->> 'screen', p_screen) end,
      case when p_size in ('phone', 'tablet', 'desktop') then p_size end,
      case when p_version ~ word then p_version end,
      public.analytics_clean_props(e -> 'props')
    );
    n := n + 1;
  end loop;
end
$$;
revoke execute on function public.analytics_insert(uuid, text, text, text, text, jsonb) from public, anon, authenticated;

-- 5. Writing: the app as the signed-in user, the workers as the service role.
create function public.track(p_session text, p_screen text, p_size text, p_version text, p_events jsonb) returns void
  language sql security definer set search_path = ''
as $$
  select public.analytics_insert(auth.uid(), p_session, p_screen, p_size, p_version, p_events)
$$;
revoke execute on function public.track(text, text, text, text, jsonb) from public, anon;
grant execute on function public.track(text, text, text, text, jsonb) to authenticated;

create function public.analytics_record(p_user uuid, p_events jsonb) returns void
  language sql security definer set search_path = ''
as $$
  select public.analytics_insert(p_user, null, null, null, null, p_events)
$$;
revoke execute on function public.analytics_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.analytics_record(uuid, jsonb) to service_role;

-- 6. Removing someone's events when they ask (service role only).
create function public.analytics_forget(p_user uuid) returns void
  language sql security definer set search_path = ''
as $$
  delete from public.analytics_events where user_hash = public.analytics_user_hash(p_user)
$$;
revoke execute on function public.analytics_forget(uuid) from public, anon, authenticated;
grant execute on function public.analytics_forget(uuid) to service_role;

-- 7. Retention: events older than 13 months become daily counts.
create function public.analytics_prune() returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.analytics_daily (day, name, n, users)
  select at::date, name, count(*), count(distinct user_hash)
  from public.analytics_events
  where at < now() - interval '13 months'
  group by 1, 2
  on conflict (day, name) do update
    set n = public.analytics_daily.n + excluded.n,
        users = greatest(public.analytics_daily.users, excluded.users);
  delete from public.analytics_events where at < now() - interval '13 months';
end
$$;
revoke execute on function public.analytics_prune() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('analytics-prune', '17 3 * * *', 'select public.analytics_prune()');
exception when others then
  raise notice 'pg_cron not available, run select public.analytics_prune() yourself: %', sqlerrm;
end
$$;

-- 8. What the AI decided and how, kept with the decision (labels and traits only, no text).
alter table public.message_ai add column prompt_version text;
alter table public.message_ai add column traits jsonb;
