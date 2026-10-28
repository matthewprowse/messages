-- The changelog: what changed in each release, written before the code is pushed so it can be shown to people.
-- For now only the owner reads and writes it (is_analytics_owner, as for Analytics and Admin). When updates go public,
-- add one select policy for published rows and nothing else changes.
--
--   changes is a list of {"kind": "new" | "improved" | "fixed", "text": "..."}.
--   published says an entry is ready to show; a draft is still being written.

create function public.updates_changes_valid(p jsonb) returns boolean
  language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 100
    and not exists (
      select 1 from jsonb_array_elements(p) c
      where jsonb_typeof(c) <> 'object'
        or c ->> 'kind' is null or c ->> 'kind' not in ('new', 'improved', 'fixed')
        or c ->> 'text' is null or char_length(btrim(c ->> 'text')) not between 1 and 300
    )
$$;

create table public.updates (
  id uuid primary key default gen_random_uuid(),
  version text check (version is null or char_length(btrim(version)) between 1 and 20),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  summary text check (summary is null or char_length(summary) <= 500),
  changes jsonb not null default '[]'::jsonb check (public.updates_changes_valid(changes)),
  released_on date not null default current_date,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index updates_released_idx on public.updates (released_on desc, created_at desc);
create trigger set_updated_at before update on public.updates for each row execute function public.set_updated_at();

alter table public.updates enable row level security;
revoke all on public.updates from anon, authenticated;
grant select, insert, update, delete on public.updates to authenticated;

create policy "Owner reads updates" on public.updates for select to authenticated using (public.is_analytics_owner());
create policy "Owner adds updates" on public.updates for insert to authenticated with check (public.is_analytics_owner());
create policy "Owner changes updates" on public.updates for update to authenticated using (public.is_analytics_owner()) with check (public.is_analytics_owner());
create policy "Owner deletes updates" on public.updates for delete to authenticated using (public.is_analytics_owner());
