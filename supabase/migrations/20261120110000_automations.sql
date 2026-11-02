-- Automations and lead capture (docs/PLAN.md, "Automations and Lead Capture"), email only.
--
-- An automation is When (conditions), Read (the fields to pull out) and Do (what to make of them). The AI worker runs the
-- enabled ones right after triage for each new inbound email and records every run so the user can see it and undo it.
--
--   automations         the setup. template_key names a fixed parser ('property24', 'private_property'), null for Custom.
--                       The conditions, fields and actions, with the name, are one sealed JSON (spec), since conditions can
--                       name people.
--   automation_runs     one row per automation and message (unique, so a message is never run twice). The extracted fields are
--                       sealed. effects holds ids only (contact, draft, task update, whether the run created the contact), so
--                       Undo can reverse exactly what the run did. Only the AI worker inserts.
--   automation_previews "In the last 30 days this would have made N leads": the app asks, the AI worker reads the last 30 days of
--                       the user's mail with the same parser and writes the sealed answer. Nothing is made by a preview.
--
-- Also: contacts.lead_source (sealed, where a lead came from), drafts.reply_to (sealed, the lead's own address, so a draft for
-- a portal enquiry is never sent to the portal), and a Gemini budget share for the "automations" feature.

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_key text check (template_key is null or template_key in ('property24', 'private_property')),
  enabled boolean not null default false,
  enabled_at timestamptz,
  spec text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automations_user_idx on public.automations (user_id);
create index automations_enabled_idx on public.automations (user_id) where enabled;

alter table public.automations enable row level security;
create policy "Read own automations" on public.automations for select to authenticated using (user_id = (select auth.uid()));
create policy "Add own automations" on public.automations for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Change own automations" on public.automations for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Delete own automations" on public.automations for delete to authenticated using (user_id = (select auth.uid()));

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  automation_id uuid not null references public.automations (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  thread_id uuid references public.threads (id) on delete set null,
  status text not null default 'running' check (status in ('running', 'done', 'skipped', 'failed', 'undone')),
  read_by text check (read_by is null or read_by in ('parser', 'gemini')),
  fields text,
  contact_id uuid references public.contacts (id) on delete set null,
  effects jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (automation_id, message_id)
);
create index automation_runs_user_idx on public.automation_runs (user_id, created_at desc);
create index automation_runs_message_idx on public.automation_runs (message_id);
create index automation_runs_contact_idx on public.automation_runs (contact_id);
create index automation_runs_thread_idx on public.automation_runs (thread_id);

alter table public.automation_runs enable row level security;
create policy "Read own automation runs" on public.automation_runs for select to authenticated using (user_id = (select auth.uid()));
-- Undo is done in the app and marks the run; nothing else about a run can be changed from the browser.
create policy "Mark own automation runs undone" on public.automation_runs for update to authenticated
  using (user_id = (select auth.uid()) and status = 'done') with check (user_id = (select auth.uid()) and status = 'undone');
create policy "Delete own automation runs" on public.automation_runs for delete to authenticated using (user_id = (select auth.uid()));

create table public.automation_previews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_key text check (template_key is null or template_key in ('property24', 'private_property')),
  spec text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  result text,
  error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index automation_previews_user_idx on public.automation_previews (user_id, created_at desc);
create index automation_previews_queued_idx on public.automation_previews (created_at) where status in ('queued', 'running');

alter table public.automation_previews enable row level security;
create policy "Read own automation previews" on public.automation_previews for select to authenticated using (user_id = (select auth.uid()));
create policy "Ask for own automation previews" on public.automation_previews for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'queued' and result is null);
create policy "Delete own automation previews" on public.automation_previews for delete to authenticated using (user_id = (select auth.uid()));

-- Where a lead came from ("Property24 Enquiry"), sealed like the relationship beside it.
alter table public.contacts add column lead_source text;

-- The address a draft is meant for, when it is not the conversation's sender (a portal enquiry is written to the lead).
-- Sealed as an address. The reply box offers it as the recipient; the portal's no-reply address is never used.
alter table public.drafts add column reply_to text;

-- Its Gemini cost is filed under its own feature: the list in 20261119150000_document_cards.sql plus 'automations'.
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('triage', 'draft', 'learn', 'brief', 'transcribe', 'logos', 'bulk_read', 'documents', 'automations'));

-- Starting split: 3% for automations, taken from the largest share (never more than it has, so none goes below 0), with a
-- weekly limit like the other on-request features. Only when the owner has no share for it yet, so a split already set in
-- Admin stays. A share of zero would pause the feature for everyone, which is why one is set here.
do $$
declare
  v_shares jsonb;
  v_big text;
  v_take numeric;
begin
  select shares into v_shares from public.ai_budget limit 1;
  if v_shares is not null and not (v_shares ? 'automations') then
    select f.key into v_big from jsonb_each_text(v_shares) f order by f.value::numeric desc, f.key limit 1;
    v_take := least(3, greatest(coalesce((v_shares ->> v_big)::numeric, 0), 0));
    if v_big is not null then
      v_shares := jsonb_set(v_shares, array[v_big], to_jsonb((v_shares ->> v_big)::numeric - v_take));
    end if;
    update public.ai_budget set shares = jsonb_set(v_shares, '{automations}', to_jsonb(v_take));
  end if;
  update public.ai_budget set weekly_features = array_append(weekly_features, 'automations') where not ('automations' = any (weekly_features));
end $$;
