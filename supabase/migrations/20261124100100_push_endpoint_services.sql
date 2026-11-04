-- Push endpoints may only point at the browsers' own push services, and each person keeps at most 20 devices.
-- People write their own push_subscriptions rows and the worker posts to each endpoint on a schedule, so the old
-- check (any https host name that is not obviously private) still let anyone aim those posts at a host they chose.
-- The host list matches apps/worker/src/push/endpoint.ts: FCM (Chrome and most Chromium browsers), Apple (Safari),
-- Mozilla autopush (Firefox) and WNS (Edge on Windows). The worker checks it again at send time.

lock table public.push_subscriptions in share row exclusive mode;

-- Rows that break the new rule were never deliverable to a real browser; dropping them lets the check be validated.
delete from public.push_subscriptions
where not (
  length(endpoint) <= 2048
  and endpoint ~* '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+push\.services\.mozilla\.com|([a-z0-9-]+\.)+notify\.windows\.com)(:443)?/[^[:space:]]*$'
);

alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_safe;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_service check (
  length(endpoint) <= 2048
  and endpoint ~* '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+push\.services\.mozilla\.com|([a-z0-9-]+\.)+notify\.windows\.com)(:443)?/[^[:space:]]*$'
) not valid;
alter table public.push_subscriptions validate constraint push_subscriptions_endpoint_service;

-- Keep the 19 newest other devices when a new one is saved, so a person cannot fan one push out to thousands of
-- endpoints, and a browser that keeps re-subscribing replaces its stale rows instead of piling them up. Re-saving an
-- endpoint that already exists (the app upserts on endpoint) does not count against the limit. Runs as the caller,
-- so row level security still limits the delete to the person's own rows.
create function public.push_subscriptions_keep_newest() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('push_subscriptions:' || new.user_id::text, 0));
  delete from public.push_subscriptions p
  where p.user_id = new.user_id and p.endpoint <> new.endpoint
    and p.id not in (
      select k.id from public.push_subscriptions k
      where k.user_id = new.user_id and k.endpoint <> new.endpoint
      order by k.created_at desc, k.id desc
      limit 19
    );
  return new;
end;
$$;

create trigger push_subscriptions_keep_newest before insert on public.push_subscriptions
  for each row execute function public.push_subscriptions_keep_newest();
