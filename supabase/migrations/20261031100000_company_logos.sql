-- Company logos: one per company domain, shared by every user, so each company is looked up once (see
-- docs/PLAN.md, Company Logos and Sender Names).
--
-- A row moves through a queue shared by the two workers. The sync worker does all fetching, framing and
-- storage; the AI worker only asks Gemini:
--   queued     the sync worker gathers and frames candidates (round 1: the free sources; round 2: the
--              addresses Gemini found with Google Search), saves them under review/<key>/ with a numbered
--              sheet, and moves the row to judging, or to searching when round 1 found nothing
--   judging    the AI worker shows Gemini the sheet; it picks a number or none, with a reason for each
--   judged     the sync worker saves the pick as <key>.png, or moves on to searching after round 1
--   searching  the AI worker asks Gemini with Google Search for the official logo, then back to queued
--   done       path names the logo, or is null when the first letter shows instead
-- <key> is the domain's SHA-256 in hex, so the bucket's file names do not list the companies people hear from.
--
-- Only company names and domains ever leave Konva for this, never addresses or mail. Logos are not
-- private: every signed-in user may read the chosen ones. The rows, the candidates and the sheets are for
-- the owner's review page only, through the two functions at the end.

create table public.company_logos (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  name text not null,
  status text not null default 'queued' check (status in ('queued', 'judging', 'judged', 'searching', 'done')),
  round smallint not null default 1 check (round in (1, 2)),
  -- This run's framed candidates: [{n, source, url, path, note}], numbered as on the sheet.
  candidates jsonb not null default '[]'::jsonb,
  sheet_path text,
  pick smallint, -- the judge's (or the owner's) candidate number; null when nothing passed
  -- Why each candidate was turned down: [{n, source, url, path, reason}], both rounds.
  rejected jsonb not null default '[]'::jsonb,
  verdict text, -- the judge's reason for its pick, or why none passed
  search_urls text[] not null default '{}',
  excluded text[] not null default '{}', -- candidate addresses the owner rejected: never offered again
  manual boolean not null default false, -- the owner chose it: rechecks leave it alone
  source text check (source in ('app_store', 'bimi', 'site', 'google', 'wikidata', 'simple_icons', 'search')),
  url text, -- where the chosen logo came from
  path text, -- the chosen logo in the "logos" bucket; null shows the first letter
  changed_at timestamptz, -- when the chosen logo last changed
  checked_at timestamptz, -- when the last run finished
  gemini_calls smallint not null default 0, -- in the latest run
  gemini_cost_usd numeric(10, 6) not null default 0, -- in the latest run, search included
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index company_logos_queue_idx on public.company_logos (status, updated_at) where status <> 'done';
create index company_logos_recheck_idx on public.company_logos (checked_at) where status = 'done' and not manual;

alter table public.company_logos enable row level security;
create policy "Owner reads company logos" on public.company_logos for select to authenticated
  using (public.is_analytics_owner());
revoke all on public.company_logos from anon;
revoke insert, update, delete, truncate on public.company_logos from authenticated;

-- The logos, and the owner's review files under review/.
insert into storage.buckets (id, name, public)
values ('logos', 'logos', false)
on conflict (id) do nothing;

drop policy if exists "Read company logos" on storage.objects;
create policy "Read company logos" on storage.objects for select to authenticated
  using (bucket_id = 'logos' and ((storage.foldername(name))[1] is distinct from 'review' or public.is_analytics_owner()));

-- Gemini calls for logos are Konva's own cost, filed against the owner's account.
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in ('triage', 'draft', 'learn', 'brief', 'transcribe', 'logos'));

create function public.analytics_owner_id() returns uuid
  language sql stable security definer set search_path = ''
as $$
  select id from auth.users where lower(email) = 'mattprowse03@gmail.com' limit 1
$$;
revoke execute on function public.analytics_owner_id() from public, anon, authenticated;
grant execute on function public.analytics_owner_id() to service_role;

-- The review page's two actions, for the owner only.

-- Turns down a candidate (the chosen logo when p_n is null) and looks again without it.
create function public.company_logo_reject(p_domain text, p_n smallint default null) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
begin
  if not public.is_analytics_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select coalesce(
    (select c->>'url' from jsonb_array_elements(l.candidates) c where (c->>'n')::smallint = p_n),
    case when p_n is null then l.url end
  ) into v_url
  from public.company_logos l where l.domain = p_domain;
  update public.company_logos
  set excluded = case when v_url is null or v_url = any (excluded) then excluded else excluded || v_url end,
      status = 'queued', round = 1, pick = null, manual = false, search_urls = '{}', updated_at = now()
  where domain = p_domain;
end;
$$;

-- Chooses one of the latest run's candidates by hand, for every user. The sync worker saves it.
create function public.company_logo_choose(p_domain text, p_n smallint) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_analytics_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.company_logos l
  set pick = p_n, manual = true, status = 'judged', verdict = 'Chosen by hand.', updated_at = now()
  where l.domain = p_domain
    and exists (select 1 from jsonb_array_elements(l.candidates) c where (c->>'n')::smallint = p_n);
end;
$$;

revoke execute on function public.company_logo_reject(text, smallint), public.company_logo_choose(text, smallint) from public, anon;
grant execute on function public.company_logo_reject(text, smallint), public.company_logo_choose(text, smallint) to authenticated;
