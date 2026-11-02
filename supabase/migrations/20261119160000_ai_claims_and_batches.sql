-- AI worker claims, persisted retry state and Batch API jobs (Wave 5, AI cost and reliability).
--
-- 1. ai_claims + claim_ai_rows / release_ai_claims: a row the AI worker is about to pay Gemini for (a draft, a triage
--    group, a voice note) is claimed first. The claim is one insert-or-take-over statement, so two AI workers (a
--    rolling restart, a mistaken second start) can never both take the same row and pay twice. A claim nobody finished
--    goes stale after p_stale_seconds and can be taken again.
-- 2. ai_retries: the back-off for rows that keep failing (a message the model refuses), kept in the database so a
--    restart does not give every poison message another paid try.
-- 3. ai_batches: Gemini Batch API jobs in flight (half price, answered within 24 hours), so a restart still knows
--    which rows are waiting on a batch and collects the answers instead of asking again.
--
-- Service role only: row-level security is on with no policies. Holds ids and counts, never message text.
-- Safe to run twice. The worker runs without these (and logs a warning) until this is applied.

create table if not exists public.ai_claims (
  kind       text        not null,
  row_id     text        not null,
  holder     text        not null,
  claimed_at timestamptz not null default now(),
  primary key (kind, row_id)
);
create index if not exists ai_claims_claimed_idx on public.ai_claims (claimed_at);

create table if not exists public.ai_retries (
  kind     text        not null,
  row_id   text        not null,
  failures integer     not null default 1,
  retry_at timestamptz not null,
  primary key (kind, row_id)
);
create index if not exists ai_retries_retry_idx on public.ai_retries (kind, retry_at);

create table if not exists public.ai_batches (
  name       text        primary key,
  kind       text        not null,
  model      text        not null,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  feature    text        not null,
  items      jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_batches_kind_idx on public.ai_batches (kind, created_at);

alter table public.ai_claims enable row level security;
alter table public.ai_retries enable row level security;
alter table public.ai_batches enable row level security;
revoke all on public.ai_claims, public.ai_retries, public.ai_batches from public, anon, authenticated;

-- Takes the ids nobody holds (or whose holder went stale) and returns the ones now held by p_holder. Concurrent
-- callers cannot both win: the insert conflicts, and the update only applies to a stale row (re-checked once the
-- other transaction commits). Old claims are swept on the way, so the table stays small.
create or replace function public.claim_ai_rows(p_kind text, p_ids text[], p_holder text, p_stale_seconds integer)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken text[];
begin
  delete from public.ai_claims where claimed_at < now() - interval '1 day';
  with taken as (
    insert into public.ai_claims as c (kind, row_id, holder, claimed_at)
    select p_kind, i, p_holder, now() from unnest(p_ids) as i
    on conflict (kind, row_id) do update
      set holder = excluded.holder, claimed_at = excluded.claimed_at
      where c.claimed_at < now() - make_interval(secs => greatest(p_stale_seconds, 1)) or c.holder = excluded.holder
    returning c.row_id
  )
  select coalesce(array_agg(row_id), '{}') into v_taken from taken;
  return v_taken;
end;
$$;

-- Gives claims back (the work is done, or failed in a way worth trying again). Only the holder's own are removed.
create or replace function public.release_ai_claims(p_kind text, p_ids text[], p_holder text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.ai_claims where kind = p_kind and row_id = any(p_ids) and holder = p_holder;
$$;

revoke execute on function public.claim_ai_rows(text, text[], text, integer) from public, anon, authenticated;
revoke execute on function public.release_ai_claims(text, text[], text) from public, anon, authenticated;
grant execute on function public.claim_ai_rows(text, text[], text, integer) to service_role;
grant execute on function public.release_ai_claims(text, text[], text) to service_role;
grant select, insert, update, delete on public.ai_claims, public.ai_retries, public.ai_batches to service_role;

-- 4. A rule learned from one edit starts switched off ('tentative') and goes live once a second edit supports it.
alter table public.style_rules drop constraint if exists style_rules_disabled_reason_check;
alter table public.style_rules add constraint style_rules_disabled_reason_check
  check (disabled_reason in ('user', 'unsupported', 'tentative'));

-- 5. Old mail of a newly connected account that is waiting on a half price batch is held out of triage's next looks
--    until its answer is back (or the hold passes), so thousands can wait without a long exclusion list in the request.
--    Nullable, no default: adding it rewrites nothing.
alter table public.messages add column if not exists triage_hold_until timestamptz;
