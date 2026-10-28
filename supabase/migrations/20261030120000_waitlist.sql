-- Waitlist: people asking for access from the marketing page, approved or turned down by the owner on /admin.
--
-- 1. A team request has a company and a team size; an individual request has an email only.
-- 2. Nobody but the server writes requests: /api/waitlist inserts with the service role, so the anon key
--    has no access at all.
-- 3. Only the owner (is_analytics_owner, the stored owner user ID) reads requests and changes their status.
--    decided_at follows status, set by a trigger so the page cannot backdate it.

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('team', 'individual')),
  email text not null unique check (email = lower(email) and position('@' in email) > 1 and length(email) <= 320),
  company text check (company is null or length(company) between 1 and 200),
  team_size text check (team_size is null or team_size in ('2-5', '6-10', '11-25', '26-50', '51+')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint waitlist_team_details check ((kind = 'team') = (company is not null and team_size is not null))
);
create index waitlist_status_created_idx on public.waitlist (status, created_at desc);

alter table public.waitlist enable row level security;
revoke all on public.waitlist from anon, authenticated;
grant select on public.waitlist to authenticated;
grant update (status) on public.waitlist to authenticated;

create policy "Owner reads the waitlist" on public.waitlist for select to authenticated
  using (public.is_analytics_owner());
create policy "Owner decides on the waitlist" on public.waitlist for update to authenticated
  using (public.is_analytics_owner()) with check (public.is_analytics_owner());

create function public.waitlist_decided_at() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.decided_at := case when new.status = 'pending' then null else now() end;
  end if;
  return new;
end;
$$;

create trigger waitlist_decided_at before update on public.waitlist
  for each row execute function public.waitlist_decided_at();
