-- POPIA controls in Settings (docs/PLAN.md, "Deleting an account"): Delete My Account with a 7 day grace period, Remove and
-- Disconnect for one connected account, and a list of active sessions.
--
--   * account_deletions: one row per person who asked to delete everything. run_after is seven days after the request; until
--     then the row can be cancelled. The row is written by /api/account/delete (service role, after re-authentication) and the
--     sync worker carries it out (apps/worker/src/account), so a signed-in user may only read their own row.
--   * account_removals: one queued job per account to Remove. The worker deletes the account's files from storage (keeping any
--     file another account of the same person still uses), then the account row, which takes its threads, messages,
--     attachments, credentials and derived rows with it.
--   * disconnect_account: stops syncing and forgets the stored credentials, keeps every message. Pause Sync keeps the credentials.
--   * request_account_removal: the guarded way to queue a removal. Needs the word REMOVE, only for the caller's own accounts.
--   * list_my_sessions: the caller's active sign-ins (the Auth API has no list call). No addresses, only the browser text.
--
-- Every table here has a user_id that cascades from auth.users, so deleting the auth user is also what removes the rows.

create table public.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  run_after timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'failed')),
  attempts integer not null default 0,
  error_code text,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);
create index account_deletions_due_idx on public.account_deletions (run_after) where status in ('pending', 'failed');
create trigger set_updated_at before update on public.account_deletions for each row execute function public.set_updated_at();

alter table public.account_deletions enable row level security;
create policy account_deletions_select_own on public.account_deletions for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.account_deletions from anon, authenticated;
grant select on public.account_deletions to authenticated;

create table public.account_removals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null unique references public.accounts (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'failed')),
  attempts integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index account_removals_user_idx on public.account_removals (user_id);
create index account_removals_due_idx on public.account_removals (created_at) where status in ('queued', 'failed');
create trigger set_updated_at before update on public.account_removals for each row execute function public.set_updated_at();

alter table public.account_removals enable row level security;
create policy account_removals_select_own on public.account_removals for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.account_removals from anon, authenticated;
grant select on public.account_removals to authenticated;

-- Stops syncing and drops the stored sign-in of the caller's own accounts. Returns how many accounts it changed.
create or replace function public.disconnect_account(p_accounts uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  with mine as (
    update public.accounts
    set status = 'disconnected', status_detail = 'Disconnected. Connect it again to sync.'
    where id = any (p_accounts) and user_id = (select auth.uid())
    returning id
  ), gone as (
    delete from public.account_credentials where account_id in (select id from mine)
  ), keys as (
    delete from public.whatsapp_auth_keys where account_id in (select id from mine)
  )
  select count(*) into changed from mine;
  return changed;
end;
$$;

-- Queues the removal of the caller's own accounts. p_confirm must be the word REMOVE, so a script cannot do it by accident.
create or replace function public.request_account_removal(p_accounts uuid[], p_confirm text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  queued integer;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if p_confirm is distinct from 'REMOVE' then raise exception 'Type REMOVE to confirm.' using errcode = '22023'; end if;
  perform public.disconnect_account(p_accounts);
  with added as (
    insert into public.account_removals (user_id, account_id)
    select me, a.id from public.accounts a where a.id = any (p_accounts) and a.user_id = me
    on conflict (account_id) do update set status = 'queued', attempts = 0, error_code = null
      where public.account_removals.status = 'failed'
    returning 1
  )
  select count(*) into queued from added;
  return queued;
end;
$$;

-- The caller's active sessions, newest first. current marks the one making the call.
create or replace function public.list_my_sessions()
returns table (id uuid, created_at timestamptz, refreshed_at timestamptz, user_agent text, aal text, current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.created_at, coalesce(s.refreshed_at, s.updated_at), s.user_agent, s.aal::text,
         s.id::text = (select auth.jwt() ->> 'session_id')
  from auth.sessions s
  where s.user_id = (select auth.uid()) and (s.not_after is null or s.not_after > now())
  order by coalesce(s.refreshed_at, s.updated_at) desc nulls last
  limit 20;
$$;

revoke execute on function public.disconnect_account(uuid[]) from public, anon;
revoke execute on function public.request_account_removal(uuid[], text) from public, anon;
revoke execute on function public.list_my_sessions() from public, anon;
grant execute on function public.disconnect_account(uuid[]) to authenticated;
grant execute on function public.request_account_removal(uuid[], text) to authenticated;
grant execute on function public.list_my_sessions() to authenticated;
