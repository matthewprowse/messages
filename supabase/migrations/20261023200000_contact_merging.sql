-- Round four: one person, one contact.
--
-- 1. address_book_cards: the iCloud and Google address book cards the worker reads, so the linker can
--    tell which addresses and numbers belong to the same person.
-- 2. contact_suggestions: likely duplicates waiting for a one-click merge. A dismissed pair is never
--    suggested (or merged automatically) again.
-- 3. contact_merges: every merge, with what moved, so it can be shown and undone.
-- 4. merge_contacts, split_contact and undo_merge.
--
-- Everything that points at a contact, and how a merge treats it:
--   contact_identities.contact_id   (cascade)   moved to the kept contact
--   thread_participants.contact_id  (cascade)   moved, or dropped where the kept contact is already there
--   messages.sender_contact_id      (set null)  moved
--   draft_outcomes.contact_id       (set null)  moved
--   style_rules.contact_id          (cascade)   moved
--   contact_suggestions             (no key)    pending pairs repointed, dismissed pairs carried over
-- contacts.organization_id and the avatar columns are copied onto the kept contact when it lacks them.
-- WhatsApp finds people by identity every time and reactions are keyed by number, so nothing else moves.

-- ---------------------------------------------------------------------------
-- 1. Address book cards
-- ---------------------------------------------------------------------------

create table public.address_book_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  card_key text not null,                   -- the card UID, or a stable hash when it has none
  name text,
  emails text[] not null default '{}',      -- lowercase
  phones text[] not null default '{}',      -- E.164 where the number allows it
  updated_at timestamptz not null default now(),
  unique (account_id, card_key)
);

create index address_book_cards_user_idx on public.address_book_cards (user_id);
create index address_book_cards_emails_idx on public.address_book_cards using gin (emails);
create index address_book_cards_phones_idx on public.address_book_cards using gin (phones);

create trigger set_updated_at before update on public.address_book_cards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Suggestions
-- ---------------------------------------------------------------------------

-- No foreign keys on the pair: a merged or dismissed pair is kept after a contact is deleted, so an undo
-- can restore it and a dismissal keeps working. Pending pairs of a deleted contact are removed by trigger.
create table public.contact_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_a uuid not null,
  contact_b uuid not null,
  reason text not null
    check (reason in ('same_name', 'name_matches_address', 'same_company_name', 'shared_phone', 'other')),
  evidence jsonb not null default '{}',     -- short, never message content
  score real not null default 0,
  status text not null default 'pending' check (status in ('pending', 'merged', 'dismissed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (contact_a < contact_b),
  check (octet_length(evidence::text) <= 2000),
  unique (user_id, contact_a, contact_b)
);

create index contact_suggestions_pending_idx on public.contact_suggestions (user_id, score desc) where status = 'pending';
create index contact_suggestions_a_idx on public.contact_suggestions (contact_a);
create index contact_suggestions_b_idx on public.contact_suggestions (contact_b);

create or replace function public.contact_suggestions_decided_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.decided_at := case when new.status = 'pending' then null else now() end;
  end if;
  return new;
end;
$$;

create trigger contact_suggestions_decided_at before update on public.contact_suggestions
  for each row execute function public.contact_suggestions_decided_at();

-- A deleted contact takes its pending suggestions with it. Security definer because app users may delete
-- their own contacts but not suggestion rows.
create or replace function public.contact_suggestions_on_contact_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.contact_suggestions s
  where s.user_id = old.user_id and s.status = 'pending' and (s.contact_a = old.id or s.contact_b = old.id);
  return old;
end;
$$;

create trigger contact_suggestions_on_contact_delete after delete on public.contacts
  for each row execute function public.contact_suggestions_on_contact_delete();

-- ---------------------------------------------------------------------------
-- 3. Merge history
-- ---------------------------------------------------------------------------

-- No foreign keys on the contacts either: the merged contact is gone by design, and the kept contact may
-- itself be merged later, which must not erase the history needed to undo step by step.
create table public.contact_merges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kept_contact_id uuid not null,
  merged_contact_id uuid not null,          -- the deleted contact's former id
  merged_snapshot jsonb not null,           -- its contacts row as it was
  moved jsonb not null,                     -- ids of everything that moved, see merge_contacts
  reason text not null check (reason in ('address_book', 'signature', 'exact_match', 'suggestion', 'manual')),
  automatic boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  undone_at timestamptz
);

create index contact_merges_user_idx on public.contact_merges (user_id, created_at desc);
create index contact_merges_kept_idx on public.contact_merges (kept_contact_id);
create index contact_merges_merged_idx on public.contact_merges (merged_contact_id);

-- ---------------------------------------------------------------------------
-- Row-level security and table privileges
-- ---------------------------------------------------------------------------

alter table public.address_book_cards enable row level security;
alter table public.contact_suggestions enable row level security;
alter table public.contact_merges enable row level security;

create policy "Read own cards" on public.address_book_cards for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Read own suggestions" on public.contact_suggestions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Dismiss own suggestions" on public.contact_suggestions for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status = 'dismissed');
create policy "Read own merges" on public.contact_merges for select to authenticated
  using (user_id = (select auth.uid()));

-- The worker (service role) writes; the app reads, and may only change a suggestion's status.
revoke all on public.address_book_cards, public.contact_suggestions, public.contact_merges from anon, authenticated;
grant select on public.address_book_cards, public.contact_suggestions, public.contact_merges to authenticated;
grant update (status) on public.contact_suggestions to authenticated;
grant all on public.address_book_cards, public.contact_suggestions, public.contact_merges to service_role;

-- ---------------------------------------------------------------------------
-- 4. Merge, split and undo
-- ---------------------------------------------------------------------------

-- A name that is really an address or a number: empty, a phone number, a WhatsApp privacy ID or an email.
create or replace function public.contact_name_is_placeholder(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(btrim(p_name), '') = ''
    or btrim(p_name) ~ '^\+?[0-9 ().-]*$'
    or btrim(p_name) ~ '^[0-9]+@lid$'
    or position('@' in p_name) > 0;
$$;

-- Who the call acts for: the signed-in user, or p_user when the service role calls.
create or replace function public.contact_merge_caller(p_user uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    if p_user is not null and p_user is distinct from v_uid then
      raise exception 'You can only change your own contacts.' using errcode = '42501';
    end if;
    return v_uid;
  end if;
  if p_user is null then
    raise exception 'p_user is required when called by the service role.' using errcode = '22023';
  end if;
  return p_user;
end;
$$;

-- Merges p_merge into p_keep and returns the merge id. The worker passes p_user and p_automatic; the app
-- passes reason 'suggestion' or 'manual'.
--
-- moved records:
--   identities[], participants_moved[] and participants_dropped[] (thread ids), messages[],
--   draft_outcomes[], style_rules[], suggestion_pair (id marked merged), suggestions_repointed[]
--   {id, contact_a, contact_b} (the values before), suggestions_dropped[] (whole rows),
--   suggestions_added[] (dismissals carried over), kept_before {} and kept_after {} (the kept
--   contact's fields the merge changed).
create or replace function public.merge_contacts(
  p_keep uuid, p_merge uuid, p_reason text, p_automatic boolean default false, p_user uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.contact_merge_caller(p_user);
  v_service boolean := auth.uid() is null;
  v_automatic boolean := coalesce(p_automatic, false) and auth.uid() is null;
  v_keep public.contacts;
  v_merge public.contacts;
  v_after public.contacts;
  v_name text;
  v_keep_rank int;
  v_merge_rank int;
  v_take_avatar boolean;
  v_merge_id uuid := gen_random_uuid();
  v_moved jsonb := '{}'::jsonb;
  v_ids jsonb;
  v_pair uuid;
  v_added uuid;
  v_s record;
  v_a uuid;
  v_b uuid;
  v_fields text[] := array[
    'display_name', 'company', 'role', 'relationship', 'organization_id', 'avatar_path', 'avatar_source',
    'avatar_updated_at', 'style_note', 'style_updated_at', 'ai_summary'
  ];
  v_before jsonb;
  v_after_json jsonb;
begin
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Choose two different contacts to merge.' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('address_book', 'signature', 'exact_match', 'suggestion', 'manual') then
    raise exception 'Unknown merge reason.' using errcode = '22023';
  end if;
  if not v_service and p_reason not in ('suggestion', 'manual') then
    raise exception 'Unknown merge reason.' using errcode = '22023';
  end if;

  -- Lock both, always in the same order, so two merges of the same pair cannot interleave.
  perform 1 from public.contacts c where c.id in (p_keep, p_merge) order by c.id for update;
  select * into v_keep from public.contacts c where c.id = p_keep and c.user_id = v_user;
  select * into v_merge from public.contacts c where c.id = p_merge and c.user_id = v_user;
  if v_keep.id is null or v_merge.id is null then
    raise exception 'Contact not found.' using errcode = 'P0002';
  end if;

  if v_automatic then
    -- Safety net under the linker's own rules: never automatically merge a pair you dismissed or a merge
    -- you undid, and never fold your own addresses or numbers into anyone.
    if exists (
      select 1 from public.contact_suggestions s
      where s.user_id = v_user and s.status = 'dismissed'
        and s.contact_a = least(p_keep, p_merge) and s.contact_b = greatest(p_keep, p_merge)
    ) then
      raise exception 'This pair was kept apart.' using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.contact_identities ci
      where ci.contact_id in (p_keep, p_merge)
        and ci.value in (
          select lower(s.addr)
          from public.accounts a
          cross join lateral unnest(array_append(a.send_addresses, a.address)) as s (addr)
          where a.user_id = v_user
        )
    ) then
      raise exception 'One of these contacts holds your own address or number.' using errcode = '23514';
    end if;
  end if;

  -- The kept contact's fields: a real name beats an address or number, and a full name beats one word.
  v_name := v_keep.display_name;
  if public.contact_name_is_placeholder(v_keep.display_name) and not public.contact_name_is_placeholder(v_merge.display_name) then
    v_name := v_merge.display_name;
  elsif not public.contact_name_is_placeholder(v_merge.display_name)
    and array_length(regexp_split_to_array(btrim(v_keep.display_name), '\s+'), 1) = 1
    and array_length(regexp_split_to_array(btrim(v_merge.display_name), '\s+'), 1) >= 2 then
    v_name := v_merge.display_name;
  end if;

  -- Photos from your address book beat WhatsApp ones; otherwise the kept contact keeps its own.
  v_keep_rank := case when v_keep.avatar_path is null then 0 when v_keep.avatar_source in ('icloud', 'google') then 2 else 1 end;
  v_merge_rank := case when v_merge.avatar_path is null then 0 when v_merge.avatar_source in ('icloud', 'google') then 2 else 1 end;
  v_take_avatar := v_merge_rank > v_keep_rank;

  v_before := to_jsonb(v_keep);

  update public.contacts c set
    display_name = v_name,
    company = coalesce(c.company, v_merge.company),
    role = coalesce(c.role, v_merge.role),
    relationship = coalesce(c.relationship, v_merge.relationship),
    organization_id = coalesce(c.organization_id, v_merge.organization_id),
    avatar_path = case when v_take_avatar then v_merge.avatar_path else c.avatar_path end,
    avatar_source = case when v_take_avatar then v_merge.avatar_source else c.avatar_source end,
    avatar_updated_at = case when v_take_avatar then v_merge.avatar_updated_at else c.avatar_updated_at end,
    style_note = case when c.style_note is null then v_merge.style_note else c.style_note end,
    style_updated_at = case when c.style_note is null then v_merge.style_updated_at else c.style_updated_at end,
    ai_summary = coalesce(c.ai_summary, v_merge.ai_summary)
  where c.id = p_keep
  returning * into v_after;

  v_after_json := to_jsonb(v_after);
  select
    coalesce(jsonb_object_agg(f, v_before -> f), '{}'::jsonb),
    coalesce(jsonb_object_agg(f, v_after_json -> f), '{}'::jsonb)
  into v_before, v_after_json
  from unnest(v_fields) as f
  where (v_before -> f) is distinct from (v_after_json -> f);
  v_moved := v_moved || jsonb_build_object('kept_before', v_before, 'kept_after', v_after_json);

  -- Addresses and numbers.
  with u as (
    update public.contact_identities ci set contact_id = p_keep
    where ci.contact_id = p_merge and ci.user_id = v_user
    returning ci.id
  )
  select coalesce(jsonb_agg(u.id), '[]'::jsonb) into v_ids from u;
  v_moved := v_moved || jsonb_build_object('identities', v_ids);

  -- Conversations: where the kept contact is already a participant, the merged one is dropped, so a
  -- WhatsApp one-to-one chat still has exactly one participant.
  with d as (
    delete from public.thread_participants tp
    where tp.contact_id = p_merge
      and exists (select 1 from public.thread_participants k where k.thread_id = tp.thread_id and k.contact_id = p_keep)
    returning tp.thread_id
  )
  select coalesce(jsonb_agg(d.thread_id), '[]'::jsonb) into v_ids from d;
  v_moved := v_moved || jsonb_build_object('participants_dropped', v_ids);

  with u as (
    update public.thread_participants tp set contact_id = p_keep
    where tp.contact_id = p_merge
    returning tp.thread_id
  )
  select coalesce(jsonb_agg(u.thread_id), '[]'::jsonb) into v_ids from u;
  v_moved := v_moved || jsonb_build_object('participants_moved', v_ids);

  with u as (
    update public.messages m set sender_contact_id = p_keep
    where m.sender_contact_id = p_merge
    returning m.id
  )
  select coalesce(jsonb_agg(u.id), '[]'::jsonb) into v_ids from u;
  v_moved := v_moved || jsonb_build_object('messages', v_ids);

  with u as (
    update public.draft_outcomes o set contact_id = p_keep
    where o.contact_id = p_merge
    returning o.id
  )
  select coalesce(jsonb_agg(u.id), '[]'::jsonb) into v_ids from u;
  v_moved := v_moved || jsonb_build_object('draft_outcomes', v_ids);

  with u as (
    update public.style_rules r set contact_id = p_keep
    where r.contact_id = p_merge
    returning r.id
  )
  select coalesce(jsonb_agg(u.id), '[]'::jsonb) into v_ids from u;
  v_moved := v_moved || jsonb_build_object('style_rules', v_ids);

  -- Suggestions: the pair itself is now merged; other pending pairs follow the merged contact to the kept
  -- one; dismissals of the merged contact also hold for the kept one.
  update public.contact_suggestions s set status = 'merged'
  where s.user_id = v_user and s.contact_a = least(p_keep, p_merge) and s.contact_b = greatest(p_keep, p_merge)
  returning s.id into v_pair;
  v_moved := v_moved || jsonb_build_object('suggestion_pair', v_pair);
  v_moved := v_moved || jsonb_build_object(
    'suggestions_repointed', '[]'::jsonb, 'suggestions_dropped', '[]'::jsonb, 'suggestions_added', '[]'::jsonb
  );

  for v_s in
    select s.* from public.contact_suggestions s
    where s.user_id = v_user and (s.contact_a = p_merge or s.contact_b = p_merge)
      and s.id is distinct from v_pair
    order by s.created_at
  loop
    v_a := least(case when v_s.contact_a = p_merge then p_keep else v_s.contact_a end,
                 case when v_s.contact_b = p_merge then p_keep else v_s.contact_b end);
    v_b := greatest(case when v_s.contact_a = p_merge then p_keep else v_s.contact_a end,
                    case when v_s.contact_b = p_merge then p_keep else v_s.contact_b end);
    if v_s.status = 'pending' then
      if v_a = v_b or exists (
        select 1 from public.contact_suggestions x where x.user_id = v_user and x.contact_a = v_a and x.contact_b = v_b
      ) then
        delete from public.contact_suggestions x where x.id = v_s.id;
        v_moved := jsonb_set(v_moved, '{suggestions_dropped}', (v_moved -> 'suggestions_dropped') || to_jsonb(v_s));
      else
        update public.contact_suggestions x set contact_a = v_a, contact_b = v_b where x.id = v_s.id;
        v_moved := jsonb_set(v_moved, '{suggestions_repointed}', (v_moved -> 'suggestions_repointed')
          || jsonb_build_object('id', v_s.id, 'contact_a', v_s.contact_a, 'contact_b', v_s.contact_b));
      end if;
    elsif v_s.status = 'dismissed' and v_a <> v_b then
      insert into public.contact_suggestions (user_id, contact_a, contact_b, reason, evidence, score, status, decided_at)
      values (v_user, v_a, v_b, v_s.reason, jsonb_build_object('carried_from', v_s.id), v_s.score, 'dismissed', now())
      on conflict (user_id, contact_a, contact_b) do nothing
      returning id into v_added;
      if found then
        v_moved := jsonb_set(v_moved, '{suggestions_added}', (v_moved -> 'suggestions_added') || to_jsonb(v_added));
      end if;
    end if;
  end loop;

  insert into public.contact_merges (id, user_id, kept_contact_id, merged_contact_id, merged_snapshot, moved, reason, automatic, created_at)
  values (v_merge_id, v_user, p_keep, p_merge, to_jsonb(v_merge), v_moved, p_reason, v_automatic, clock_timestamp());

  -- Nothing points at it any more, so this cascades to nothing. Its photo stays in storage: the kept
  -- contact may now point at it.
  delete from public.contacts c where c.id = p_merge;

  return v_merge_id;
end;
$$;

-- Moves some of a contact's addresses and numbers to a new contact named p_name, with the messages they
-- sent and the conversations they are in. Returns the new contact's id. The two are then kept apart.
create or replace function public.split_contact(
  p_contact uuid, p_identity_ids uuid[], p_name text, p_user uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.contact_merge_caller(p_user);
  v_new uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_count int;
  v_total int;
  v_values text[];
  v_emails text[];
  v_left_emails text[];
  v_first_email text;
  v_t record;
  v_chat text;
  v_moved_in boolean;
  v_orig_in boolean;
  v_known boolean;
begin
  perform 1 from public.contacts c where c.id = p_contact and c.user_id = v_user for update;
  if not found then
    raise exception 'Contact not found.' using errcode = 'P0002';
  end if;

  select count(*) into v_count
  from public.contact_identities ci
  where ci.contact_id = p_contact and ci.id = any (coalesce(p_identity_ids, '{}'));
  select count(*) into v_total from public.contact_identities ci where ci.contact_id = p_contact;
  if v_count = 0 or v_count <> cardinality(array(select distinct unnest(p_identity_ids))) then
    raise exception 'Choose addresses or numbers that belong to this contact.' using errcode = '22023';
  end if;
  if v_count = v_total then
    raise exception 'Leave at least one address or number on the contact.' using errcode = '22023';
  end if;

  select array_agg(ci.value), array_agg(ci.value) filter (where ci.kind = 'email'),
         (array_agg(ci.value order by ci.created_at) filter (where ci.kind = 'email'))[1]
  into v_values, v_emails, v_first_email
  from public.contact_identities ci
  where ci.contact_id = p_contact and ci.id = any (p_identity_ids);

  select coalesce(array_agg(ci.value) filter (where ci.kind = 'email'), '{}')
  into v_left_emails
  from public.contact_identities ci
  where ci.contact_id = p_contact and not (ci.id = any (p_identity_ids));
  v_emails := coalesce(v_emails, '{}');

  if v_name is null then
    select ci.value into v_name
    from public.contact_identities ci
    where ci.id = any (p_identity_ids)
    order by (ci.kind = 'email') desc, ci.created_at
    limit 1;
  end if;

  insert into public.contacts (user_id, display_name, organization_id)
  values (v_user, v_name, case when v_first_email is not null then public.organization_for_address(v_user, v_first_email) end)
  returning id into v_new;

  update public.contact_identities ci set contact_id = v_new
  where ci.contact_id = p_contact and ci.id = any (p_identity_ids);

  update public.messages m set sender_contact_id = v_new
  where m.sender_contact_id = p_contact and lower(m.sender_address) = any (v_values);

  for v_t in
    select t.id, t.channel, t.is_group, t.provider_thread_id
    from public.thread_participants tp
    join public.threads t on t.id = tp.thread_id
    where tp.contact_id = p_contact
  loop
    if v_t.channel = 'whatsapp' and not v_t.is_group then
      -- A one-to-one chat has exactly one participant: whoever the chat is with.
      v_chat := case when v_t.provider_thread_id like '%@s.whatsapp.net'
                     then '+' || split_part(v_t.provider_thread_id, '@', 1)
                     else v_t.provider_thread_id end;
      v_moved_in := v_chat = any (v_values)
        or (exists (select 1 from public.messages m where m.thread_id = v_t.id and m.sender_contact_id = v_new)
            and not exists (select 1 from public.messages m where m.thread_id = v_t.id and m.sender_contact_id = p_contact));
      v_orig_in := not v_moved_in;
    else
      v_moved_in := exists (
        select 1 from public.messages m
        where m.thread_id = v_t.id
          and (m.sender_contact_id = v_new
            or exists (select 1 from unnest(m.to_addresses) a where lower(a) = any (v_emails)))
      );
      v_orig_in := exists (
        select 1 from public.messages m
        where m.thread_id = v_t.id
          and (m.sender_contact_id = p_contact
            or exists (select 1 from unnest(m.to_addresses) a where lower(a) = any (v_left_emails)))
      );
      -- Older messages have no recipients stored, and yours have no sender contact. Where a message's
      -- recipients are unknown, nobody can be ruled out: keep the original, and add the new contact when
      -- nothing shows the original is the one involved.
      v_known := not exists (
        select 1 from public.messages m
        where m.thread_id = v_t.id and cardinality(coalesce(m.to_addresses, '{}')) = 0
      );
      if not v_known then
        v_moved_in := v_moved_in or not v_orig_in;
        v_orig_in := true;
      end if;
    end if;

    if v_moved_in then
      insert into public.thread_participants (thread_id, contact_id, user_id)
      values (v_t.id, v_new, v_user)
      on conflict do nothing;
      if not v_orig_in then
        delete from public.thread_participants tp where tp.thread_id = v_t.id and tp.contact_id = p_contact;
      end if;
    end if;
  end loop;

  -- You said these are different people: never suggest or merge them back together.
  insert into public.contact_suggestions (user_id, contact_a, contact_b, reason, evidence, status, decided_at)
  values (v_user, least(p_contact, v_new), greatest(p_contact, v_new), 'other', '{"split": true}'::jsonb, 'dismissed', now())
  on conflict (user_id, contact_a, contact_b) do update set status = 'dismissed';

  return v_new;
end;
$$;

-- Undoes a merge: the merged contact comes back (with its old id when it is free) and exactly what moved
-- goes back to it. The kept contact's fields return to what they were unless they changed since. Only the
-- latest merge involving either contact can be undone. The pair is then kept apart.
create or replace function public.undo_merge(p_merge uuid, p_user uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.contact_merge_caller(p_user);
  v_m public.contact_merges;
  v_keep public.contacts;
  v_restored uuid;
  v_snapshot jsonb;
  v_moved jsonb;
  v_current jsonb;
  v_restore jsonb := '{}'::jsonb;
  v_key text;
  v_s jsonb;
  v_a uuid;
  v_b uuid;
begin
  select * into v_m from public.contact_merges m where m.id = p_merge and m.user_id = v_user for update;
  if v_m.id is null then
    raise exception 'Merge not found.' using errcode = 'P0002';
  end if;
  if v_m.undone_at is not null then
    raise exception 'This merge was already undone.' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contact_merges m
    where m.user_id = v_user and m.id <> v_m.id and m.undone_at is null and m.created_at > v_m.created_at
      and (m.kept_contact_id in (v_m.kept_contact_id, v_m.merged_contact_id)
        or m.merged_contact_id in (v_m.kept_contact_id, v_m.merged_contact_id))
  ) then
    raise exception 'Undo the later merge of this contact first.' using errcode = '55000';
  end if;

  select * into v_keep from public.contacts c where c.id = v_m.kept_contact_id and c.user_id = v_user for update;
  if v_keep.id is null then
    raise exception 'The contact this was merged into no longer exists.' using errcode = '55000';
  end if;
  -- Splits are not recorded as merges. If an address or number that came with the merge has left the
  -- kept contact since (split off, or removed), undoing would bring back an empty duplicate.
  if exists (
    select 1 from jsonb_array_elements_text(coalesce(v_m.moved -> 'identities', '[]'::jsonb)) x(id)
    where not exists (
      select 1 from public.contact_identities ci where ci.id = x.id::uuid and ci.contact_id = v_keep.id
    )
  ) then
    raise exception 'Part of this contact was split off or changed since, so this merge can no longer be undone.' using errcode = '55000';
  end if;

  v_moved := v_m.moved;
  v_snapshot := v_m.merged_snapshot;
  v_restored := v_m.merged_contact_id;
  if exists (select 1 from public.contacts c where c.id = v_restored) then
    v_restored := gen_random_uuid();
  end if;
  v_snapshot := v_snapshot || jsonb_build_object('id', v_restored, 'user_id', v_user);
  if (v_snapshot ->> 'organization_id') is not null and not exists (
    select 1 from public.organizations o where o.id = (v_snapshot ->> 'organization_id')::uuid and o.user_id = v_user
  ) then
    v_snapshot := v_snapshot || jsonb_build_object('organization_id', null);
  end if;

  insert into public.contacts
  select * from jsonb_populate_record(null::public.contacts, v_snapshot);

  -- The kept contact's fields the merge changed, where nobody has changed them since.
  v_current := to_jsonb(v_keep);
  for v_key in select jsonb_object_keys(coalesce(v_moved -> 'kept_before', '{}'::jsonb)) loop
    if (v_current -> v_key) is not distinct from (v_moved -> 'kept_after' -> v_key) then
      v_restore := v_restore || jsonb_build_object(v_key, v_moved -> 'kept_before' -> v_key);
    end if;
  end loop;
  if v_restore <> '{}'::jsonb then
    update public.contacts c set
      display_name = r.display_name, company = r.company, role = r.role, relationship = r.relationship,
      organization_id = r.organization_id, avatar_path = r.avatar_path, avatar_source = r.avatar_source,
      avatar_updated_at = r.avatar_updated_at, style_note = r.style_note, style_updated_at = r.style_updated_at,
      ai_summary = r.ai_summary
    from jsonb_populate_record(null::public.contacts, v_current || v_restore) r
    where c.id = v_keep.id;
  end if;

  update public.contact_identities ci set contact_id = v_restored
  where ci.contact_id = v_keep.id
    and ci.id in (select jsonb_array_elements_text(v_moved -> 'identities')::uuid);

  -- Moved participants go back where the merged contact is not already in the conversation.
  update public.thread_participants tp set contact_id = v_restored
  where tp.contact_id = v_keep.id
    and tp.thread_id in (select jsonb_array_elements_text(v_moved -> 'participants_moved')::uuid);

  insert into public.thread_participants (thread_id, contact_id, user_id)
  select t.id, v_restored, v_user
  from public.threads t
  where t.user_id = v_user
    and t.id in (select jsonb_array_elements_text(v_moved -> 'participants_dropped')::uuid)
  on conflict do nothing;

  update public.messages m set sender_contact_id = v_restored
  where m.sender_contact_id = v_keep.id
    and m.id in (select jsonb_array_elements_text(v_moved -> 'messages')::uuid);

  update public.draft_outcomes o set contact_id = v_restored
  where o.contact_id = v_keep.id
    and o.id in (select jsonb_array_elements_text(v_moved -> 'draft_outcomes')::uuid);

  update public.style_rules r set contact_id = v_restored
  where r.contact_id = v_keep.id
    and r.id in (select jsonb_array_elements_text(v_moved -> 'style_rules')::uuid);

  -- Suggestions back as they were.
  delete from public.contact_suggestions s
  where s.user_id = v_user
    and s.id in (select jsonb_array_elements_text(coalesce(v_moved -> 'suggestions_added', '[]'::jsonb))::uuid);

  -- A repointed suggestion still pending goes back to its old pair. One decided since (say, dismissed by
  -- undoing a later merge) now speaks about the kept contact, so it stays, and the old pair gets a fresh
  -- pending copy.
  for v_s in select * from jsonb_array_elements(coalesce(v_moved -> 'suggestions_repointed', '[]'::jsonb)) loop
    v_a := case when (v_s ->> 'contact_a')::uuid = v_m.merged_contact_id then v_restored else (v_s ->> 'contact_a')::uuid end;
    v_b := case when (v_s ->> 'contact_b')::uuid = v_m.merged_contact_id then v_restored else (v_s ->> 'contact_b')::uuid end;
    if exists (
      select 1 from public.contact_suggestions x
      where x.user_id = v_user and x.contact_a = least(v_a, v_b) and x.contact_b = greatest(v_a, v_b)
    ) then
      continue;
    end if;
    update public.contact_suggestions s set contact_a = least(v_a, v_b), contact_b = greatest(v_a, v_b)
    where s.id = (v_s ->> 'id')::uuid and s.user_id = v_user and s.status = 'pending';
    if not found then
      insert into public.contact_suggestions (user_id, contact_a, contact_b, reason, evidence, score)
      select v_user, least(v_a, v_b), greatest(v_a, v_b), s.reason, s.evidence, s.score
      from public.contact_suggestions s
      where s.id = (v_s ->> 'id')::uuid and s.user_id = v_user
      on conflict do nothing;
    end if;
  end loop;

  for v_s in select * from jsonb_array_elements(coalesce(v_moved -> 'suggestions_dropped', '[]'::jsonb)) loop
    v_a := case when (v_s ->> 'contact_a')::uuid = v_m.merged_contact_id then v_restored else (v_s ->> 'contact_a')::uuid end;
    v_b := case when (v_s ->> 'contact_b')::uuid = v_m.merged_contact_id then v_restored else (v_s ->> 'contact_b')::uuid end;
    insert into public.contact_suggestions (id, user_id, contact_a, contact_b, reason, evidence, score, status, created_at, decided_at)
    values ((v_s ->> 'id')::uuid, v_user, least(v_a, v_b), greatest(v_a, v_b), v_s ->> 'reason',
            coalesce(v_s -> 'evidence', '{}'::jsonb), coalesce((v_s ->> 'score')::real, 0), v_s ->> 'status',
            coalesce((v_s ->> 'created_at')::timestamptz, now()), (v_s ->> 'decided_at')::timestamptz)
    on conflict do nothing;
  end loop;

  -- You undid it: keep these two apart from now on.
  v_a := least(v_keep.id, v_restored);
  v_b := greatest(v_keep.id, v_restored);
  if (v_moved ->> 'suggestion_pair') is not null then
    update public.contact_suggestions s set status = 'dismissed', contact_a = v_a, contact_b = v_b
    where s.id = (v_moved ->> 'suggestion_pair')::uuid and s.user_id = v_user;
  end if;
  insert into public.contact_suggestions (user_id, contact_a, contact_b, reason, evidence, status, decided_at)
  values (v_user, v_a, v_b, 'other', jsonb_build_object('undone_merge', v_m.id), 'dismissed', now())
  on conflict (user_id, contact_a, contact_b) do update set status = 'dismissed';

  update public.contact_merges m set undone_at = now() where m.id = v_m.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function public.contact_suggestions_decided_at() from public, anon, authenticated;
revoke execute on function public.contact_suggestions_on_contact_delete() from public, anon, authenticated;
revoke execute on function public.contact_merge_caller(uuid) from public, anon, authenticated;
revoke execute on function public.contact_name_is_placeholder(text) from public, anon, authenticated;
grant execute on function public.contact_name_is_placeholder(text) to service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.merge_contacts(uuid, uuid, text, boolean, uuid)',
    'public.split_contact(uuid, uuid[], text, uuid)',
    'public.undo_merge(uuid, uuid)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;
