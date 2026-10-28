-- Encryption completeness and storage rules (docs/PLAN.md, Privacy and Encryption, Code Check; Fair Usage and Storage).
--
-- 1. attachments.filename is encrypted, so the database can no longer read it. The three things SQL used it for
--    become small non-sensitive columns the worker sets: file_ext (the extension), keep_hint (the name looks like
--    a receipt or invoice) and is_sticker. Names and content never reach SQL.
-- 2. Stored files are sealed in the worker before upload. sealed marks a sealed object (readers also sniff the
--    header, so objects stored before this still open). content_hash is an HMAC of the file under the user's
--    index key, used to store one copy of a file per account.
-- 3. not_kept says why a file was not copied: 'video_link' (a video over the size limit stays at the provider) or
--    'over_cap' (the seat is full). The app shows "Not Kept Here" and points to the original.
-- 4. update_contact accepts encrypted company, role and relationship (their length is checked on the plain text
--    in the browser; here an encrypted value only has to be a sensible size).

alter table public.attachments
  add column sealed boolean not null default false,
  add column content_hash text check (content_hash is null or length(content_hash) <= 64),
  add column file_ext text check (file_ext is null or file_ext ~ '^[a-z0-9]{1,8}$'),
  add column keep_hint boolean not null default false,
  add column is_sticker boolean not null default false,
  add column not_kept text check (not_kept in ('video_link', 'over_cap'));

-- One copy of a file per account is found by user and hash.
create index attachments_content_hash_idx on public.attachments (user_id, content_hash) where content_hash is not null;

-- Existing rows still have readable names: derive the three values before they are encrypted.
update public.attachments a
set file_ext = lower(nullif(substring(a.filename from '\.([A-Za-z0-9]{1,8})$'), '')),
    is_sticker = a.filename ilike 'Sticker.%',
    keep_hint = a.filename ~* '(receipt|invoice|ticket|statement|booking|itinerary|confirmation|reservation|boarding|voucher|order|tax|bill|payslip|payment|purchase|quotation|quote|rechnung|factura|factuur|recibo)'
where a.filename not like 'e1:%' and a.filename not like 't1:%';

-- ---------------------------------------------------------------------------
-- Junk rule without the file name
-- ---------------------------------------------------------------------------

drop function public.attachment_is_junk(text, text, text, text, boolean, text);
drop function public.attachment_looks_kept(text, text);

-- Incoming, in a junk conversation, and not a PDF that looks like a receipt (from the file name or the subject)
-- and not a calendar file (by extension here, by MIME type in the two callers).
create function public.attachment_is_junk(p_kind text, p_keep boolean, p_ext text, p_direction text, p_thread_junk boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_direction = 'inbound'
    and coalesce(p_thread_junk, false)
    and not (p_kind = 'pdf' and coalesce(p_keep, false))
    and coalesce(p_ext, '') not in ('ics', 'ical', 'ifb', 'vcs')
$$;
revoke execute on function public.attachment_is_junk(text, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.attachment_is_junk(text, boolean, text, text, boolean) to service_role;

create or replace function public.refresh_attachment_junk(p_thread_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.attachments a
  set hidden = x.junk, hidden_reason = case when x.junk then 'junk' end
  from (
    select a2.id,
      public.attachment_is_junk(a2.kind, a2.keep_hint or m.subject_kept, a2.file_ext, m.direction, t.junk)
        and lower(coalesce(a2.mime_type, '')) not in ('text/calendar', 'application/ics') as junk
    from public.attachments a2
    join public.messages m on m.id = a2.message_id
    join public.threads t on t.id = m.thread_id
    where t.id = p_thread_id
  ) x
  where a.id = x.id
    and (a.hidden_reason is null or a.hidden_reason = 'junk')
    and a.hidden is distinct from x.junk;
$$;

create or replace function public.attachment_junk_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hidden_reason is null then
    select public.attachment_is_junk(new.kind, new.keep_hint or m.subject_kept, new.file_ext, m.direction, t.junk)
      and lower(coalesce(new.mime_type, '')) not in ('text/calendar', 'application/ics')
    into new.hidden
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.id = new.message_id;
    new.hidden := coalesce(new.hidden, false);
    if new.hidden then new.hidden_reason := 'junk'; end if;
  end if;
  return new;
end;
$$;

-- The worker sets file_ext and keep_hint just after the row is inserted (it is the only one that can read the
-- name), so the junk mark is worked out again when they arrive. Only a mark the rule itself made is changed.
create function public.attachment_junk_on_hints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.hidden_reason is null or new.hidden_reason = 'junk') and (old.hidden_reason is null or old.hidden_reason = 'junk') then
    select public.attachment_is_junk(new.kind, new.keep_hint or m.subject_kept, new.file_ext, m.direction, t.junk)
      and lower(coalesce(new.mime_type, '')) not in ('text/calendar', 'application/ics')
    into new.hidden
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.id = new.message_id;
    new.hidden := coalesce(new.hidden, false);
    new.hidden_reason := case when new.hidden then 'junk' end;
  end if;
  return new;
end;
$$;
create trigger attachments_junk_on_hints
  before update of file_ext, keep_hint on public.attachments
  for each row
  when (old.file_ext is distinct from new.file_ext or old.keep_hint is distinct from new.keep_hint)
  execute function public.attachment_junk_on_hints();

revoke execute on function public.refresh_attachment_junk(uuid) from public, anon, authenticated;
revoke execute on function public.attachment_junk_on_insert() from public, anon, authenticated;
revoke execute on function public.attachment_junk_on_hints() from public, anon, authenticated;
grant execute on function public.refresh_attachment_junk(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Storage counts without the file name (stickers by flag). Same columns as before. A file saved once for several
-- messages (same content hash, same account) shares one storage_path and is counted once.
-- ---------------------------------------------------------------------------

create or replace view public.storage_usage with (security_invoker = true) as
select
  user_id,
  kind,
  count(*)::integer as files,
  coalesce(sum(size_bytes), 0)::bigint as bytes
from (
  select distinct on (user_id, storage_path) user_id, kind, size_bytes
  from public.attachments
  where storage_path is not null and kind <> 'audio' and not is_sticker
  order by user_id, storage_path
) s
group by user_id, kind;

create or replace function public.storage_flags()
returns table (user_id uuid, total_bytes bigint, week_bytes bigint, top_chat_bytes bigint, reason text)
language sql stable security definer set search_path = ''
as $$
  with stored as (
    select distinct on (a.user_id, a.storage_path) a.user_id, a.size_bytes, a.created_at, m.thread_id, t.is_group
    from public.attachments a
    join public.messages m on m.id = a.message_id
    join public.threads t on t.id = m.thread_id
    where a.storage_path is not null and a.kind <> 'audio' and not a.is_sticker
      and a.size_bytes is not null
    order by a.user_id, a.storage_path, a.created_at
  ),
  per_user as (
    select s.user_id,
           sum(s.size_bytes)::bigint as total,
           coalesce(sum(s.size_bytes) filter (where s.created_at > now() - interval '7 days'), 0)::bigint as week
    from stored s group by s.user_id
  ),
  per_chat as (
    select s.user_id, s.thread_id, sum(s.size_bytes)::bigint as bytes
    from stored s where not s.is_group group by s.user_id, s.thread_id
  ),
  top_chat as (
    select distinct on (c.user_id) c.user_id, c.bytes
    from per_chat c order by c.user_id, c.bytes desc
  )
  select u.user_id, u.total, u.week, coalesce(c.bytes, 0)::bigint,
         case when u.week > 5368709120 then 'More than 5 GB added in a week' else 'Over half in one chat' end
  from per_user u
  left join top_chat c on c.user_id = u.user_id
  where public.is_analytics_owner()
    and (u.week > 5368709120 or (u.total >= 2147483648 and coalesce(c.bytes, 0) * 2 > u.total))
  order by u.total desc
$$;

create or replace function public.team_storage_for(p_user uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'seats', w.seats,
    'members', (select count(*) from public.workspace_members m where m.workspace_id = w.id and m.status = 'active'),
    'bytes', coalesce((
      select sum(u.size_bytes) from (
        select distinct on (a.user_id, a.storage_path) a.size_bytes from public.attachments a
        where a.user_id in (select m.user_id from public.workspace_members m where m.workspace_id = w.id and m.status = 'active')
          and a.storage_path is not null and a.kind <> 'audio' and not a.is_sticker
        order by a.user_id, a.storage_path
      ) u
    ), 0)
  )
  from public.workspace_members me join public.workspaces w on w.id = me.workspace_id
  where me.user_id = p_user and me.status = 'active'
$$;

-- ---------------------------------------------------------------------------
-- update_contact: encrypted company, role and relationship
-- ---------------------------------------------------------------------------
-- The same function as 20261025100500_edit_contacts.sql with one change: a value that arrives encrypted
-- (e1: or t1:) is allowed up to 1000 characters, since its length no longer says how long the text was. The
-- browser checks the plain text before it seals.

create or replace function public.update_contact(
  p_contact uuid,
  p_name text,
  p_company text,
  p_role text,
  p_relationship text,
  p_add jsonb default '[]',
  p_remove uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_role text := nullif(btrim(coalesce(p_role, '')), '');
  v_relationship text := nullif(btrim(coalesce(p_relationship, '')), '');
  v_current text;
  v_ids jsonb;
  v_bad text;
  v_taken record;
begin
  if v_user is null then
    raise exception 'Sign in to edit contacts.' using errcode = '42501';
  end if;
  select c.display_name into v_current from public.contacts c where c.id = p_contact and c.user_id = v_user;
  if not found then
    raise exception 'This contact is not yours or no longer exists.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Add a name.' using errcode = '22023';
  end if;
  -- (each CASE is in parentheses: plpgsql ends an IF condition at the first THEN it sees)
  if length(v_name) > (case when v_name ~ '^[et]1:' then 1000 else 120 end)
    or length(coalesce(v_company, '')) > (case when v_company ~ '^[et]1:' then 1000 else 120 end)
    or length(coalesce(v_role, '')) > (case when v_role ~ '^[et]1:' then 1000 else 120 end)
    or length(coalesce(v_relationship, '')) > (case when v_relationship ~ '^[et]1:' then 1000 else 60 end) then
    raise exception 'Keep the name, company and role to 120 characters or fewer, and the relationship to 60.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'value', value, 'index', idx)), '[]'::jsonb) into v_ids
  from (
    select distinct on (i.kind, i.idx) i.kind, i.value, i.idx
    from jsonb_to_recordset(coalesce(p_add, '[]'::jsonb)) as i (kind text, value text, idx text)
    where i.kind in ('email', 'phone') and nullif(i.value, '') is not null and nullif(i.idx, '') is not null
  ) s;
  if jsonb_array_length(v_ids) > 20 then
    raise exception 'Add 20 addresses or numbers at a time or fewer.' using errcode = '22023';
  end if;
  select value into v_bad from jsonb_to_recordset(v_ids) as i (kind text, value text)
  where value not like 'e1:%'
    and ((kind = 'email' and value !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') or (kind = 'phone' and value !~ '^\+[1-9][0-9]{6,14}$'))
  limit 1;
  if v_bad is not null then
    raise exception 'Check %.', v_bad using errcode = '22023';
  end if;
  select c.id, c.display_name into v_taken
  from public.contact_identities ci
  join public.contacts c on c.id = ci.contact_id
  join jsonb_to_recordset(v_ids) as n (kind text, index text) on n.index = ci.value_index
    and (ci.kind = n.kind or (n.kind = 'phone' and ci.kind = 'whatsapp'))
  where ci.user_id = v_user and ci.contact_id <> p_contact
  order by ci.created_at
  limit 1;
  if v_taken.id is not null then
    raise exception 'One of these already belongs to %.', v_taken.display_name
      using errcode = '23505', detail = v_taken.id::text;
  end if;

  delete from public.contact_identities
  where contact_id = p_contact and user_id = v_user and id = any(coalesce(p_remove, '{}'));

  insert into public.contact_identities (user_id, contact_id, kind, value, value_index, source)
  select v_user, p_contact, i.kind, i.value, i.index, 'manual'
  from jsonb_to_recordset(v_ids) as i (kind text, value text, index text)
  where not exists (
    select 1 from public.contact_identities ci
    where ci.contact_id = p_contact and ci.kind = i.kind and ci.value_index = i.index
  );

  update public.contacts set
    display_name = v_name,
    company = v_company,
    role = v_role,
    relationship = v_relationship,
    name_locked = name_locked or v_name is distinct from v_current,
    updated_at = now()
  where id = p_contact;
end;
$$;

revoke execute on function public.update_contact(uuid, text, text, text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.update_contact(uuid, text, text, text, text, jsonb, uuid[]) to authenticated;
