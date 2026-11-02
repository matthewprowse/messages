-- Owner operations, part 2 (Wave 7): the views behind Admin's Health, Connectors and AI History sections. All owner only
-- (is_analytics_owner), all counts, ages and codes: no message text, names or addresses.
--
-- admin_system_health()      worker leases with seconds to expiry, and each queue's depth and oldest waiting age.
-- admin_connector_health()   accounts by provider and status, how old the last good sync is, and error codes over 24 hours.
-- admin_ai_history()         spend per person per day (30 days), per month (6 months) and per feature (30 days).
-- ai_status.unpriced_models  written by the AI worker at start, so Admin can say "a model has no price".

alter table public.ai_status add column if not exists unpriced_models text[] not null default '{}';

create function public.admin_system_health() returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_leases jsonb;
  v_queues jsonb;
begin
  if not public.is_analytics_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', l.name, 'expires_in_s', round(extract(epoch from l.expires_at - now()))::integer) order by l.name), '[]'::jsonb)
    into v_leases from public.worker_leases l;
  -- oldest is when the oldest waiting row became due (a send later than now is not waiting yet).
  with q as (
    select 'outbox' as key, count(*) as depth, min(coalesce(send_after, created_at)) as oldest
      from public.outbox where status = 'queued' and coalesce(send_after, created_at) <= now()
    union all select 'outbox_sending', count(*), min(coalesce(send_after, created_at)) from public.outbox where status = 'sending'
    union all select 'drafts', count(*), min(created_at) from public.drafts where status = 'pending'
    union all select 'mail_actions', count(*), min(created_at) from public.mail_actions where status in ('queued', 'working')
    union all select 'task_updates', count(*), min(created_at) from public.task_updates where status = 'queued'
    union all select 'calendar_outbox', count(*), min(created_at) from public.calendar_outbox where status in ('queued', 'creating')
    union all select 'automation_previews', count(*), min(created_at) from public.automation_previews where status in ('queued', 'running')
    union all select 'ai_batches', count(*), min(created_at) from public.ai_batches
  )
  select jsonb_agg(jsonb_build_object('key', q.key, 'depth', q.depth,
           'oldest_age_s', case when q.oldest is null then null else greatest(0, round(extract(epoch from now() - q.oldest))::integer) end))
    into v_queues from q;
  return jsonb_build_object('at', now(), 'leases', v_leases, 'queues', coalesce(v_queues, '[]'::jsonb));
end;
$$;
revoke execute on function public.admin_system_health() from public, anon;
grant execute on function public.admin_system_health() to authenticated;

-- Accounts per provider and status, with the age of the freshest and the stalest good sync. A heartbeat
-- (account_heartbeats) is newer than accounts.last_synced_at, so the later of the two is the sync time.
-- errors is the codes recorded by content-free analytics in the last 24 hours; people with Share Usage Data off
-- record nothing, so it is a floor, not a total.
create function public.admin_connector_health() returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_accounts jsonb;
  v_errors jsonb;
begin
  if not public.is_analytics_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(s.x order by s.x ->> 'provider', s.x ->> 'status'), '[]'::jsonb) into v_accounts
  from (
    select jsonb_build_object('provider', a.provider, 'status', a.status, 'n', count(*),
             'freshest_age_s', round(extract(epoch from now() - max(greatest(a.last_synced_at, h.synced_at))))::integer,
             'stalest_age_s', round(extract(epoch from now() - min(greatest(a.last_synced_at, h.synced_at))))::integer) as x
    from public.accounts a left join public.account_heartbeats h on h.account_id = a.id
    group by a.provider, a.status
  ) s;
  select coalesce(jsonb_agg(s.x order by (s.x ->> 'n')::integer desc), '[]'::jsonb) into v_errors
  from (
    select jsonb_build_object('event', e.name, 'provider', coalesce(e.props ->> 'provider', ''), 'code', e.props ->> 'code', 'n', count(*)) as x
    from public.analytics_events e
    where e.at >= now() - interval '24 hours'
      and e.name in ('sync_error', 'send_result', 'task_update', 'account_connect', 'error')
      and e.props ? 'code'
      and coalesce(e.props ->> 'outcome', 'failed') not in ('sent', 'done')
    group by e.name, e.props ->> 'provider', e.props ->> 'code'
    order by count(*) desc
    limit 40
  ) s;
  return jsonb_build_object('at', now(), 'accounts', v_accounts, 'errors', v_errors);
end;
$$;
revoke execute on function public.admin_connector_health() from public, anon;
grant execute on function public.admin_connector_health() to authenticated;

-- Spend per person from the detail rows (90 days) and the monthly totals. Setup work and logos are included because this
-- is what Google bills. daily: 30 days of {user, day, usd}; monthly: 6 months of {user, month, usd}; features: {user,
-- feature, usd} over the last 30 days. Email is the only identifier, as in AI Usage.
create function public.admin_ai_history() returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_daily jsonb;
  v_monthly jsonb;
  v_features jsonb;
begin
  if not public.is_analytics_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', d.user_id, 'email', d.email, 'day', d.day, 'usd', d.usd) order by d.day), '[]'::jsonb) into v_daily
  from (
    select u.user_id, (select au.email::text from auth.users au where au.id = u.user_id) as email,
           (u.created_at at time zone 'utc')::date as day, round(sum(u.cost_usd), 4) as usd
    from public.ai_usage u where u.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc') - interval '29 days'
    group by 1, 2, 3
  ) d;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', m.email, 'month', m.month, 'usd', m.usd) order by m.month), '[]'::jsonb) into v_monthly
  from (
    select s.user_id, (select au.email::text from auth.users au where au.id = s.user_id) as email,
           (s.month at time zone 'utc')::date as month, round(sum(s.cost_usd), 4) as usd
    from public.ai_usage_summary s
    where s.month >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc') - interval '5 months'
    group by 1, 2, 3
  ) m;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', f.user_id, 'feature', f.feature, 'usd', f.usd)), '[]'::jsonb) into v_features
  from (
    select u.user_id, u.feature, round(sum(u.cost_usd), 4) as usd
    from public.ai_usage u where u.created_at >= now() - interval '30 days'
    group by 1, 2
  ) f;
  return jsonb_build_object('at', now(), 'daily', v_daily, 'monthly', v_monthly, 'features', v_features);
end;
$$;
revoke execute on function public.admin_ai_history() from public, anon;
grant execute on function public.admin_ai_history() to authenticated;
