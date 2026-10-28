-- Sync worker load and Supabase cost.
-- 1. Attachment files that cannot be fetched: tries and a final give-up state, kept apart from attachments.
-- 2. ai_usage retention: rows older than 90 days become monthly totals.

-- 1. Not published to Realtime, and no policies: only the worker (service role) reads it.
create table public.attachment_fetch_state (
  attachment_id uuid primary key references public.attachments (id) on delete cascade,
  tries integer not null default 0,
  next_try_at timestamptz not null default now(),
  gave_up boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.attachment_fetch_state enable row level security;
revoke all on public.attachment_fetch_state from anon, authenticated;

-- 2. Monthly totals of rolled-up usage. account_id has no foreign key: the summary outlives the account.
create table public.ai_usage_monthly (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid,
  month timestamptz not null,
  feature text not null,
  provider text not null,
  model text not null,
  setup boolean not null default false,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12, 6) not null default 0
);
create unique index ai_usage_monthly_key on public.ai_usage_monthly
  (user_id, coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), month, feature, provider, model, setup);

alter table public.ai_usage_monthly enable row level security;
create policy "Read own AI usage totals" on public.ai_usage_monthly for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.ai_usage_monthly from anon;
revoke insert, update, delete, truncate on public.ai_usage_monthly from authenticated;

-- Moves detail rows older than 90 days into the monthly totals, in one statement so a failure loses nothing.
-- Returns how many rows were rolled up. Called daily by the worker (src/usage-rollup.ts).
-- The allowance and per-person admin functions only read the current month, which the 90 days always
-- cover, so they are unchanged; only history (the summary view) needs both tables.
create function public.ai_usage_rollup() returns integer
  language plpgsql security definer set search_path = ''
as $$
declare moved integer;
begin
  with old as (
    delete from public.ai_usage where created_at < now() - interval '90 days' returning *
  ), grouped as (
    select user_id, account_id, date_trunc('month', created_at at time zone 'utc') at time zone 'utc' as month,
           feature, provider, model, setup,
           count(*)::integer as calls,
           sum(input_tokens)::bigint as input_tokens,
           sum(cached_tokens)::bigint as cached_tokens,
           sum(output_tokens)::bigint as output_tokens,
           sum(cost_usd) as cost_usd
    from old
    group by 1, 2, 3, 4, 5, 6, 7
  ), added as (
    insert into public.ai_usage_monthly (user_id, account_id, month, feature, provider, model, setup, calls, input_tokens, cached_tokens, output_tokens, cost_usd)
    select * from grouped
    on conflict (user_id, coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), month, feature, provider, model, setup)
    do update set calls = public.ai_usage_monthly.calls + excluded.calls,
                  input_tokens = public.ai_usage_monthly.input_tokens + excluded.input_tokens,
                  cached_tokens = public.ai_usage_monthly.cached_tokens + excluded.cached_tokens,
                  output_tokens = public.ai_usage_monthly.output_tokens + excluded.output_tokens,
                  cost_usd = public.ai_usage_monthly.cost_usd + excluded.cost_usd
    returning 1
  )
  select count(*) into moved from old;
  return coalesce(moved, 0);
end
$$;
revoke execute on function public.ai_usage_rollup() from public, anon, authenticated;
grant execute on function public.ai_usage_rollup() to service_role;

-- The usage summary reads detail rows and rolled-up months together.
create or replace view public.ai_usage_summary with (security_invoker = true) as
select user_id, account_id, month, feature, provider, model,
       sum(calls)::integer as calls, sum(input_tokens)::bigint as input_tokens,
       sum(output_tokens)::bigint as output_tokens, sum(cost_usd)::numeric(12, 6) as cost_usd
from (
  select user_id, account_id, date_trunc('month', created_at) as month, feature, provider, model,
         1 as calls, input_tokens::bigint as input_tokens, output_tokens::bigint as output_tokens, cost_usd
  from public.ai_usage
  union all
  select user_id, account_id, month, feature, provider, model, calls, input_tokens, output_tokens, cost_usd
  from public.ai_usage_monthly
) u
group by user_id, account_id, month, feature, provider, model;
