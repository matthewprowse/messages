-- Round two: Bin and Junk that reach the mail provider, companies for contacts, hidden attachments,
-- when your voice was last learned, and similar past emails for drafting.
-- 1. mail_actions gains trash, untrash, spam and unspam; threads gain a 'trash' status.
-- 2. organizations: one per company email domain, with contacts grouped under them automatically.
-- 3. attachments.hidden and hidden_reason, so signature logos and tracking pixels stay out of the way.
-- 4. profiles.voice_learned_at and voice_learned_outbound, replacing the 'ai:voice' sync_state row.
-- 5. messages.embedding and similar_replies(), so drafts can follow how you answered similar emails.
-- 6. calendar_events readable by its owner (already true through "Own rows"; checked again here).

-- ---------------------------------------------------------------------------
-- 1. Bin and Junk
-- ---------------------------------------------------------------------------

-- Delete in the app moves mail to the provider's bin (Gmail TRASH, iCloud's \Trash folder), never a
-- permanent delete, so it can always be undone from the app, the phone or the web. spam and unspam are only
-- queued when you move mail to Junk yourself; junk the AI spots stays where it is in the provider.
alter table public.mail_actions drop constraint mail_actions_action_check;
alter table public.mail_actions add constraint mail_actions_action_check
  check (action in ('read', 'unread', 'archive', 'unarchive', 'trash', 'untrash', 'spam', 'unspam'));

alter table public.threads drop constraint threads_status_check;
alter table public.threads add constraint threads_status_check
  check (status in ('inbox', 'archived', 'trash'));

-- ---------------------------------------------------------------------------
-- 2. Organizations
-- ---------------------------------------------------------------------------

-- Mail from one company arrives from many subdomains (mail.example.com, e.example.com, info.example.com).
-- Grouping by the registrable domain puts them all under one company. Two-part country suffixes such as
-- co.za and co.uk keep three labels. Help desks that host many companies (cottonon.zendesk.com) keep the
-- company's own label instead of grouping everyone under the help desk.
create or replace function public.mail_domain_root(p_domain text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_labels text[] := string_to_array(trim(both '.' from lower(btrim(coalesce(p_domain, '')))), '.');
  v_count integer := coalesce(array_length(v_labels, 1), 0);
  v_keep integer := 2;
begin
  if v_count = 0 or v_labels[1] = '' then
    return null;
  end if;
  if v_count >= 3
     and length(v_labels[v_count]) = 2
     and v_labels[v_count - 1] in ('co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ltd', 'plc', 'gen', 'web', 'nom', 'or', 'ne', 'go', 'mil', 'sch') then
    v_keep := 3;
  end if;
  if v_count > v_keep and array_to_string(v_labels[v_count - v_keep + 1 : v_count], '.') in ('zendesk.com', 'freshdesk.com') then
    v_keep := v_keep + 1;
  end if;
  if v_count <= v_keep then
    return array_to_string(v_labels, '.');
  end if;
  return array_to_string(v_labels[v_count - v_keep + 1 : v_count], '.');
end;
$$;

-- Personal mail providers: an address there says nothing about where someone works.
create or replace function public.is_personal_mail_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p_domain, ''))) in (
      'gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'mac.com', 'outlook.com', 'hotmail.com',
      'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'aol.com', 'proton.me',
      'protonmail.com', 'protonmail.ch', 'pm.me', 'gmx.com', 'gmx.net', 'gmx.de', 'web.de', 'mail.com',
      'zohomail.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'hey.com', 'fastmail.com',
      'fastmail.fm', 'tutanota.com', 'tuta.io', 'qq.com', '163.com', '126.com', 'naver.com', 'hushmail.com',
      'telkomsa.net', 'vodamail.co.za', 'webmail.co.za', 'btinternet.com'
    )
    -- Country editions of the big webmail brands: hotmail.co.uk, yahoo.co.za, outlook.co.za and so on.
    or split_part(public.mail_domain_root(p_domain), '.', 1) in (
      'gmail', 'googlemail', 'hotmail', 'outlook', 'live', 'msn', 'yahoo', 'ymail', 'icloud', 'aol',
      'protonmail', 'gmx', 'yandex'
    );
$$;

-- A readable default name from the domain's main label: emirates.com is Emirates, checkers.co.za is
-- Checkers, big-talent.co.za is Big Talent. You can rename it in the app.
create or replace function public.organization_name_for_domain(p_domain text)
returns text
language sql
immutable
set search_path = ''
as $$
  select initcap(replace(replace(split_part(p_domain, '.', 1), '-', ' '), '_', ' '));
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null,                     -- registrable domain, lowercase, e.g. emirates.com
  name text not null check (length(btrim(name)) between 1 and 200),
  summary text,                             -- written by the AI worker
  summary_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, domain)
);

alter table public.contacts add column organization_id uuid references public.organizations (id) on delete set null;
create index contacts_organization_idx on public.contacts (organization_id);

-- The company for an email address: found or created, or null for personal providers and your own
-- domains (colleagues on your own domain are people, not a company you deal with).
create or replace function public.organization_for_address(p_user uuid, p_address text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_domain text := public.mail_domain_root(split_part(lower(btrim(coalesce(p_address, ''))), '@', 2));
  v_org uuid;
begin
  if v_domain is null or position('.' in v_domain) = 0 or position('@' in coalesce(p_address, '')) = 0 then
    return null;
  end if;
  if public.is_personal_mail_domain(v_domain) then
    return null;
  end if;
  if exists (
    select 1
    from public.accounts a
    cross join lateral unnest(array_append(a.send_addresses, a.address)) as s (addr)
    where a.user_id = p_user
      and position('@' in s.addr) > 0
      and public.mail_domain_root(split_part(lower(s.addr), '@', 2)) = v_domain
  ) then
    return null;
  end if;

  insert into public.organizations (user_id, domain, name)
  values (p_user, v_domain, public.organization_name_for_domain(v_domain))
  on conflict (user_id, domain) do nothing
  returning id into v_org;

  if v_org is null then
    select o.id into v_org from public.organizations o where o.user_id = p_user and o.domain = v_domain;
  end if;
  return v_org;
end;
$$;

-- New email identities put their contact under the company for that domain. A contact that already has a
-- company keeps it, so a company you chose by hand is never overwritten. Security definer because app users
-- cannot create organizations themselves.
create or replace function public.assign_contact_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if exists (select 1 from public.contacts c where c.id = new.contact_id and c.organization_id is null) then
    v_org := public.organization_for_address(new.user_id, new.value);
    if v_org is not null then
      update public.contacts set organization_id = v_org
      where id = new.contact_id and organization_id is null;
    end if;
  end if;
  return new;
end;
$$;

create trigger assign_contact_organization after insert on public.contact_identities
  for each row when (new.kind = 'email') execute function public.assign_contact_organization();

-- Helpers and the trigger body are internal; nobody calls them through the API.
revoke execute on function public.mail_domain_root(text) from public, anon, authenticated;
revoke execute on function public.is_personal_mail_domain(text) from public, anon, authenticated;
revoke execute on function public.organization_name_for_domain(text) from public, anon, authenticated;
revoke execute on function public.organization_for_address(uuid, text) from public, anon, authenticated;
revoke execute on function public.assign_contact_organization() from public, anon, authenticated;
grant execute on function public.mail_domain_root(text) to service_role;
grant execute on function public.is_personal_mail_domain(text) to service_role;
grant execute on function public.organization_name_for_domain(text) to service_role;
grant execute on function public.organization_for_address(uuid, text) to service_role;

-- Backfill: every existing contact without a company, by its oldest email address.
do $$
declare
  r record;
  v_org uuid;
begin
  for r in
    select distinct on (ci.contact_id) ci.contact_id, ci.user_id, ci.value
    from public.contact_identities ci
    join public.contacts c on c.id = ci.contact_id
    where ci.kind = 'email' and c.organization_id is null
    order by ci.contact_id, ci.created_at
  loop
    v_org := public.organization_for_address(r.user_id, r.value);
    if v_org is not null then
      update public.contacts set organization_id = v_org where id = r.contact_id;
    end if;
  end loop;
end;
$$;

-- You can read your companies and rename them. The worker creates them and writes summaries.
alter table public.organizations enable row level security;

create policy "Read own organizations" on public.organizations for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Rename own organizations" on public.organizations for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.organizations from anon, authenticated;
grant select on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

-- Moving a contact to another company in the app must point at one of your own companies.
create policy "Contacts only in own organizations" on public.contacts as restrictive for insert to authenticated
  with check (contacts.organization_id is null or exists (
    select 1 from public.organizations o where o.id = contacts.organization_id and o.user_id = (select auth.uid())
  ));
create policy "Contacts stay in own organizations" on public.contacts as restrictive for update to authenticated
  with check (contacts.organization_id is null or exists (
    select 1 from public.organizations o where o.id = contacts.organization_id and o.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- 3. Hidden attachments
-- ---------------------------------------------------------------------------

-- Inline signature images, tracking pixels and junk attachments stay in the database (so View Original and
-- re-syncs still match) but are left out of the attachment list. manual is you hiding one yourself.
alter table public.attachments add column hidden boolean not null default false;
alter table public.attachments add column hidden_reason text
  check (hidden_reason in ('inline', 'tiny', 'junk', 'manual'));

-- ---------------------------------------------------------------------------
-- 4. Voice learning bookkeeping on the profile
-- ---------------------------------------------------------------------------

-- voice_learned_outbound is how many emails you had sent at the last voice learning, so the AI worker
-- learns again only once enough new sent mail has arrived.
alter table public.profiles add column voice_learned_at timestamptz;
alter table public.profiles add column voice_learned_outbound integer not null default 0;

-- Carry over round one's sync_state marks, so voice learning does not start again from scratch.
update public.profiles p
set voice_learned_at = v.learned_at,
    voice_learned_outbound = (
      select count(*) from public.messages m
      where m.user_id = p.user_id and m.direction = 'outbound' and m.created_at <= v.learned_at
    )
from (
  select a.user_id, max(s.updated_at) as learned_at
  from public.sync_state s
  join public.accounts a on a.id = s.account_id
  where s.scope = 'ai:voice'
  group by a.user_id
) v
where v.user_id = p.user_id and p.voice_learned_at is null;

-- ---------------------------------------------------------------------------
-- 5. Similar past emails
-- ---------------------------------------------------------------------------

-- 768 dimensions matches the AI worker's Gemini embedding size. Cosine distance, as the embeddings are
-- compared by direction rather than length.
alter table public.messages add column embedding extensions.vector(768);
create index messages_embedding_idx on public.messages
  using hnsw (embedding extensions.vector_cosine_ops);

-- Your replies to the inbound messages most like p_embedding, closest first. A reply is the outbound
-- message that answers it by In-Reply-To, or else your next message in the conversation before anyone
-- writes again. More candidates are fetched than asked for, since not every similar email got a reply.
-- Service role only: it reads across your mail without row-level security.
create or replace function public.similar_replies(p_user uuid, p_embedding extensions.vector(768), p_limit int)
returns table (
  inbound_message_id uuid,
  thread_id uuid,
  contact_id uuid,
  inbound_subject text,
  inbound_text text,
  inbound_sent_at timestamptz,
  reply_message_id uuid,
  reply_text text,
  reply_sent_at timestamptz,
  similarity double precision
)
language sql
stable
set search_path = ''
set hnsw.ef_search = 200
as $$
  with candidates as materialized (
    select m.id, m.thread_id, m.sender_contact_id, m.subject, m.body_text, m.sent_at, m.provider_message_id,
           m.embedding operator(extensions.<=>) p_embedding as distance
    from public.messages m
    where m.user_id = p_user and m.direction = 'inbound' and m.embedding is not null
    order by m.embedding operator(extensions.<=>) p_embedding
    limit greatest(least(coalesce(p_limit, 5), 50), 1) * 4
  )
  select c.id, c.thread_id, c.sender_contact_id, c.subject, c.body_text, c.sent_at,
         r.id, r.body_text, r.sent_at, 1 - c.distance
  from candidates c
  cross join lateral (
    select o.id, o.body_text, o.sent_at
    from public.messages o
    where o.thread_id = c.thread_id
      and o.direction = 'outbound'
      and o.body_text is not null
      and (
        o.in_reply_to = c.provider_message_id
        or (o.sent_at > c.sent_at and not exists (
          select 1 from public.messages n
          where n.thread_id = c.thread_id and n.direction = 'inbound'
            and n.sent_at > c.sent_at and n.sent_at < o.sent_at
        ))
      )
    order by (o.in_reply_to is distinct from c.provider_message_id), o.sent_at
    limit 1
  ) r
  order by c.distance
  limit greatest(least(coalesce(p_limit, 5), 50), 1);
$$;

revoke execute on function public.similar_replies(uuid, extensions.vector, int) from public, anon, authenticated;
grant execute on function public.similar_replies(uuid, extensions.vector, int) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Calendar events readable by their owner
-- ---------------------------------------------------------------------------

-- The initial schema's "Own rows" policy already covers reading. Only add a read policy if it is missing.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_events' and cmd in ('SELECT', 'ALL')
      and 'authenticated' = any (roles)
  ) then
    create policy "Read own calendar events" on public.calendar_events for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;
grant select on public.calendar_events to authenticated;
