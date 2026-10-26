-- A cap on briefs asked for from the app: at most 3 in any 24 hours per user, enforced here so a changed
-- or buggy client cannot run up Gemini costs.
--
-- The app asks for a brief by inserting today's row as 'pending', or, when it exists, setting it back to
-- 'pending' (apps/web/lib/brief.ts requestBrief). Each of those is a request and is logged in
-- brief_requests; the fourth within 24 hours is refused with SQLSTATE 54000 and the message
-- 'brief_request_limit' (detail: when the next one is allowed, as an ISO timestamp). Re-asking while the
-- row is already 'pending' is not counted. The log outlives a deleted brief, so deleting and asking again
-- does not reset the count. The app can read its own log to show how many are left.
--
-- The app may also only move a brief to 'pending' (above) or from 'written' to 'speak_pending' (Listen);
-- any other status change from the app is refused (42501), so speech cannot be asked for again and again
-- by setting a brief back to 'written'. The workers (service role) are not limited.

create table if not exists public.brief_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  brief_id uuid references public.briefs (id) on delete set null,
  requested_at timestamptz not null default now()
);

create index if not exists brief_requests_user_idx on public.brief_requests (user_id, requested_at desc);

alter table public.brief_requests enable row level security;

drop policy if exists "Read own brief requests" on public.brief_requests;
create policy "Read own brief requests" on public.brief_requests for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.brief_requests from anon, authenticated;
grant select on public.brief_requests to authenticated;

-- Security definer so it can write the log, which app users cannot. Whether the write comes from the app
-- is read from the request's token, as current_user is the function's owner in here. It runs after the
-- row is written (so the log can point at a new brief); raising still undoes the write.
create or replace function public.limit_brief_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap constant integer := 3;
  v_count integer;
  v_oldest timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'a brief can only be asked for as pending' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if not (new.status = 'pending' or (new.status = 'speak_pending' and old.status = 'written')) then
      raise exception 'brief status % cannot be set from the app', new.status using errcode = '42501';
    end if;
  end if;

  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    -- One request at a time per user, so two at once cannot both slip under the cap.
    perform pg_advisory_xact_lock(hashtextextended('brief_requests:' || new.user_id::text, 0));
    select count(*), min(requested_at) into v_count, v_oldest
    from public.brief_requests
    where user_id = new.user_id and requested_at > now() - interval '24 hours';
    if v_count >= v_cap then
      raise exception 'brief_request_limit'
        using errcode = '54000',
              detail = to_char((v_oldest + interval '24 hours') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              hint = 'At most 3 briefs can be asked for in 24 hours.';
    end if;
    insert into public.brief_requests (user_id, brief_id) values (new.user_id, new.id);
  end if;

  return null;
end;
$$;

revoke execute on function public.limit_brief_requests() from public, anon, authenticated;

drop trigger if exists limit_brief_requests on public.briefs;
create trigger limit_brief_requests after insert or update of status on public.briefs
  for each row execute function public.limit_brief_requests();
