-- Worker leases: one running sync worker per shard.
--
-- Each worker (apps/worker) takes the lease "shard-<index>" at startup, renews it every 30 s and releases it on
-- shutdown. A second worker started for the same shard cannot take it while it is held, so a rolling deploy or a
-- mistaken second start can never run the same accounts twice or fail the first worker's in-flight sends. A crashed
-- worker's lease simply expires (the worker asks for 90 s).
--
-- Service role only: row-level security is on with no policies, and the functions are granted to service_role alone.
-- Safe to run twice. The worker runs without a lease (and logs a warning) until this is applied.

create table if not exists public.worker_leases (
  name       text primary key,
  holder     text not null,
  expires_at timestamptz not null
);

alter table public.worker_leases enable row level security;
revoke all on public.worker_leases from public, anon, authenticated;

-- Takes the lease when it is free, expired, or already held by p_holder (which extends it). False when someone else holds it.
create or replace function public.acquire_worker_lease(p_name text, p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holder text;
begin
  insert into public.worker_leases as l (name, holder, expires_at)
  values (p_name, p_holder, now() + make_interval(secs => greatest(p_ttl_seconds, 1)))
  on conflict (name) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where l.holder = excluded.holder or l.expires_at <= now()
  returning l.holder into v_holder;
  return v_holder is not null;
end;
$$;

-- Gives the lease up early. Does nothing when p_holder is not the holder.
create or replace function public.release_worker_lease(p_name text, p_holder text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.worker_leases where name = p_name and holder = p_holder;
$$;

revoke execute on function public.acquire_worker_lease(text, text, integer) from public, anon, authenticated;
revoke execute on function public.release_worker_lease(text, text) from public, anon, authenticated;
grant execute on function public.acquire_worker_lease(text, text, integer) to service_role;
grant execute on function public.release_worker_lease(text, text) to service_role;
